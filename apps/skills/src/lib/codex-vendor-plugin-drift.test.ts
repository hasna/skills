import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
import { planAgentIntegration, applyAgentIntegration, assertManagedAgentBridge, inventoryNativeSkills, isInertCodexPluginCacheCopy, isVendorCodexPluginCacheCopy, codexPromptDriftWarning, type CodexNativePolicyGuardInput } from "./agent-integration.js";
import { classifyCodexPluginCacheDocument } from "./codex-plugin-skill-controls.js";
import { codexNativePolicyReceiptPath } from "./codex-native-skill-policy.js";
import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
useDefaultTestTimeout();
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); });
const roots: string[] = []; afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const put = (p: string, s: string) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };
const payload = (name: string) => `---\nname: ${name}\ndescription: Synthetic vendor plugin refresh fixture\n---\nSynthetic native instructions\n`;
const read = (path: string) => readFileSync(path, "utf8");

interface Station { home: string; dataDir: string; projectDir: string; cache: string }
function station(): Station {
  // Real path: macOS maps /tmp and /var to /private, and the guard compares real paths.
  const home = realpathSync(mkdtempSync(join(tmpdir(), "skills-vendor-drift-"))); roots.push(home); admitCorpusFixture(join(home, ".codex"));
  const f = { home, dataDir: join(home, "data"), projectDir: home };
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["codex"] }));
  return { ...f, cache: join(home, ".codex", "plugins", "cache") };
}
/** Materialize a plugin version the way Codex's remote plugin refresh does
 * (station04, Codex CLI 0.162.1: sites@openai-curated-remote 1.0.2-remix-b.1). */
function materialize(s: Station, options: { marketplace?: string; plugin?: string; version?: string; skills?: string[] } = {}): string[] {
  const { marketplace = "openai-curated-remote", plugin = "sites", version = "1.0.2-remix-b.1", skills = ["sites-remix"] } = options;
  const parent = join(s.cache, marketplace, plugin);
  put(join(parent, version, ".codex-plugin", "plugin.json"), JSON.stringify({ name: plugin, version, description: "Synthetic plugin" }));
  put(join(parent, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: `plugins~Plugin_${plugin.padEnd(32, "0")}` }));
  return skills.map(name => { const path = join(parent, version, "skills", name); put(join(path, "SKILL.md"), payload(name)); return path; });
}
const opts = (s: Station) => ({ home: s.home, dataDir: s.dataDir, projectDir: s.projectDir });
function refusal(run: () => unknown): string {
  try { run(); return "ACCEPTED"; } catch (error) { return (error as Error).message; }
}
/** No acceptance, receipt or other record is written for a reported copy. */
function assertNoAcceptanceRecords(s: Station): void {
  expect(existsSync(join(s.dataDir, "agent-hooks", "codex-vendor-cache-acceptance.json"))).toBe(false);
  expect(existsSync(codexNativePolicyReceiptPath(s.dataDir))).toBe(false);
}

describe("live Codex prompt-hook opt-in", () => {
  test("vendor plugin-cache-only drift is reported instead of refused, with no acceptance record", () => {
    const s = station();
    expect(assertManagedAgentBridge("codex", { ...opts(s), codexPromptDriftWarnings: true })).toEqual({ codexVendorPluginCopies: [], codexDiscoveryChanges: [] });
    const policyBefore = readFileSync(join(s.dataDir, "agent-policy.json"));
    const hooksBefore = existsSync(join(s.dataDir, "agent-hooks")) ? readdirSync(join(s.dataDir, "agent-hooks")).sort() : [];
    const [copy] = materialize(s);
    expect(assertManagedAgentBridge("codex", { ...opts(s), codexPromptDriftWarnings: true })).toEqual({ codexVendorPluginCopies: [copy!], codexDiscoveryChanges: [] });
    // Several vendor plugins and versions are all reported together.
    const more = [...materialize(s, { plugin: "browser", version: "2.4.0", skills: ["browser-use", "browser-debug"] }), ...materialize(s, { marketplace: "openai-bundled", plugin: "chrome", version: "0.9.1", skills: ["chrome-devtools"] })];
    expect(assertManagedAgentBridge("codex", { ...opts(s), codexPromptDriftWarnings: true }).codexVendorPluginCopies.sort()).toEqual([copy!, ...more].sort());
    // Reporting writes nothing: the managed policy and hook records are unchanged.
    expect(readFileSync(join(s.dataDir, "agent-policy.json")).equals(policyBefore)).toBe(true);
    expect(existsSync(join(s.dataDir, "agent-hooks")) ? readdirSync(join(s.dataDir, "agent-hooks")).sort() : []).toEqual(hooksBefore);
    assertNoAcceptanceRecords(s);
  });

  test("a refusing native-policy adapter still leaves classified vendor copies reported", () => {
    const s = station();
    const [copy] = materialize(s);
    // The trust default is empty, so the adapter refuses; the vendor report runs after it.
    const forged = { event: "UserPromptSubmit", policy: { capability: "forged" }, sessionId: "01a10e2d-8d78-72f3-9210-78cc6082fb4c", turnId: "01a10e2d-8df1-7632-9704-cb575ee2b98d", hookInputSha256: "0".repeat(64) } as unknown as CodexNativePolicyGuardInput;
    expect(assertManagedAgentBridge("codex", { ...opts(s), codexNativePolicy: forged, codexPromptDriftWarnings: true })).toEqual({ codexVendorPluginCopies: [copy!], codexDiscoveryChanges: [] });
    // Without the opt-in the same input keeps today's refusal, adapter text included.
    expect(refusal(() => assertManagedAgentBridge("codex", { ...opts(s), codexNativePolicy: forged }))).toMatch(/^NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found: .*Native policy adapter refused: /);
    assertNoAcceptanceRecords(s);
  });

  test("the same vendor-only drift refuses every caller that does not opt in", () => {
    const s = station();
    const [copy] = materialize(s);
    const message = refusal(() => assertManagedAgentBridge("codex", opts(s)));
    expect(message).toBe(`NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found: ${JSON.stringify(copy)}. Review skills migrate native --agent codex --project <working-directory> --include-unmanaged --include-vendor --json before continuing; it inventories that directory and its ancestors. Use --apply after reviewing the archive plan.`);
    expect(refusal(() => assertManagedAgentBridge("codex", { ...opts(s), codexPromptDriftWarnings: false }))).toBe(message);
    // Install, trust, migrate and sync never pass the opt-in: only the live
    // prompt hook in the CLI names it outside the guard itself.
    const sourceRoot = join(import.meta.dir, "..");
    const users: string[] = [];
    const walk = (directory: string): void => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".ts") && !/\.(test|fixture)\.ts$/.test(path) && readFileSync(path, "utf8").includes("codexPromptDriftWarnings")) users.push(relative(sourceRoot, path));
      }
    };
    walk(sourceRoot);
    expect(users.sort()).toEqual(["cli/commands/agent-integration.ts", "lib/agent-integration.ts"]);
    // Only the guard builds a witness-change collector, and only under the opt-in.
    const collectors: string[] = [];
    const scan = (directory: string): void => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) scan(path);
        else if (path.endsWith(".ts") && !/\.(test|fixture)\.ts$/.test(path) && readFileSync(path, "utf8").includes("witnessChanges")) collectors.push(relative(sourceRoot, path));
      }
    };
    scan(sourceRoot);
    expect(collectors.sort()).toEqual(["lib/agent-discovery.ts", "lib/agent-integration.ts"]);
    expect(readFileSync(join(sourceRoot, "lib", "agent-integration.ts"), "utf8")).toContain('const witnessChanges: NativeDiscoveryWitnessChange[] | undefined = agent === "codex" && options.codexPromptDriftWarnings === true ? [] : undefined;');
    const cli = readFileSync(join(sourceRoot, "cli", "commands", "agent-integration.ts"), "utf8");
    expect(cli.match(/codexPromptDriftWarnings/g)).toHaveLength(1);
    expect(cli.slice(cli.indexOf('hook.command("user-prompt")'), cli.indexOf('parent.command("migrate")'))).toContain("codexPromptDriftWarnings: true");
  });

  test("a vendor copy beside a user or project copy refuses exactly as without the opt-in", () => {
    for (const extra of [join(".codex", "skills", "user-copy"), join("project", ".agents", "skills", "project-copy")]) {
      const s = station();
      materialize(s);
      put(join(s.home, extra, "SKILL.md"), payload("extra"));
      const projectDirs = [join(s.home, "project")];
      mkdirSync(projectDirs[0]!, { recursive: true });
      const expected = refusal(() => assertManagedAgentBridge("codex", { ...opts(s), projectDirs }));
      expect(expected).toMatch(/^NATIVE_SKILL_DRIFT: 2 unexpected native skill copies were found: /);
      expect(refusal(() => assertManagedAgentBridge("codex", { ...opts(s), projectDirs, codexPromptDriftWarnings: true }))).toBe(expected);
      assertNoAcceptanceRecords(s);
    }
  });

  test("copies under a Hasna-owned marketplace keep refusing", () => {
    for (const marketplace of ["hasna", "hasna-skills", "Hasna-Internal"]) {
      const s = station();
      const [copy] = materialize(s, { marketplace, plugin: "skills-payload", version: "1.0.0", skills: ["payload"] });
      // It is classified installed-plugin content; only the marketplace excludes it.
      expect(classifyCodexPluginCacheDocument(join(copy!, "SKILL.md"), s.cache, read)).not.toBeNull();
      expect(refusal(() => assertManagedAgentBridge("codex", { ...opts(s), codexPromptDriftWarnings: true }))).toMatch(/^NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found: /);
      // Mixed with a vendor copy, the whole set refuses.
      materialize(s);
      expect(refusal(() => assertManagedAgentBridge("codex", { ...opts(s), codexPromptDriftWarnings: true }))).toMatch(/^NATIVE_SKILL_DRIFT: 2 unexpected native skill copies were found: /);
    }
  });

  test("unclassified cache documents and the Codex .system tree keep refusing", () => {
    const loose = station();
    put(join(loose.cache, "openai-curated-remote", "loose", "SKILL.md"), payload("loose"));
    expect(refusal(() => assertManagedAgentBridge("codex", { ...opts(loose), codexPromptDriftWarnings: true }))).toMatch(/^NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found: /);
    const system = station();
    put(join(system.home, ".codex", "skills", ".system", "builtin", "SKILL.md"), payload("builtin"));
    materialize(system);
    expect(refusal(() => assertManagedAgentBridge("codex", { ...opts(system), codexPromptDriftWarnings: true }))).toMatch(/^NATIVE_SKILL_DRIFT: 2 unexpected native skill copies were found: /);
  });

  test("a symlinked cache segment refuses instead of being reported", () => {
    const s = station();
    // The real plugin lives outside the cache; the marketplace segment links to it.
    const outside = join(s.home, "elsewhere", "openai-curated-remote");
    const [copy] = materialize({ ...s, cache: join(s.home, "elsewhere") });
    mkdirSync(s.cache, { recursive: true });
    symlinkSync(outside, join(s.cache, "openai-curated-remote"));
    expect(copy!.startsWith(outside)).toBe(true);
    // Native inventory refuses the linked component before classification; the
    // classifier's own symlink refusal is covered in the classification test.
    const message = refusal(() => assertManagedAgentBridge("codex", { ...opts(s), codexPromptDriftWarnings: true }));
    expect(message).not.toBe("ACCEPTED");
    expect(message).toMatch(/symlink|NATIVE_SKILL_DRIFT/);
  });
});

describe("vendor plugin-cache classification", () => {
  test("only classified, unchanged, non-Hasna plugin-cache copies are vendor copies; the policy check stays with the adapter", () => {
    const s = station();
    const [vendor] = materialize(s);
    const [hasna] = materialize(s, { marketplace: "hasna-skills", plugin: "payload", version: "1.0.0", skills: ["payload"] });
    put(join(s.cache, "openai-curated-remote", "loose", "SKILL.md"), payload("loose"));
    put(join(s.home, ".codex", "skills", "x", "SKILL.md"), payload("x"));
    put(join(s.home, ".agents", "skills", "y", "SKILL.md"), payload("y"));
    const inventory = inventoryNativeSkills(s.home, { includeVendor: true, agents: ["codex"], projectDir: s.home });
    const byPath = (path: string) => inventory.find(entry => entry.path === path)!;
    const vendorEntry = byPath(vendor!);
    expect(isVendorCodexPluginCacheCopy(vendorEntry, s.cache, read)).toBe(true);
    // Unlike the adapter's inert check, an allowed host path does not matter here.
    expect(isInertCodexPluginCacheCopy(vendorEntry, s.cache, [join(vendor!, "SKILL.md")], read)).toBe(false);
    expect(isVendorCodexPluginCacheCopy(byPath(hasna!), s.cache, read)).toBe(false);
    expect(isVendorCodexPluginCacheCopy(byPath(join(s.cache, "openai-curated-remote", "loose")), s.cache, read)).toBe(false);
    expect(isVendorCodexPluginCacheCopy(byPath(join(s.home, ".codex", "skills", "x")), s.cache, read)).toBe(false);
    expect(isVendorCodexPluginCacheCopy(byPath(join(s.home, ".agents", "skills", "y")), s.cache, read)).toBe(false);
    // Structural checks: agent, vendor, bridge and system flags, tree hash.
    expect(isVendorCodexPluginCacheCopy({ ...vendorEntry, agent: "claude" }, s.cache, read)).toBe(false);
    expect(isVendorCodexPluginCacheCopy({ ...vendorEntry, vendor: false }, s.cache, read)).toBe(false);
    expect(isVendorCodexPluginCacheCopy({ ...vendorEntry, bridge: true }, s.cache, read)).toBe(false);
    expect(isVendorCodexPluginCacheCopy({ ...vendorEntry, system: true }, s.cache, read)).toBe(false);
    expect(isVendorCodexPluginCacheCopy({ ...vendorEntry, hash: "0".repeat(64) }, s.cache, read)).toBe(false);
    // A path that leaves the cache, or reaches it through a symlinked component, refuses.
    // A lexical `..` keeps the real path different from the entry path.
    expect(isVendorCodexPluginCacheCopy({ ...vendorEntry, path: [s.cache, "..", "cache", relative(s.cache, vendor!)].join(sep) }, s.cache, read)).toBe(false);
    const [outside] = materialize({ ...s, cache: join(s.home, "elsewhere") });
    expect(isVendorCodexPluginCacheCopy({ ...vendorEntry, path: outside! }, s.cache, read)).toBe(false);
    const linked = join(s.cache, "openai-curated-remote", "linked"); symlinkSync(join(s.cache, "openai-curated-remote", "sites"), linked);
    expect(isVendorCodexPluginCacheCopy({ ...vendorEntry, path: join(linked, "1.0.2-remix-b.1", "skills", "sites-remix") }, s.cache, read)).toBe(false);
    const linkedCache = join(s.home, "linked-cache"); symlinkSync(s.cache, linkedCache);
    expect(isVendorCodexPluginCacheCopy({ ...vendorEntry, path: join(linkedCache, relative(s.cache, vendor!)) }, linkedCache, read)).toBe(false);
  });
});

describe("warning text", () => {
  test("names the count, at most three escaped paths, that nothing was blocked and how to retire the copies", () => {
    const one = codexPromptDriftWarning({ codexVendorPluginCopies: ["/home/u/.codex/plugins/cache/openai-curated-remote/sites/1.0.2-remix-b.1/skills/sites-remix"], codexDiscoveryChanges: [] });
    expect(codexPromptDriftWarning({ codexVendorPluginCopies: [], codexDiscoveryChanges: [] })).toBeUndefined();
    expect(one).toBe(`Skills warning: 1 vendor Codex plugin skill copy was found in the plugin cache and was not blocked: "/home/u/.codex/plugins/cache/openai-curated-remote/sites/1.0.2-remix-b.1/skills/sites-remix". Codex may load it natively beside the Skills CLI bridge. Retire it with skills migrate native --agent codex --project <working-directory> --include-vendor --json (then --apply after review), or disable each exact path with [[skills.config]] path = "<skill-directory>/SKILL.md" enabled = false in the Codex config.toml.`);
    const tricky = ["/c/a\u202eb", "/c/line\nbreak", "/c/" + "x".repeat(1000), "/c/fourth", "/c/fifth"];
    const many = codexPromptDriftWarning({ codexVendorPluginCopies: tricky, codexDiscoveryChanges: [] })!;
    expect(many.startsWith("Skills warning: 5 vendor Codex plugin skill copies were found in the plugin cache and were not blocked: ")).toBe(true);
    expect(many).toContain('"/c/a\\u202eb"');
    expect(many).toContain('"/c/line\\nbreak"');
    expect(many).not.toContain("\u202e");
    expect(many).not.toContain("\n");
    expect(many).toContain("; 2 more.");
    expect(many).not.toContain("/c/fourth");
    expect(many).toContain("...");
    expect(many).not.toContain("x".repeat(800));
    expect(many.length).toBeLessThanOrEqual(3 * 768 + 600);
  });
});
