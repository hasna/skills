import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
import { planAgentIntegration, applyAgentIntegration, assertManagedAgentBridge, inventoryNativeSkills, archiveNativeSkills, isInertCodexVendorPluginCopy, codexPromptDriftWarning } from "./agent-integration.js";
import { captureCodexSettings, captureCodexSettingsV2, captureCodexSettingsV3, captureCodexSettingsV4, captureCodexSettingsV5 } from "./codex-settings-witness.js";
import { createHash } from "node:crypto";
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
/** The refusal for one blocking copy in an OpenAI vendor marketplace: a Codex disable rule, by qualified name. */
const VENDOR_BLOCK = (s: { config: string }, copy: string, name = "sites:sites-remix") => `NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found: ${JSON.stringify(copy)}. Codex refreshes OpenAI marketplace copies on its own, so disable each in Codex instead: add [[skills.config]] with name = ${JSON.stringify(name)} and enabled = false to ${JSON.stringify(s.config)}. Codex then never loads it and the Codex prompt hook accepts it.`;
/** The refusal for one blocking plugin-cache copy that only an exact-path rule retires. */
const PATH_BLOCK = (s: { config: string }, copy: string) => `NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found: ${JSON.stringify(copy)}. For other Codex plugin-cache copies, add [[skills.config]] with the exact path of each SKILL.md and enabled = false to ${JSON.stringify(s.config)}, or remove the plugin in Codex.`;
/** What an automatic binding adds after a config-edit step. */
const REINSTALL = " This automatic binding records that file, so follow the edit with skills hook install --agent codex --apply.";
/** What a reviewed binding adds after a config-edit step that changes its recorded config witness. */
const REVIEWED_FOLLOW_UP = " The reviewed binding records that file, so follow the edit with skills hook install --agent codex --discovery-inputs <reviewed-file> --apply, with a fresh discovery review.";
const FIRST_REMOVE = " First remove the [[skills.config]] rules there that enable skills; no path rule counts while one does.";
/** The refreshed-binding step: reasons, then the exact install command. */
const STRICT_REASON = "This check, unlike the live Codex prompt hook, does not accept a hand-added Codex name rule for a plugin-cache copy";
const REFRESH = (copy: string, reasons: string, step: "reviewed" | "automatic" | "catalog") => `NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found: ${JSON.stringify(copy)}. ${reasons}, so refresh the binding instead: ${{ reviewed: "skills hook install --agent codex --discovery-inputs <reviewed-file> --apply, with a fresh discovery review", automatic: "skills hook install --agent codex --apply", catalog: "skills hook install --agent codex --codex-native-catalog <reviewed-catalog> --discovery-inputs <reviewed-file> --apply, with a fresh discovery review and native catalog" }[step]}. It disables and records each copy.`;
const freshV3 = (s: { config: string }, roots: string[] = []) => ({ version: 1 as const, agents: [{ agent: "codex" as const, roots, sources: [captureCodexSettingsV3(s.config)], pluginHooks: "reviewed-no-skill-injection" as const }] });

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
    // Enabled: both the strict guard and the live hook stop it. Only the live hook
    // honours a hand-added name rule, so only it names one; the strict guard names
    // the refreshed binding, with a fresh catalog for this enrolled plugin.
    const strict = refusal(() => assertManagedAgentBridge("codex", opts(s)));
    expect(strict).toBe(REFRESH(s.copy, `${STRICT_REASON}; only a fresh native catalog review exempts a skill of a plugin Skills has enrolled`, "catalog"));
    expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toBe(VENDOR_BLOCK(s, s.copy));
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

  test("a whole-plugin disable never makes the copy inert; conflicting skill rules and invalid receipts still block", () => {
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
    // Remote state can enable a locally disabled remote plugin, so a whole-plugin
    // table alone never exempts the copy. The table itself is a tolerated vendor
    // disable; the copy it fails to retire still blocks, naming only that copy.
    writeFileSync(s.config, s.installed); append(s, `[plugins."sites@openai-curated-remote"]\nenabled = false\n`);
    // The table already differs from what the binding recorded, so the name rule
    // is followed by a refreshed binding (with a catalog for this enrolled plugin).
    expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toBe(`${VENDOR_BLOCK(s, s.copy)} The reviewed binding records that file, so follow the edit with skills hook install --agent codex --codex-native-catalog <reviewed-catalog> --discovery-inputs <reviewed-file> --apply, with a fresh discovery review and native catalog.`);
    expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe(`NATIVE_SKILL_DRIFT: Native discovery input changed; run skills hook install with a fresh discovery review: ${s.config}`);
    // With a qualified-name disable beside it, the name rule is what exempts the copy.
    append(s, byName("sites:sites-remix"));
    expect(assertManagedAgentBridge("codex", live(s))).toEqual({ codexInertVendorCopies: [s.copy], codexDiscoveryChanges: [{ kind: "input", path: s.config }] });
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
    // The reviewed control now exempts it on every guard call, so the live hook
    // needs no vendor exemption and reports none.
    expect(assertManagedAgentBridge("codex", live(s))).toEqual({ codexInertVendorCopies: [], codexDiscoveryChanges: [] });
  });
});

describe("B2: vendor classification is an exact allowlist", () => {
  test("P1: a Skills-managed or Hasna-marked payload under openai-curated-remote is never a vendor copy", () => {
    for (const marker of [JSON.stringify({ managedBy: "@hasna/skills" }), "not json"]) {
      const s = reviewedV3();
      const [copy] = plugin(s, { name: "payload", version: "1.0.0", skills: ["payload"] });
      put(join(copy!, ".hasna-skills.json"), marker);
      // A qualified-name disable, which only the vendor classifier honours, does not exempt it.
      append(s, byName("payload:payload"));
      expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toMatch(UNEXPECTED(1));
      expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toMatch(UNEXPECTED(1));
      // An exact-path disable is the guard's own plugin-cache rule, which every guard
      // call applies; the live hook keeps it and never classifies the copy as vendor.
      append(s, byPath(copy!));
      expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe("ACCEPTED");
      expect(assertManagedAgentBridge("codex", live(s))).toEqual({ codexInertVendorCopies: [], codexDiscoveryChanges: [] });
      // Once the hook tolerates a witness change (a vendor plugin table), the strict
      // guard refuses the whole state, so only the vendor classifier can exempt a
      // plugin-cache copy, and it never classifies this one.
      append(s, `[plugins."payload@openai-curated-remote"]\nenabled = false\n`);
      expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe(`NATIVE_SKILL_DRIFT: Native discovery input changed; run skills hook install with a fresh discovery review: ${s.config}`);
      const blocked = refusal(() => assertManagedAgentBridge("codex", live(s)));
      expect(blocked).toMatch(UNEXPECTED(1));
      expect(blocked).toContain(JSON.stringify(copy));
    }
  });

  test("P2: look-alike and non-OpenAI marketplaces are never vendor copies", () => {
    expect([...CODEX_VENDOR_MARKETPLACES]).toEqual(["openai-bundled", "openai-curated", "openai-curated-remote"]);
    for (const marketplace of ["acme", "skills", "andrei-hasna", "open-hasna", "hasna", "hasna-internal-bridge", "openai-curated-remote-x", "OpenAI-Curated-Remote", "workspace-directory", "created-by-me-remote"]) {
      const s = reviewedV3();
      const [copy] = plugin(s, { marketplace });
      append(s, byName("sites:sites-remix"));
      expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toMatch(UNEXPECTED(1));
      expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toMatch(UNEXPECTED(1));
      append(s, byPath(copy!));
      expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe("ACCEPTED");
      expect(assertManagedAgentBridge("codex", live(s))).toEqual({ codexInertVendorCopies: [], codexDiscoveryChanges: [] });
    }
  });

  test("N-1: the live hook keeps every exemption the strict guard grants (exact-path and reviewed controls)", () => {
    // Exact-path disables in any plugin-cache marketplace, as the strict guard accepts them.
    for (const marketplace of ["workspace-directory", "created-by-me-remote", "hasna-internal-bridge", "acme", "openai-curated-remote"]) {
      const s = reviewedV3();
      const [copy] = plugin(s, { marketplace, name: "x", version: "1.0.0", skills: ["y"] });
      append(s, byPath(copy!));
      expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe("ACCEPTED");
      expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toBe("ACCEPTED");
      // A tolerated vendor change elsewhere is a state the strict guard refuses;
      // there only the vendor classifier exempts plugin-cache copies.
      append(s, `[plugins."sites@openai-curated-remote"]\nenabled = false\n`);
      expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe(`NATIVE_SKILL_DRIFT: Native discovery input changed; run skills hook install with a fresh discovery review: ${s.config}`);
      const vendor = marketplace === "openai-curated-remote";
      if (vendor) expect(assertManagedAgentBridge("codex", live(s))).toEqual({ codexInertVendorCopies: [copy!], codexDiscoveryChanges: [{ kind: "input", path: s.config }] });
      else expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toBe(REFRESH(copy!, "Plugin-cache copies keep their exact-path exemption only while the recorded configuration is unchanged", "reviewed"));
    }
    // A reviewed qualified-name control in a non-vendor marketplace, across a version relocation.
    const s = home("skills-vendor-reviewed-control-");
    const parent = join(s.cache, "probe", "pages"), names = ["maintain-space", "write-page"];
    const add = (version: string) => {
      const root = join(parent, version);
      put(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "pages", version }));
      for (const name of names) put(join(root, "skills", name, "SKILL.md"), payload(name));
      return root;
    };
    const original = add("1.0.0"); put(s.config, "");
    const catalog = { version: "codex-cli 0.159.2", cwd: s.home, skills: names.map(name => ({ name: `pages:${name}`, path: join(original, "skills", name, "SKILL.md"), enabled: true, pluginId: "pages@probe" })), plugins: [{ id: "pages@probe", name: "pages", installed: true, enabled: true, localVersion: "1.0.0" }] };
    applyAgentIntegration(planAgentIntegration({ ...opts(s), agents: ["codex"], codexNativeCatalog: catalog }));
    add("2.0.0");
    expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe("ACCEPTED");
    expect(assertManagedAgentBridge("codex", live(s))).toEqual({ codexInertVendorCopies: [], codexDiscoveryChanges: [] });
  });

  test("disabled copies in the non-remote OpenAI marketplaces are inert without a remote receipt", () => {
    for (const marketplace of ["openai-bundled", "openai-curated"]) {
      const s = reviewedV3();
      const [copy] = plugin(s, { marketplace, name: "chrome", version: "0.9.1", skills: ["chrome-devtools"], receipt: false });
      append(s, byName("chrome:chrome-devtools"));
      expect(assertManagedAgentBridge("codex", live(s)).codexInertVendorCopies).toEqual([copy!]);
    }
  });

  test("B-1: a whole-plugin table alone never exempts a vendor copy, in any vendor marketplace", () => {
    // A cache copy carries no proof that its plugin source is configuration
    // controlled, and remote state can enable a locally disabled remote plugin.
    for (const [marketplace, receipt] of [["openai-curated-remote", true], ["openai-curated", false], ["openai-bundled", false]] as const) {
      const s = reviewedV3();
      const [copy] = plugin(s, { marketplace, receipt });
      append(s, `[plugins."sites@${marketplace}"]\nenabled = false\n`);
      // The table already differs from what the binding recorded, so a refresh follows the rule.
      expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toBe(`${VENDOR_BLOCK(s, copy!)}${REVIEWED_FOLLOW_UP}`);
      // An exact-path or qualified-name rule is what retires it.
      append(s, byName("sites:sites-remix"));
      expect(assertManagedAgentBridge("codex", live(s)).codexInertVendorCopies).toEqual([copy!]);
      assertNothingRecorded(s);
    }
  });

  test("F1/F3: a name-disabled copy gets no vendor exemption when its plugin can load what the inventory cannot see", () => {
    const hooks = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "true" }] }] } });
    const manifest = (root: string, extra: Record<string, unknown> = {}) => put(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: "1.0.3", ...extra }));
    const shapes: Record<string, (root: string) => void> = {
      "skills list with a hidden root": root => { manifest(root, { skills: ["./skills", "./.payload"] }); put(join(root, ".payload", "evil", "SKILL.md"), payload("evil")); },
      "migrated command skills": root => put(join(root, ".codex-plugin", "migrated-command-skills", "evil", "SKILL.md"), payload("evil")),
      "root Agent Plugins manifest with hooks": root => { put(join(root, "plugin.json"), JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "sites", version: "1.0.3", hooks: "./h.json" })); put(join(root, "h.json"), hooks); },
      "manifest extensions": root => manifest(root, { extensions: { "com.openai": { onboardingSkill: "evil" } } }),
      "Claude manifest with hooks": root => { put(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: "1.0.3", hooks: "./h.json" })); put(join(root, "h.json"), hooks); },
      "MCP declaration file": root => put(join(root, ".mcp.json"), JSON.stringify({ mcpServers: {} })),
      "inline MCP servers": root => manifest(root, { mcpServers: { x: { command: "true" } } }),
      "default commands directory": root => put(join(root, "commands", "c.md"), "synthetic command"),
      "default agents directory": root => put(join(root, "agents", "a.md"), "synthetic agent"),
    };
    const station = (binding: string) => {
      const s = home(`skills-vendor-addver-${binding}-`);
      put(s.config, byName("sites:x"));
      if (binding === "auto") applyAgentIntegration(planAgentIntegration({ ...opts(s), agents: ["codex"] }));
      else applyAgentIntegration(planAgentIntegration({ ...opts(s), agents: ["codex"], discoveryInputs: { version: 1, agents: [{ agent: "codex", roots: binding === "v3roots" ? [s.cache] : [], sources: [captureCodexSettingsV3(s.config)], pluginHooks: "reviewed-no-skill-injection" }] } }));
      // A remote sync deposits a version with a visible, name-disabled skill.
      const root = join(s.cache, "openai-curated", "sites", "1.0.3"), copy = join(root, "skills", "x");
      manifest(root); put(join(copy, "SKILL.md"), payload("x"));
      return { s, root, copy };
    };
    for (const binding of ["auto", "v3", "v3roots"]) {
      // Control: a clean added version is exempt by the name rule on the live hook only.
      const clean = station(binding);
      const blocked = `NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found: ${JSON.stringify(clean.copy)}`;
      expect(refusal(() => assertManagedAgentBridge("codex", opts(clean.s)))).toStartWith(blocked);
      expect(assertManagedAgentBridge("codex", live(clean.s))).toEqual({ codexInertVendorCopies: [clean.copy], codexDiscoveryChanges: [] });
      for (const [label, make] of Object.entries(shapes)) {
        const { s, root, copy } = station(binding);
        make(root);
        // Both refuse the copy. A name rule cannot exempt it, so the live hook names
        // the exact-path rule; the strict guard names the refreshed binding.
        expect([binding, label, refusal(() => assertManagedAgentBridge("codex", opts(s)))]).toEqual([binding, label, REFRESH(copy, STRICT_REASON, binding === "auto" ? "automatic" : "reviewed")]);
        expect([binding, label, refusal(() => assertManagedAgentBridge("codex", live(s)))]).toEqual([binding, label, `${PATH_BLOCK(s, copy)}${binding === "auto" ? REINSTALL : ""}`]);
      }
    }
  });

  test("N4: a malformed connector file in any version of the plugin removes the vendor exemption", () => {
    const valid = '{"apps":{"sites":{"id":"synthetic_sites_connector","required":true}}}';
    const bad: Array<[string, string | Buffer]> = [
      ["valid (control)", valid],
      ["malformed JSON", '{"apps":'],
      ["oversized", valid + " ".repeat(1024 * 1024)],
      ["unknown key", '{"apps":{"sites":{"id":"synthetic_sites_connector","command":"true"}}}'],
      ["duplicate keys", '{"apps":{"sites":{"id":"a"}},"apps":{"sites":{"id":"b"}}}'],
      ["wrong type", '{"apps":{"sites":{"id":7}}}'],
      ["non-UTF-8 bytes", Buffer.concat([Buffer.from('{"apps":{"sites":{"id":"x","category":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}}}')])],
    ];
    for (const [label, bytes] of bad) {
      const s = reviewedV3();
      const [copy] = plugin(s, { marketplace: "openai-curated", receipt: false });
      // Another cached version of the same plugin declares a connector.
      const sibling = join(s.cache, "openai-curated", "sites", "1.0.1");
      put(join(sibling, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: "1.0.1", apps: "./.app.json" }));
      writeFileSync(join(sibling, ".app.json"), bytes);
      append(s, byName("sites:sites-remix"));
      const outcome = refusal(() => assertManagedAgentBridge("codex", live(s)));
      if (label === "valid (control)") expect([label, outcome]).toEqual([label, "ACCEPTED"]);
      else expect([label, outcome]).toEqual([label, expect.stringMatching(/^NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found: /)]);
      if (label !== "valid (control)") expect(outcome).toContain(JSON.stringify(copy));
    }
  });

  test("F2: a linked sibling version gains nothing from the vendor rule; the guard's own exact-path rule is unchanged", () => {
    const cases: Array<[string, (root: string) => string]> = [
      ["name", () => byName("sites:x")],
      ["path", root => byPath(join(root, "skills", "x"))],
    ];
    for (const [label, rule] of cases) {
      const s = reviewedV3();
      const parent = join(s.cache, "openai-curated", "sites"), root = join(parent, "1.0.2");
      put(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: "1.0.2" }));
      put(join(root, "skills", "x", "SKILL.md"), payload("x"));
      symlinkSync(root, join(parent, "1.0.3"));
      append(s, rule(root));
      const strict = refusal(() => assertManagedAgentBridge("codex", opts(s)));
      expect([label, refusal(() => assertManagedAgentBridge("codex", live(s)))]).toEqual([label, strict]);
      // The strict guard refuses the link unless an exact-path disable covers every target skill.
      expect([label, strict === "ACCEPTED"]).toEqual([label, label === "path"]);
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
    // Plugin tables are not an input: an extra argument from an older caller is ignored.
    const legacy = isInertCodexVendorPluginCopy as unknown as (...args: unknown[]) => boolean;
    expect(legacy(entry, s.cache, undefined, read, { "sites@openai-curated-remote": { enabled: false } })).toBe(false);
    expect(legacy(entry, s.cache, [], read, { "sites@openai-curated-remote": { enabled: false } })).toBe(false);
    // A second SKILL.md nested below the copy would load under its own name.
    const nested = join(vendor!, "examples", "inner", "SKILL.md"); put(nested, payload("inner"));
    const nestedEntry = inventoryNativeSkills(s.home, { includeVendor: true, agents: ["codex"], projectDir: s.home }).find(item => item.path === vendor)!;
    expect(isInertCodexVendorPluginCopy(nestedEntry, s.cache, rules, read)).toBe(false);
    rmSync(join(vendor!, "examples"), { recursive: true });
    expect(isInertCodexVendorPluginCopy(entry, s.cache, rules, read)).toBe(true);
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
    expect(warning.startsWith("Skills warning: 10 recorded Codex discovery witnesses changed only by a vendor plugin refresh (vendor configuration entries, vendor plugin cache membership) and were not blocked: ")).toBe(true);
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

  test("N-4: the warning escapes every format character, including joiners, soft hyphen and astral tag characters", () => {
    const bs = String.fromCharCode(92);
    // ZWNJ, ZWJ, soft hyphen, Mongolian vowel separator, interlinear annotation,
    // language tag, tag letter A, Kaithi number sign (astral Cf), paragraph separator, BEL.
    for (const code of [0x200c, 0x200d, 0x00ad, 0x180e, 0xfff9, 0xe0001, 0xe0041, 0x110bd, 0x2029, 0x0007]) {
      const character = String.fromCodePoint(code);
      const warning = codexPromptDriftWarning({ codexInertVendorCopies: [], codexDiscoveryChanges: [{ kind: "membership", path: `/c/a${character}b` }] })!;
      const escaped = Array.from({ length: character.length }, (_, index) => `${bs}u${character.charCodeAt(index).toString(16).padStart(4, "0")}`).join("");
      expect([code.toString(16), warning.includes(character)]).toEqual([code.toString(16), false]);
      expect([code.toString(16), warning.includes(`"/c/a${escaped}b"`)]).toEqual([code.toString(16), true]);
      expect([...warning].some(part => /[\p{Cf}\p{Cc}\p{Zl}\p{Zp}]/u.test(part))).toBe(false);
    }
    // Ordinary non-ASCII text is shown as is.
    expect(codexPromptDriftWarning({ codexInertVendorCopies: [], codexDiscoveryChanges: [{ kind: "membership", path: "/c/caf\u00e9-\u0219" }] })).toContain(`"/c/caf\u00e9-\u0219"`);
  });
});

describe("D: disable rows for vendor skills that are new or gone", () => {
  test("a new vendor skill name already disabled by name never blocks the live hook; rows for removed versions, skills and plugins never block", () => {
    // A refresh that adds a new skill (sites:sites in a new 1.0.x version) whose qualified name Codex config already disables.
    const s = reviewedV3();
    append(s, byName("sites:sites"));
    const [copy] = plugin(s, { version: "1.0.4", skills: ["sites"] });
    expect(assertManagedAgentBridge("codex", live(s)).codexInertVendorCopies).toEqual([copy!]);
    // Rows naming versions, skills, plugins and marketplaces that no longer exist are inert in both guards.
    const stale = [
      byPath(join(s.cache, "openai-curated-remote", "sites", "1.0.1", "skills", "sites")),
      byPath(join(s.cache, "openai-curated-remote", "gone", "0.1.0", "skills", "x")),
      byPath(join(s.home, ".codex", "skills", "removed-user-skill")),
      byName("gone:skill"),
      byName("sites:retired-skill"),
    ].join("\n");
    append(s, stale);
    expect(assertManagedAgentBridge("codex", live(s)).codexInertVendorCopies).toEqual([copy!]);
    const t = reviewedV3();
    append(t, stale);
    expect(refusal(() => assertManagedAgentBridge("codex", opts(t)))).toBe("ACCEPTED");
    expect(assertManagedAgentBridge("codex", live(t))).toEqual({ codexInertVendorCopies: [], codexDiscoveryChanges: [] });
    // Station04: the enrolled plugin's old version and its path rule are gone; only the new copy needs a rule.
    const u = station04();
    expect(read(u.config)).toContain(join(u.parent, "1.0.1", "skills", "sites", "SKILL.md"));
    append(u, byName("sites:sites-remix"));
    expect(assertManagedAgentBridge("codex", live(u)).codexInertVendorCopies).toEqual([u.copy]);
  });
});

describe("E: the refusal names the step that works for the calling guard and the kind of copy", () => {
  test("F1: a strict guard call, including hook install reusing a saved review, names a refreshed binding after the name rule is added", () => {
    const s = reviewedV3();
    const [copy] = plugin(s);
    expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toBe(VENDOR_BLOCK(s, copy!));
    append(s, byName("sites:sites-remix"));
    expect(assertManagedAgentBridge("codex", live(s)).codexInertVendorCopies).toEqual([copy!]);
    // The strict guard ignores the hand-added name rule, so it never repeats that advice.
    const strict = REFRESH(copy!, STRICT_REASON, "reviewed");
    expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe(strict);
    // skills hook install --apply without --discovery-inputs reuses the saved review through the strict guard.
    expect(refusal(() => planAgentIntegration({ ...opts(s), agents: ["codex"] }))).toBe(strict);
    // The named step works: a fresh review install disables and records the copy.
    applyAgentIntegration(planAgentIntegration({ ...opts(s), agents: ["codex"], discoveryInputs: freshV3(s) }));
    expect(read(s.config)).toContain(`path = ${JSON.stringify(join(copy!, "SKILL.md"))}\nenabled = false`);
    expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe("ACCEPTED");
    expect(assertManagedAgentBridge("codex", live(s))).toEqual({ codexInertVendorCopies: [], codexDiscoveryChanges: [] });
    // An automatic binding needs no review file.
    const a = automatic();
    const [auto] = plugin(a);
    expect(refusal(() => assertManagedAgentBridge("codex", opts(a)))).toBe(REFRESH(auto!, STRICT_REASON, "automatic"));
    applyAgentIntegration(planAgentIntegration({ ...opts(a), agents: ["codex"] }));
    expect(refusal(() => assertManagedAgentBridge("codex", opts(a)))).toBe("ACCEPTED");
  });

  test("F2: Codex system skills, which migration never archives, get the refreshed-binding step", () => {
    for (const binding of ["reviewed", "automatic"] as const) {
      const s = binding === "reviewed" ? reviewedV3() : automatic();
      const builtin = join(s.home, ".codex", "skills", ".system", "builtin");
      put(join(builtin, "SKILL.md"), payload("builtin"));
      const expected = REFRESH(builtin, "Codex system skills are never archived by skills migrate native", binding);
      expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe(expected);
      expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toBe(expected);
      expect(expected).not.toContain("--include-vendor");
      // The old --include-vendor advice archives nothing for a system skill.
      const inventory = inventoryNativeSkills(s.home, { projectDirs: [s.home], agents: ["codex"], includeVendor: true });
      expect(inventory.find(entry => entry.path === builtin)).toMatchObject({ vendor: true, system: true });
      expect(archiveNativeSkills(inventory, { dataDir: s.dataDir, includeVendor: true, includeUnmanaged: true }).entries).toEqual([]);
      expect(existsSync(join(builtin, "SKILL.md"))).toBe(true);
      // The named step works.
      applyAgentIntegration(planAgentIntegration({ ...opts(s), agents: ["codex"], ...(binding === "reviewed" ? { discoveryInputs: freshV3(s) } : {}) }));
      expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe("ACCEPTED");
      expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toBe("ACCEPTED");
    }
  });

  test("F3: the name rule is offered only when it would satisfy the live hook; otherwise the exact-path rule", () => {
    const cases: Record<string, (s: Station) => string> = {
      "no remote install receipt": s => plugin(s, { receipt: false })[0]!,
      "a Hasna marker": s => { const [copy] = plugin(s); put(join(copy!, ".hasna-skills.json"), JSON.stringify({ managedBy: "@hasna/skills" })); return copy!; },
      "a Hasna marker that is not JSON": s => { const [copy] = plugin(s); put(join(copy!, ".hasna-skills.json"), "not json"); return copy!; },
      "a plugin hooks file (refresh-unsafe)": s => { const [copy] = plugin(s, { marketplace: "openai-curated", receipt: false }); put(join(s.cache, "openai-curated", "sites", "1.0.2-remix-b.1", "hooks", "hooks.json"), "{}"); return copy!; },
    };
    for (const [label, make] of Object.entries(cases)) {
      const s = reviewedV3();
      const copy = make(s);
      expect([label, refusal(() => assertManagedAgentBridge("codex", live(s)))]).toEqual([label, PATH_BLOCK(s, copy)]);
      // A name rule would not have worked: the copy still blocks with the same advice.
      append(s, byName("sites:sites-remix"));
      expect([label, refusal(() => assertManagedAgentBridge("codex", live(s)))]).toEqual([label, PATH_BLOCK(s, copy)]);
      // The named exact-path rule does.
      append(s, byPath(copy));
      expect([label, refusal(() => assertManagedAgentBridge("codex", live(s)))]).toEqual([label, "ACCEPTED"]);
      expect([label, refusal(() => assertManagedAgentBridge("codex", opts(s)))]).toEqual([label, "ACCEPTED"]);
    }
  });

  test("F4: on an automatic binding each config-edit step says a re-install follows, and that re-install works", () => {
    // Vendor copy: the name rule satisfies the live hook at once; strict checks need the re-install.
    const s = automatic();
    const [copy] = plugin(s);
    expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toBe(`${VENDOR_BLOCK(s, copy!)}${REINSTALL}`);
    append(s, byName("sites:sites-remix"));
    expect(assertManagedAgentBridge("codex", live(s)).codexInertVendorCopies).toEqual([copy!]);
    expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe(`NATIVE_SKILL_DRIFT: Native discovery input changed; run skills hook install with a fresh discovery review: ${s.config}`);
    applyAgentIntegration(planAgentIntegration({ ...opts(s), agents: ["codex"] }));
    expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe("ACCEPTED");
    expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toBe("ACCEPTED");
    // Other plugin-cache copy: the exact-path rule changes the recorded input for both guards until the re-install.
    const t = automatic();
    const [other] = plugin(t, { marketplace: "acme", receipt: false });
    expect(refusal(() => assertManagedAgentBridge("codex", live(t)))).toBe(`${PATH_BLOCK(t, other!)}${REINSTALL}`);
    append(t, byPath(other!));
    expect(refusal(() => assertManagedAgentBridge("codex", live(t)))).toStartWith("NATIVE_SKILL_DRIFT: Native discovery input changed;");
    applyAgentIntegration(planAgentIntegration({ ...opts(t), agents: ["codex"] }));
    expect(refusal(() => assertManagedAgentBridge("codex", opts(t)))).toBe("ACCEPTED");
    expect(refusal(() => assertManagedAgentBridge("codex", live(t)))).toBe("ACCEPTED");
  });
});

describe("G: every config-edit step, followed as named, clears the refusal on each recorded config witness", () => {
  const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
  // Typed V2-V5 digests ignore disable-only rows; raw, bytes and V1 count them.
  const witnesses = {
    v2: (path: string) => captureCodexSettingsV2(path), v3: (path: string) => captureCodexSettingsV3(path), v4: (path: string) => captureCodexSettingsV4(path), v5: (path: string) => captureCodexSettingsV5(path),
    v1: (path: string) => captureCodexSettings(path), bytes: (path: string) => ({ path, hashMode: "bytes" as const, sha256: sha(readFileSync(path)) }), raw: (path: string) => ({ path, sha256: sha(read(path)) }),
  };
  const typed = ["v2", "v3", "v4", "v5"];
  const reviewedWith = (mode: keyof typeof witnesses, initial = "") => {
    const s = home(`skills-vendor-witness-${mode}-`);
    put(s.config, initial);
    applyAgentIntegration(planAgentIntegration({ ...opts(s), agents: ["codex"], discoveryInputs: { version: 1, agents: [{ agent: "codex", roots: [], sources: [witnesses[mode](s.config) as any], pluginHooks: "reviewed-no-skill-injection" }] } }));
    expect([mode, refusal(() => assertManagedAgentBridge("codex", opts(s)))]).toEqual([mode, "ACCEPTED"]);
    return s;
  };
  const acme = (s: Station) => plugin(s, { marketplace: "acme", name: "tool", version: "1.0.0", skills: ["tool"], receipt: false })[0]!;
  const enablingRow = (name: string) => `[[skills.config]]\nname = ${JSON.stringify(name)}\nenabled = true\n`;
  /** Follow the named follow-up, when there is one, then require both guards to accept. */
  const finish = (s: Station, mode: string, label: string, message: string) => {
    if (message.endsWith(REVIEWED_FOLLOW_UP)) applyAgentIntegration(planAgentIntegration({ ...opts(s), agents: ["codex"], discoveryInputs: freshV3(s) }));
    expect([mode, label, refusal(() => assertManagedAgentBridge("codex", live(s)))]).toEqual([mode, label, "ACCEPTED"]);
    expect([mode, label, refusal(() => assertManagedAgentBridge("codex", opts(s)))]).toEqual([mode, label, "ACCEPTED"]);
  };

  test("the screen-reader receipt Codex writes on launch, which typed witnesses tolerate, adds no follow-up", () => {
    for (const mode of typed as Array<keyof typeof witnesses>) {
      const s = reviewedWith(mode);
      append(s, "[tui]\nscreen_reader_detection_done = true\n");
      const [copy] = plugin(s);
      expect([mode, refusal(() => assertManagedAgentBridge("codex", live(s)))]).toEqual([mode, VENDOR_BLOCK(s, copy!)]);
      append(s, byName("sites:sites-remix"));
      expect([mode, refusal(() => assertManagedAgentBridge("codex", live(s)))]).toEqual([mode, "ACCEPTED"]);
      const t = reviewedWith(mode);
      append(t, "[tui]\nscreen_reader_detection_done = true\n");
      const other = acme(t);
      expect([mode, refusal(() => assertManagedAgentBridge("codex", live(t)))]).toEqual([mode, PATH_BLOCK(t, other)]);
      append(t, byPath(other));
      finish(t, mode, "receipt path", "");
    }
  });

  for (const mode of Object.keys(witnesses) as Array<keyof typeof witnesses>) test(`${mode} witness`, () => {
    const follow = typed.includes(mode) ? "" : REVIEWED_FOLLOW_UP;
    {
      // Vendor copy: the name rule. On a typed witness the live hook accepts it at
      // once; the strict guard, by design, names its own refreshed binding.
      const s = reviewedWith(mode);
      const [copy] = plugin(s);
      const message = refusal(() => assertManagedAgentBridge("codex", live(s)));
      expect([mode, "vendor", message]).toEqual([mode, "vendor", `${VENDOR_BLOCK(s, copy!)}${follow}`]);
      append(s, byName("sites:sites-remix"));
      if (follow) finish(s, mode, "vendor", message);
      else {
        expect([mode, "vendor", refusal(() => assertManagedAgentBridge("codex", live(s)))]).toEqual([mode, "vendor", "ACCEPTED"]);
        expect([mode, "vendor", refusal(() => assertManagedAgentBridge("codex", opts(s)))]).toEqual([mode, "vendor", REFRESH(copy!, STRICT_REASON, "reviewed")]);
      }
    }
    {
      // Non-vendor plugin-cache copy: the exact-path rule.
      const s = reviewedWith(mode);
      const copy = acme(s);
      const message = refusal(() => assertManagedAgentBridge("codex", live(s)));
      expect([mode, "path", message]).toEqual([mode, "path", `${PATH_BLOCK(s, copy)}${follow}`]);
      append(s, byPath(copy));
      finish(s, mode, "path", message);
    }
    for (const [label, enabled, make] of [["enabling rule for the copy", "sites:sites-remix", (s: Station) => plugin(s)[0]!], ["unrelated enabling rule", "other:thing", acme]] as const) {
      // Removing an enabled row changes every witness, so the reviewed binding is always refreshed.
      const s = reviewedWith(mode, enablingRow(enabled));
      const copy = make(s);
      const message = refusal(() => assertManagedAgentBridge("codex", live(s)));
      expect([mode, label, message]).toEqual([mode, label, `${PATH_BLOCK(s, copy)}${FIRST_REMOVE}${REVIEWED_FOLLOW_UP}`]);
      writeFileSync(s.config, read(s.config).replace(enablingRow(enabled), ""));
      append(s, byPath(copy));
      // The edit alone is not enough here; the named follow-up is.
      expect([mode, label, refusal(() => assertManagedAgentBridge("codex", live(s)))]).toEqual([mode, label, `NATIVE_SKILL_DRIFT: Native discovery input changed; run skills hook install with a fresh discovery review: ${s.config}`]);
      finish(s, mode, label, message);
    }
  });
});
