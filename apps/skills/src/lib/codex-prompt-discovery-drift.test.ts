import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { useDefaultTestTimeout } from "../test-preload.js";
import { planAgentIntegration, applyAgentIntegration, assertManagedAgentBridge, codexPromptDriftWarning } from "./agent-integration.js";
import { captureDiscoveryDirectories, verifyAgentDiscovery } from "./agent-discovery.js";
import { verifyDiscoveryDirectories } from "./agent-discovery-directories.js";
import { NativeDiscoveryWitnessChange } from "./native-discovery-witness-change.js";
import { readManagedSkillPolicySnapshot, serializeManagedSkillPolicy } from "./managed-policy.js";
import { codexNativePolicyReceiptPath } from "./codex-native-skill-policy.js";
import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
useDefaultTestTimeout();
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); });
const roots: string[] = []; afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const put = (p: string, s: string) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
function refusal(run: () => unknown): string {
  try { run(); return "ACCEPTED"; } catch (error) { return (error as Error).message; }
}

interface Station { home: string; dataDir: string; projectDir: string; cache: string; config: string }
function home(prefix: string): Station {
  // Real path: macOS maps /tmp and /var to /private, and the guard compares real paths.
  const home = realpathSync(mkdtempSync(join(tmpdir(), prefix))); roots.push(home); admitCorpusFixture(join(home, ".codex"));
  return { home, dataDir: join(home, "data"), projectDir: home, cache: join(home, ".codex", "plugins", "cache"), config: join(home, ".codex", "config.toml") };
}
const opts = (s: Station) => ({ home: s.home, dataDir: s.dataDir, projectDir: s.projectDir });
const warn = (s: Station) => ({ ...opts(s), codexPromptDriftWarnings: true });
/** Automatic Codex discovery, as `skills hook install --agent codex` records it. */
function automatic(): Station {
  const s = home("skills-discovery-drift-auto-");
  applyAgentIntegration(planAgentIntegration({ ...opts(s), agents: ["codex"] }));
  return s;
}
/** Reviewed Codex discovery that binds the plugin cache directory membership. */
function reviewed(): Station {
  const s = home("skills-discovery-drift-reviewed-");
  mkdirSync(join(s.cache, "openai-curated-remote"), { recursive: true }); put(s.config, "");
  const review = { version: 1 as const, agents: [{ agent: "codex" as const, roots: [], sources: [{ path: s.config, sha256: sha(s.config) }], directories: captureDiscoveryDirectories([s.cache]), pluginHooks: "reviewed-no-skill-injection" as const }] };
  applyAgentIntegration(planAgentIntegration({ ...opts(s), agents: ["codex"], discoveryInputs: review }));
  expect(readManagedSkillPolicySnapshot(s.dataDir)!.value.bridge.discovery.codex.method).toBe("reviewed");
  return s;
}
/** Reviewed Pages plugin skill denials whose app capability controls are bound. */
function pages(): Station & { app: string; appPath: string } {
  const s = home("skills-discovery-drift-pages-");
  const root = join(s.cache, "probe", "pages", "1.0.0"), names = ["maintain-space", "write-page"];
  const app = '{"apps":{"pages":{"id":"synthetic_pages_connector","required":true}}}';
  put(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "pages", version: "1.0.0", apps: "./.app.json" })); put(join(root, ".app.json"), app);
  for (const name of names) put(join(root, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: Synthetic Pages fixture\n---\nSynthetic disabled body`);
  const catalog = { version: "codex-cli 0.159.2", cwd: s.home, skills: names.map(name => ({ name: `pages:${name}`, path: join(root, "skills", name, "SKILL.md"), enabled: false, pluginId: "pages@probe" })), plugins: [{ id: "pages@probe", name: "pages", installed: true, enabled: true, localVersion: "1.0.0" }] };
  applyAgentIntegration(planAgentIntegration({ ...opts(s), agents: ["codex"], codexNativeCatalog: catalog }));
  return { ...s, app, appPath: join(root, ".app.json") };
}
/** Same bytes in, same refusal out: the strict guard is unchanged by this feature. */
function changePolicy(s: Station, change: (bridge: any) => void): void {
  const snapshot = readManagedSkillPolicySnapshot(s.dataDir)!;
  change(snapshot.value.bridge);
  writeFileSync(join(s.dataDir, "agent-policy.json"), serializeManagedSkillPolicy(snapshot.value));
}

describe("discovery-witness drift warns only on the live Codex prompt hook", () => {
  test("(2) a changed reviewed configuration source is reported, for automatic and reviewed discovery", () => {
    for (const s of [automatic(), reviewed()]) {
      const before = readFileSync(s.config, "utf8"), policyBefore = readFileSync(join(s.dataDir, "agent-policy.json"));
      put(s.config, `${before}\n[plugins."other@probe"]\nenabled = false\n`);
      expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe(`NATIVE_SKILL_DRIFT: Native discovery input changed; run skills hook install with a fresh discovery review: ${s.config}`);
      const report = assertManagedAgentBridge("codex", warn(s));
      // Reported once, even when the automatic closure sees the same source again.
      expect(report).toEqual({ codexVendorPluginCopies: [], codexDiscoveryChanges: [{ kind: "input", path: s.config }] });
      expect(codexPromptDriftWarning(report)).toBe(`Skills warning: 1 reviewed Codex discovery witness changed (source file) and was not blocked: ${JSON.stringify(s.config)}. Skills context is still delivered, but native discovery is no longer verified against the review. Review the change, then refresh the binding with skills hook install --agent codex and a fresh discovery review.`);
      // Warning records nothing: no policy rewrite and no acceptance receipt.
      expect(readFileSync(join(s.dataDir, "agent-policy.json")).equals(policyBefore)).toBe(true);
      expect(existsReceipt(s)).toBe(false);
    }
  });

  test("(3) a changed plugin-cache directory membership is reported", () => {
    const s = reviewed();
    put(join(s.cache, "openai-curated-remote", "sites", "1.0.2-remix-b.1", "assets", "logo.txt"), "synthetic asset");
    expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe(`NATIVE_SKILL_DRIFT: Native discovery directory membership changed; run skills hook install with a fresh discovery review: ${s.cache}`);
    const report = assertManagedAgentBridge("codex", warn(s));
    expect(report).toEqual({ codexVendorPluginCopies: [], codexDiscoveryChanges: [{ kind: "membership", path: s.cache }] });
    expect(codexPromptDriftWarning(report)).toContain("(directory membership)");
    // Both drift classes at once: membership plus a classified vendor plugin copy.
    const parent = join(s.cache, "openai-curated-remote", "sites");
    put(join(parent, "1.0.2-remix-b.1", ".codex-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: "1.0.2-remix-b.1", description: "Synthetic plugin" }));
    put(join(parent, "1.0.2-remix-b.1", "skills", "sites-remix", "SKILL.md"), "---\nname: sites-remix\ndescription: Synthetic vendor plugin refresh fixture\n---\nSynthetic native instructions\n");
    const both = assertManagedAgentBridge("codex", warn(s));
    expect(both.codexVendorPluginCopies).toEqual([join(parent, "1.0.2-remix-b.1", "skills", "sites-remix")]);
    expect(both.codexDiscoveryChanges).toEqual([{ kind: "membership", path: s.cache }]);
    expect(codexPromptDriftWarning(both)!.split("\n")).toHaveLength(2);
  });

  test("(4) changed reviewed plugin capability controls are reported with the now-unshielded plugin skills", () => {
    const s = pages();
    expect(assertManagedAgentBridge("codex", warn(s))).toEqual({ codexVendorPluginCopies: [], codexDiscoveryChanges: [] });
    put(s.appPath, s.app.replace("true", "false"));
    expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe("NATIVE_SKILL_DRIFT: reviewed native plugin capability controls changed; run skills hook install with a fresh discovery review");
    const report = assertManagedAgentBridge("codex", warn(s));
    expect(report.codexDiscoveryChanges).toEqual([{ kind: "capability", path: s.cache }]);
    // The reviewed denials no longer apply, so the plugin skills become reported vendor copies.
    expect(report.codexVendorPluginCopies.sort()).toEqual([join(s.cache, "probe", "pages", "1.0.0", "skills", "maintain-space"), join(s.cache, "probe", "pages", "1.0.0", "skills", "write-page")]);
    expect(codexPromptDriftWarning(report)).toContain("(plugin capability controls)");
    expect(existsReceipt(s)).toBe(false);
  });
});

describe("fail-closed cases are unchanged in warn mode", () => {
  test("a non-vendor native copy beside discovery drift still refuses", () => {
    for (const copy of [join(".agents", "skills", "user-copy"), join(".codex", "skills", "user-copy"), join(".codex", "skills", ".system", "builtin")]) {
      const s = automatic();
      put(s.config, `${readFileSync(s.config, "utf8")}\n[plugins."other@probe"]\nenabled = false\n`);
      put(join(s.home, copy, "SKILL.md"), "---\nname: user-copy\ndescription: Synthetic user copy\n---\nSynthetic native instructions\n");
      expect(refusal(() => assertManagedAgentBridge("codex", warn(s)))).toMatch(/^NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found: /);
    }
    const s = pages();
    put(s.appPath, s.app.replace("true", "false"));
    put(join(s.home, ".agents", "skills", "user-copy", "SKILL.md"), "---\nname: user-copy\ndescription: Synthetic user copy\n---\nSynthetic native instructions\n");
    expect(refusal(() => assertManagedAgentBridge("codex", warn(s)))).toMatch(/^NATIVE_SKILL_DRIFT: 3 unexpected native skill copies were found: /);
  });

  test("missing discovery coverage still refuses", () => {
    const s = automatic();
    changePolicy(s, bridge => { delete bridge.discovery.codex; });
    expect(refusal(() => assertManagedAgentBridge("codex", warn(s)))).toBe("NATIVE_SKILL_DRIFT: native discovery coverage is missing; run skills hook install");
  });

  test("changed automatic discovery roots still refuse", () => {
    const s = automatic();
    const extra = join(s.home, "extra-root"); mkdirSync(extra);
    changePolicy(s, bridge => { bridge.discovery.codex.roots = [...bridge.discovery.codex.roots, extra].sort(); });
    expect(refusal(() => assertManagedAgentBridge("codex", warn(s)))).toBe("NATIVE_SKILL_DRIFT: Configured native discovery roots changed");
  });

  test("other discovery verification failures still refuse", () => {
    const s = reviewed();
    // A reviewed root that became a symlink is an unsafe binding, not witness drift.
    const real = join(s.home, "real-root"), link = join(s.home, "linked-root"); mkdirSync(real); symlinkSync(real, link);
    changePolicy(s, bridge => { bridge.discovery.codex.roots = [link]; });
    expect(refusal(() => assertManagedAgentBridge("codex", warn(s)))).toBe(refusal(() => assertManagedAgentBridge("codex", opts(s))));
    expect(refusal(() => assertManagedAgentBridge("codex", warn(s)))).toMatch(/^(NATIVE_SKILL_DRIFT: )?Refusing symlink/);
  });

  test("other agents and callers without the opt-in never collect", () => {
    const s = reviewed();
    put(join(s.cache, "openai-curated-remote", "extra", "README"), "x");
    // The verifiers throw the typed change, with the unchanged message, when no collector is given.
    const binding = readManagedSkillPolicySnapshot(s.dataDir)!.value.bridge.discovery.codex;
    let thrown: unknown;
    try { verifyAgentDiscovery(binding); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(NativeDiscoveryWitnessChange);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe("Error");
    expect((thrown as NativeDiscoveryWitnessChange).kind).toBe("membership");
    expect((thrown as Error).message).toBe(`Native discovery directory membership changed; run skills hook install with a fresh discovery review: ${s.cache}`);
    expect(() => verifyDiscoveryDirectories(binding.directories)).toThrow(NativeDiscoveryWitnessChange);
    // With a collector, every change is gathered and nothing throws.
    const changes: NativeDiscoveryWitnessChange[] = [];
    verifyAgentDiscovery(binding, undefined, undefined, changes);
    expect(changes.map(change => [change.kind, change.path])).toEqual([["membership", s.cache]]);
    // An explicit false is the strict guard.
    expect(refusal(() => assertManagedAgentBridge("codex", { ...opts(s), codexPromptDriftWarnings: false }))).toMatch(/^NATIVE_SKILL_DRIFT: Native discovery directory membership changed/);
  });
});

function existsReceipt(s: Station): boolean {
  try { readFileSync(codexNativePolicyReceiptPath(s.dataDir)); return true; } catch { return false; }
}
