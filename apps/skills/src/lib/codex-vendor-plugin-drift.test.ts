import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
import { planAgentIntegration, applyAgentIntegration, assertManagedAgentBridge, inventoryNativeSkills, isInertCodexVendorPluginCopy, codexPromptDriftWarning } from "./agent-integration.js";
import { captureCodexSettingsV3 } from "./codex-settings-witness.js";
import { readManagedSkillPolicySnapshot } from "./managed-policy.js";
import { codexNativePolicyReceiptPath } from "./codex-native-skill-policy.js";
import { CODEX_VENDOR_MARKETPLACES } from "./codex-vendor-refresh.js";
import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
useDefaultTestTimeout();
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); });
const roots: string[] = []; afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const put = (p: string, s: string) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };
const payload = (name: string) => `---\nname: ${name}\ndescription: Synthetic vendor plugin refresh fixture\n---\nSynthetic native instructions\n`;
const read = (path: string) => readFileSync(path, "utf8");
const REMOTE_ID = "plugins_synthetic_00_0000000000000000000";
function refusal(run: () => unknown): string {
  try { run(); return "ACCEPTED"; } catch (error) { return (error as Error).message; }
}
const UNEXPECTED = (count: number) => new RegExp(`^NATIVE_SKILL_DRIFT: ${count} unexpected native skill copies were found: `);

interface Station { home: string; dataDir: string; projectDir: string; cache: string; config: string }
function home(prefix: string, admit = true): Station {
  // Real path: macOS maps /tmp and /var to /private, and the guard compares real paths.
  const home = realpathSync(mkdtempSync(join(tmpdir(), prefix))); roots.push(home);
  if (admit) admitCorpusFixture(join(home, ".codex"));
  return { home, dataDir: join(home, "data"), projectDir: home, cache: join(home, ".codex", "plugins", "cache"), config: join(home, ".codex", "config.toml") };
}
const opts = (s: Station) => ({ home: s.home, dataDir: s.dataDir, projectDir: s.projectDir });
const live = (s: Station) => ({ ...opts(s), codexPromptHook: true });
/** Automatic Codex discovery, as a plain `skills hook install --agent codex` records it. */
function automatic(): Station {
  const s = home("skills-vendor-auto-");
  applyAgentIntegration(planAgentIntegration({ ...opts(s), agents: ["codex"] }));
  return s;
}
/** Reviewed Codex discovery under a typed V3 settings witness, which (like the
 * fleet's reviewed stations) ignores disable-only rules in its digest, so a
 * refusal names the copy rather than a configuration change. */
function reviewedV3(): Station {
  const s = home("skills-vendor-reviewed-");
  put(s.config, "");
  const review = { version: 1 as const, agents: [{ agent: "codex" as const, roots: [], sources: [captureCodexSettingsV3(s.config)], pluginHooks: "reviewed-no-skill-injection" as const }] };
  applyAgentIntegration(planAgentIntegration({ ...opts(s), agents: ["codex"], discoveryInputs: review }));
  expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe("ACCEPTED");
  return s;
}
/** Materialize a plugin version the way Codex's remote plugin refresh does
 * (station04, Codex CLI 0.162.1: sites@openai-curated-remote 1.0.2-remix-b.1). */
function plugin(s: Station, options: { marketplace?: string; name?: string; version?: string; skills?: string[]; receipt?: boolean } = {}): string[] {
  const { marketplace = "openai-curated-remote", name = "sites", version = "1.0.2-remix-b.1", skills = ["sites-remix"], receipt = true } = options;
  const parent = join(s.cache, marketplace, name);
  put(join(parent, version, ".codex-plugin", "plugin.json"), JSON.stringify({ name, version, description: "Synthetic plugin" }));
  if (receipt) put(join(parent, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: REMOTE_ID }));
  return skills.map(skill => { const path = join(parent, version, "skills", skill); put(join(path, "SKILL.md"), payload(skill)); return path; });
}
const append = (s: Station, rows: string) => writeFileSync(s.config, `${read(s.config).trimEnd()}\n\n${rows}`);
const byName = (name: string) => `[[skills.config]]\nname = ${JSON.stringify(name)}\nenabled = false\n`;
const byPath = (copy: string) => `[[skills.config]]\npath = ${JSON.stringify(join(copy, "SKILL.md"))}\nenabled = false\n`;
function assertNothingRecorded(s: Station): void {
  expect(existsSync(join(s.dataDir, "agent-hooks", "codex-vendor-cache-acceptance.json"))).toBe(false);
  expect(existsSync(codexNativePolicyReceiptPath(s.dataDir))).toBe(false);
}

/** Station04 shape: a reviewed Codex catalog enrolled the remote `sites` plugin
 * (qualified-name denial for 1.0.1) under a typed settings witness, then a remote
 * refresh replaced 1.0.1 with 1.0.2-remix-b.1, which has a new `sites-remix` skill. */
function station04(): Station & { parent: string; copy: string; installed: string } {
  const s = home("skills-vendor-station04-");
  const parent = join(s.cache, "openai-curated-remote", "sites"), old = join(parent, "1.0.1"), oldDocument = join(old, "skills", "sites", "SKILL.md");
  put(join(old, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: "1.0.1", description: "Synthetic plugin" }));
  put(oldDocument, payload("sites"));
  put(join(parent, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: REMOTE_ID }));
  put(s.config, `[[skills.config]]\npath = ${JSON.stringify(oldDocument)}\nenabled = false\n`);
  const catalog = { version: "codex-cli 0.162.1", cwd: s.home, skills: [], plugins: [{ id: "sites@openai-curated-remote", name: "sites", installed: true, enabled: true, localVersion: null, remotePluginId: REMOTE_ID, sourceType: "remote" as const }] };
  const review = { version: 1 as const, agents: [{ agent: "codex" as const, roots: [s.cache], sources: [captureCodexSettingsV3(s.config)], pluginHooks: "reviewed-no-skill-injection" as const }] };
  applyAgentIntegration(planAgentIntegration({ ...opts(s), agents: ["codex"], codexNativeCatalog: catalog, discoveryInputs: review }));
  const bridge = readManagedSkillPolicySnapshot(s.dataDir)!.value.bridge;
  expect(bridge.codexPluginSkills.map((control: any) => [control.name, control.pluginParent])).toEqual([["sites:sites", parent]]);
  expect(bridge.discovery.codex.method).toBe("reviewed");
  expect(read(s.config)).toContain('name = "sites:sites"');
  expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe("ACCEPTED");
  const installed = read(s.config);
  // Codex replaces the cached version on refresh (station02 keeps only the
  // current `sites` version although its config names several older ones).
  rmSync(old, { recursive: true });
  const [copy] = plugin(s);
  return { ...s, parent, copy: copy!, installed };
}

describe("B1: the live prompt hook exempts only vendor copies Codex configuration disables", () => {
  test("station04: an enabled refreshed vendor skill blocks; an exact-path or qualified-name disable makes it inert", () => {
    const s = station04();
    // Enabled: both the strict guard and the live hook stop it, with the same message.
    const strict = refusal(() => assertManagedAgentBridge("codex", opts(s)));
    expect(strict).toBe(`NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found: ${JSON.stringify(s.copy)}. Review skills migrate native --agent codex --project <working-directory> --include-unmanaged --include-vendor --json before continuing; it inventories that directory and its ancestors. Use --apply after reviewing the archive plan.`);
    expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toBe(strict);
    // Station04 today: an exact-path disable. Skills 0.10.70 (the strict guard)
    // ignores it for an enrolled plugin; the live hook honours the native rule.
    append(s, byPath(s.copy));
    expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe(strict);
    expect(assertManagedAgentBridge("codex", live(s))).toEqual({ codexInertVendorCopies: [s.copy], codexDiscoveryChanges: [] });
    // The version-independent qualified-name disable alone also makes it inert.
    writeFileSync(s.config, s.installed); append(s, byName("sites:sites-remix"));
    expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe(strict);
    expect(assertManagedAgentBridge("codex", live(s))).toEqual({ codexInertVendorCopies: [s.copy], codexDiscoveryChanges: [] });
    // It keeps working when Codex deposits yet another version of the same skill.
    const [next] = plugin(s, { version: "1.0.3" });
    expect(assertManagedAgentBridge("codex", live(s)).codexInertVendorCopies.sort()).toEqual([s.copy, next!].sort());
    assertNothingRecorded(s);
  });

  test("a whole-plugin disable makes the copy inert; conflicting skill rules and invalid receipts still block", () => {
    const s = station04();
    // An enabling rule is not a vendor refresh entry, so the changed reviewed
    // configuration itself refuses; either way the copy never loads unblocked.
    for (const rows of [
      `${byName("sites:sites-remix")}\n[[skills.config]]\nname = "sites:sites-remix"\nenabled = true\n`,
      `${byPath(s.copy)}\n[[skills.config]]\nname = "sites:sites-remix"\nenabled = true\n`,
      `[[skills.config]]\nname = "sites:sites-remix"\nenabled = true\n\n${byName("sites:sites-remix")}`,
    ]) {
      writeFileSync(s.config, s.installed); append(s, rows);
      expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toMatch(/^NATIVE_SKILL_DRIFT: (Native discovery input changed|1 unexpected native skill copies)/);
    }
    // A whole-plugin disable is sufficient even without a per-skill disable.
    writeFileSync(s.config, s.installed); append(s, `[plugins."sites@openai-curated-remote"]\nenabled = false\n`);
    expect(assertManagedAgentBridge("codex", live(s)).codexInertVendorCopies).toEqual([s.copy]);
    expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe(`NATIVE_SKILL_DRIFT: Native discovery input changed; run skills hook install with a fresh discovery review: ${s.config}`);
    writeFileSync(s.config, s.installed); append(s, byName("sites:sites-remix"));
    expect(assertManagedAgentBridge("codex", live(s)).codexInertVendorCopies).toEqual([s.copy]);
    // Remote vendor plugins must carry the native install receipt.
    const receipt = join(s.parent, ".codex-remote-plugin-install.json"), original = read(receipt);
    for (const bad of ['{"schema_version":2,"remote_plugin_id":"x"}', '{"schema_version":1}', `{"schema_version":1,"remote_plugin_id":"${REMOTE_ID}","extra":true}`, '{"schema_version":1,"remote_plugin_id":"has space"}']) {
      writeFileSync(receipt, bad);
      expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toMatch(/^NATIVE_SKILL_DRIFT: /);
    }
    writeFileSync(receipt, original);
    expect(assertManagedAgentBridge("codex", live(s)).codexInertVendorCopies).toEqual([s.copy]);
  });

  test("a disabled vendor copy beside any non-vendor copy still refuses, naming only the blocking copies", () => {
    for (const extra of [join(".codex", "skills", "user-copy"), join(".agents", "skills", "user-copy"), join(".codex", "skills", ".system", "builtin")]) {
      const s = reviewedV3();
      const [copy] = plugin(s);
      append(s, byName("sites:sites-remix"));
      put(join(s.home, extra, "SKILL.md"), payload("user-copy"));
      const message = refusal(() => assertManagedAgentBridge("codex", live(s)));
      expect(message).toMatch(UNEXPECTED(1));
      expect(message).toContain(JSON.stringify(join(s.home, extra)));
      expect(message).not.toContain(copy!);
    }
  });
});

describe("operator path: the guarded install writes the disable outside the prompt hook", () => {
  test("a fresh native catalog makes skills hook install add the qualified-name disable; the strict guard then passes", () => {
    const s = station04();
    expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toMatch(UNEXPECTED(1));
    const catalog = { version: "codex-cli 0.162.1", cwd: s.home, skills: [{ name: "sites:sites-remix", path: join(s.copy, "SKILL.md"), enabled: true, pluginId: "sites@openai-curated-remote" }], plugins: [{ id: "sites@openai-curated-remote", name: "sites", installed: true, enabled: true, localVersion: "1.0.2-remix-b.1", remotePluginId: REMOTE_ID, sourceType: "remote" as const }] };
    const review = { version: 1 as const, agents: [{ agent: "codex" as const, roots: [s.cache], sources: [captureCodexSettingsV3(s.config)], pluginHooks: "reviewed-no-skill-injection" as const }] };
    const plan = planAgentIntegration({ ...opts(s), agents: ["codex"], codexNativeCatalog: catalog, discoveryInputs: review });
    const change = plan.changes.find(item => item.path === s.config)!;
    expect(change.after.slice(change.before!.length)).toContain('[[skills.config]]\nname = "sites:sites-remix"\nenabled = false\n');
    const applied = applyAgentIntegration(plan);
    expect(applied.backups.some(path => read(path) === s.installed)).toBe(true);
    expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe("ACCEPTED");
    expect(assertManagedAgentBridge("codex", live(s))).toEqual({ codexInertVendorCopies: [s.copy], codexDiscoveryChanges: [] });
  });
});

describe("B2: vendor classification is an exact allowlist", () => {
  test("P1: a Skills-managed or Hasna-marked payload under openai-curated-remote blocks even when disabled", () => {
    for (const marker of [JSON.stringify({ managedBy: "@hasna/skills" }), "not json"]) {
      const s = reviewedV3();
      const [copy] = plugin(s, { name: "payload", version: "1.0.0", skills: ["payload"] });
      put(join(copy!, ".hasna-skills.json"), marker);
      append(s, byName("payload:payload"));
      expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toMatch(UNEXPECTED(1));
      append(s, byPath(copy!));
      expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toMatch(UNEXPECTED(1));
    }
  });

  test("P2: look-alike and non-OpenAI marketplaces block even when disabled", () => {
    expect([...CODEX_VENDOR_MARKETPLACES]).toEqual(["openai-bundled", "openai-curated", "openai-curated-remote"]);
    for (const marketplace of ["acme", "skills", "andrei-hasna", "open-hasna", "hasna", "hasna-internal-bridge", "openai-curated-remote-x", "OpenAI-Curated-Remote", "workspace-directory"]) {
      const s = reviewedV3();
      const [copy] = plugin(s, { marketplace });
      append(s, byName("sites:sites-remix"));
      expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toMatch(UNEXPECTED(1));
      append(s, byPath(copy!));
      expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toMatch(UNEXPECTED(1));
    }
  });

  test("disabled copies in the non-remote OpenAI marketplaces are inert without a remote receipt", () => {
    for (const marketplace of ["openai-bundled", "openai-curated"]) {
      const s = reviewedV3();
      const [copy] = plugin(s, { marketplace, name: "chrome", version: "0.9.1", skills: ["chrome-devtools"], receipt: false });
      append(s, byName("chrome:chrome-devtools"));
      expect(assertManagedAgentBridge("codex", live(s)).codexInertVendorCopies).toEqual([copy!]);
    }
  });

  test("unclassified cache documents and symlinked cache segments refuse", () => {
    // An unclassified document has no plugin-qualified name to disable.
    const loose = reviewedV3();
    put(join(loose.cache, "openai-curated-remote", "loose", "SKILL.md"), payload("loose"));
    append(loose, byName("loose:loose"));
    expect(refusal(() => assertManagedAgentBridge("codex", live(loose)))).toMatch(UNEXPECTED(1));
    const linked = automatic();
    const outside = join(linked.home, "elsewhere", "openai-curated-remote");
    plugin({ ...linked, cache: join(linked.home, "elsewhere") });
    mkdirSync(linked.cache, { recursive: true }); symlinkSync(outside, join(linked.cache, "openai-curated-remote"));
    append(linked, byName("sites:sites-remix"));
    expect(refusal(() => assertManagedAgentBridge("codex", live(linked)))).toMatch(/symlink|NATIVE_SKILL_DRIFT/);
  });

  test("the classifier checks agent, flags, marketplace, marker, receipt, rules, tree hash and real paths", () => {
    // This is a read-only classifier test, independent of hook installation and
    // corpus admission. The live guard tests above still exercise those gates.
    const s = home("skills-vendor-classifier-", false);
    const [vendor] = plugin(s);
    const [other] = plugin(s, { marketplace: "acme", name: "other", version: "1.0.0", skills: ["other"] });
    const inventory = inventoryNativeSkills(s.home, { includeVendor: true, agents: ["codex"], projectDir: s.home });
    const entry = inventory.find(item => item.path === vendor)!;
    const rules = [{ name: "sites:sites-remix", enabled: false }];
    expect(isInertCodexVendorPluginCopy(entry, s.cache, rules, read)).toBe(true);
    expect(isInertCodexVendorPluginCopy(entry, s.cache, [{ path: join(vendor!, "SKILL.md"), enabled: false }], read)).toBe(true);
    expect(isInertCodexVendorPluginCopy(entry, s.cache, [], read)).toBe(false);
    expect(isInertCodexVendorPluginCopy(entry, s.cache, undefined, read)).toBe(false);
    expect(isInertCodexVendorPluginCopy(entry, s.cache, undefined, read, { "sites@openai-curated-remote": { enabled: false } })).toBe(true);
    expect(isInertCodexVendorPluginCopy(entry, s.cache, [], read, { "sites@openai-curated-remote": { enabled: true } })).toBe(false);
    expect(isInertCodexVendorPluginCopy(entry, s.cache, [], read, { "other@openai-curated-remote": { enabled: false } })).toBe(false);
    expect(isInertCodexVendorPluginCopy(entry, s.cache, [{ name: "sites:other", enabled: false }], read)).toBe(false);
    expect(isInertCodexVendorPluginCopy(entry, s.cache, [...rules, { path: join(vendor!, "SKILL.md"), enabled: true }], read)).toBe(false);
    expect(isInertCodexVendorPluginCopy(entry, s.cache, [{ name: "sites:sites-remix" }], read)).toBe(false);
    // An enabling path rule written through a linked alias still counts, in any order.
    const alias = join(s.home, "alias-to-plugin"); symlinkSync(join(s.cache, "openai-curated-remote", "sites"), alias);
    const aliased = join(alias, "1.0.2-remix-b.1", "skills", "sites-remix", "SKILL.md");
    expect(isInertCodexVendorPluginCopy(entry, s.cache, [{ path: aliased, enabled: true }, ...rules], read)).toBe(false);
    expect(isInertCodexVendorPluginCopy(entry, s.cache, [...rules, { path: aliased, enabled: true }], read)).toBe(false);
    expect(isInertCodexVendorPluginCopy(entry, s.cache, [{ path: aliased, enabled: false }], read)).toBe(true);
    expect(isInertCodexVendorPluginCopy(inventory.find(item => item.path === other)!, s.cache, [{ name: "other:other", enabled: false }], read)).toBe(false);
    for (const changed of [{ agent: "claude" }, { vendor: false }, { bridge: true }, { system: true }, { managed: true }, { hash: "0".repeat(64) }]) {
      expect(isInertCodexVendorPluginCopy({ ...entry, ...changed } as typeof entry, s.cache, rules, read)).toBe(false);
    }
    expect(isInertCodexVendorPluginCopy({ ...entry, path: [s.cache, "..", "cache", relative(s.cache, vendor!)].join(sep) }, s.cache, rules, read)).toBe(false);
    const linkedRoot = join(s.cache, "openai-curated-remote", "linked"); symlinkSync(join(s.cache, "openai-curated-remote", "sites"), linkedRoot);
    expect(isInertCodexVendorPluginCopy({ ...entry, path: join(linkedRoot, "1.0.2-remix-b.1", "skills", "sites-remix") }, s.cache, rules, read)).toBe(false);
    const linkedCache = join(s.home, "linked-cache"); symlinkSync(s.cache, linkedCache);
    expect(isInertCodexVendorPluginCopy({ ...entry, path: join(linkedCache, relative(s.cache, vendor!)) }, linkedCache, rules, read)).toBe(false);
    rmSync(join(s.cache, "openai-curated-remote", "sites", ".codex-remote-plugin-install.json"));
    expect(isInertCodexVendorPluginCopy(entry, s.cache, rules, read)).toBe(false);
  });
});

describe("scope and warning text", () => {
  test("only the CLI user-prompt hook passes the opt-in, and only the guard builds a witness tolerance", () => {
    const sourceRoot = join(import.meta.dir, "..");
    const files = (needle: string): string[] => {
      const found: string[] = [];
      const walk = (directory: string): void => {
        for (const name of readdirSync(directory)) {
          const path = join(directory, name);
          if (statSync(path).isDirectory()) walk(path);
          else if (path.endsWith(".ts") && !/\.(test|fixture)\.ts$/.test(path) && readFileSync(path, "utf8").includes(needle)) found.push(relative(sourceRoot, path));
        }
      };
      walk(sourceRoot);
      return found.sort();
    };
    expect(files("codexPromptHook")).toEqual(["cli/commands/agent-integration.ts", "lib/agent-integration.ts"]);
    expect(files("witnessTolerance")).toEqual(["lib/agent-discovery.ts", "lib/agent-integration.ts"]);
    const cli = readFileSync(join(sourceRoot, "cli", "commands", "agent-integration.ts"), "utf8");
    expect(cli.match(/codexPromptHook/g)).toHaveLength(1);
    expect(cli.slice(cli.indexOf('hook.command("user-prompt")'), cli.indexOf('parent.command("migrate")'))).toContain('...(options.agent === "codex" ? { codexPromptHook: true } : {})');
    expect(readFileSync(join(sourceRoot, "lib", "agent-integration.ts"), "utf8")).toContain('agent === "codex" && options.codexPromptHook === true ? {');
  });

  test("N1/N5: the warning escapes control, bidirectional and invisible characters and stays bounded", () => {
    expect(codexPromptDriftWarning({ codexInertVendorCopies: ["/x"], codexDiscoveryChanges: [] })).toBeUndefined();
    const ch = (code: number) => String.fromCharCode(code), bs = ch(92);
    const tricky = [0x200b, 0xfeff, 0x2060, 0x202e, 0x2028, 0x0085].map(code => `/c/a${ch(code)}b`);
    const changes = [...tricky, "/c/line\nbreak", "/c/" + "x".repeat(2000)].map(path => ({ kind: "membership" as const, path }));
    const warning = codexPromptDriftWarning({ codexInertVendorCopies: [], codexDiscoveryChanges: [{ kind: "input", path: "/c/config.toml" }, ...changes, { kind: "membership", path: null }] })!;
    expect(warning.startsWith("Skills warning: 10 reviewed Codex discovery witnesses changed only by a vendor plugin refresh (vendor configuration entries, vendor plugin cache membership) and were not blocked: ")).toBe(true);
    for (const code of [0x200b, 0xfeff, 0x2060, 0x202e, 0x2028, 0x0085]) expect(warning.includes(ch(code))).toBe(false);
    expect(warning).toContain(`"/c/a${bs}u200bb"`);
    expect(warning).toContain(`"/c/a${bs}ufeffb"`);
    expect(warning).toContain("; 6 more.");
    expect(warning).not.toContain("\n");
    expect(warning.length).toBeLessThanOrEqual(3 * 768 + 400);
    const long = codexPromptDriftWarning({ codexInertVendorCopies: [], codexDiscoveryChanges: [{ kind: "membership", path: "/c/" + "y".repeat(5000) }] })!;
    expect(long).not.toContain("y".repeat(800));
    expect(long.length).toBeLessThanOrEqual(768 + 400);
    const third = codexPromptDriftWarning({ codexInertVendorCopies: [], codexDiscoveryChanges: [{ kind: "membership", path: `/c/a${ch(0x2060)}b` }] })!;
    expect(third).toContain(`"/c/a${bs}u2060b"`);
  });
});
