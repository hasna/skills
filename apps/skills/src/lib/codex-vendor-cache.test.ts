import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, lstatSync, statSync, existsSync } from "node:fs";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
import { planAgentIntegration, applyAgentIntegration, assertManagedAgentBridge } from "./agent-integration.js";
import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { CODEX_VENDOR_CACHE_ROOT_SEGMENTS, CODEX_VENDOR_CACHE_RECEIPT_SCHEMA, codexVendorCacheRoot, codexVendorCacheReceiptPath, isAcceptedCodexVendorCacheSkill, readCodexVendorCacheAcceptance } from "./codex-vendor-cache.js";
useDefaultTestTimeout();
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); });
const roots: string[] = []; afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const put = (p: string, s: string) => { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, s); };
const VENDOR = join(".codex", "plugins", "cache", "openai-curated-remote");
const payload = (name: string) => `---\nname: ${name}\ndescription: Synthetic vendor cache fixture\n---\nSynthetic native instructions\n`;

/** A temp home with the Codex bridge installed before any vendor content appears,
 * matching a station where Codex refreshes its plugin cache after `skills hook install`. */
function installedHome(prefix: string) {
  const home = mkdtempSync(join(tmpdir(), prefix)); roots.push(home); admitCorpusFixture(join(home, ".codex"));
  const f = { home, dataDir: join(home, "data"), projectDir: home };
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["codex"] }));
  expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
  return { home, f };
}
/** Materialize a remote plugin the way Codex does: <plugin>/<version>/skills/<x>/SKILL.md plus its receipts. */
function addPlugin(home: string, vendorDir: string, plugin: string, version: string | null, skills: string[]): string[] {
  const parent = join(home, vendorDir, plugin), root = version ? join(parent, version) : parent;
  put(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({ name: plugin, version: version ?? "0.0.0", description: "Synthetic plugin" }));
  put(join(parent, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: `plugins~Plugin_${plugin.padEnd(32, "0").slice(0, 32)}` }));
  return skills.map(name => { put(join(root, "skills", name, "SKILL.md"), payload(name)); return join(root, "skills", name); });
}

test("skills Codex materializes under exactly ~/.codex/plugins/cache/openai-curated-remote are accepted with a provenance receipt", () => {
  const { home, f } = installedHome("skills-vendor-cache-accept-");
  const versioned = addPlugin(home, VENDOR, "sites", "0.1.75", ["sites-building", "sites-hosting", "sites-mcp", "sites-preview-troubleshooting"]);
  const flat = addPlugin(home, VENDOR, "pets", null, ["pets"]);
  const receipt = codexVendorCacheReceiptPath(f.dataDir);
  expect(existsSync(receipt)).toBe(false);
  expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
  const recorded = readCodexVendorCacheAcceptance(f.dataDir);
  expect(recorded?.schema).toBe(CODEX_VENDOR_CACHE_RECEIPT_SCHEMA);
  expect(recorded?.root).toBe(join(home, VENDOR));
  expect(recorded?.entries.map(entry => entry.path).sort()).toEqual([...versioned, ...flat].sort());
  for (const entry of recorded!.entries) expect(entry.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(Date.parse(recorded!.acceptedAt)).toBeGreaterThan(0);
  expect(statSync(receipt).mode & 0o077).toBe(0);
  // An unchanged acceptance set is idempotent: the receipt bytes stay as written.
  const bytes = readFileSync(receipt, "utf8");
  expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
  expect(readFileSync(receipt, "utf8")).toBe(bytes);
  // A changed vendor payload is re-accepted with its new hash recorded.
  put(join(versioned[0]!, "SKILL.md"), payload("sites-building").replace("Synthetic native instructions", "Refreshed native instructions"));
  expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
  const refreshed = readCodexVendorCacheAcceptance(f.dataDir)!;
  expect(refreshed.entries.find(entry => entry.path === versioned[0])!.hash).not.toBe(recorded!.entries.find(entry => entry.path === versioned[0])!.hash);
});

test("the vendor cache acceptance never widens the guard: every other path still stops the session", () => {
  const cases: Array<[string, (home: string) => void]> = [
    ["sibling plugin cache vendor", home => { addPlugin(home, join(".codex", "plugins", "cache", "other-vendor"), "sites", "0.1.75", ["sites-building"]); }],
    ["lookalike prefix", home => { addPlugin(home, join(".codex", "plugins", "cache", "openai-curated-remote-evil"), "sites", "0.1.75", ["sites-building"]); }],
    ["lookalike suffix-less parent", home => { addPlugin(home, join(".codex", "plugins", "cache", "openai-curated"), "remote", "0.1.0", ["sites-building"]); }],
    ["case variant", home => { addPlugin(home, join(".codex", "plugins", "cache", "OpenAI-Curated-Remote"), "sites", "0.1.75", ["sites-building"]); }],
    ["unicode lookalike", home => { addPlugin(home, join(".codex", "plugins", "cache", "openai-curated-remotе"), "sites", "0.1.75", ["sites-building"]); }],
    ["other Codex skill root", home => { put(join(home, ".codex", "skills", "sites-building", "SKILL.md"), payload("sites-building")); }],
    ["shared agents skill root", home => { put(join(home, ".agents", "skills", "sites-building", "SKILL.md"), payload("sites-building")); }],
    ["vendor name nested below another cache entry", home => { addPlugin(home, join(".codex", "plugins", "cache", "nested", "openai-curated-remote"), "sites", "0.1.75", ["sites-building"]); }],
    ["sibling marketplace seen on station04", home => { addPlugin(home, join(".codex", "plugins", "cache", "openai-primary-runtime"), "sites", "0.1.75", ["sites-building"]); }],
    ["vendor root replaced by a symlink", home => {
      addPlugin(home, join("outside", "openai-curated-remote"), "sites", "0.1.75", ["sites-building"]);
      mkdirSync(join(home, ".codex", "plugins", "cache"), { recursive: true });
      symlinkSync(join(home, "outside", "openai-curated-remote"), join(home, VENDOR));
    }],
    ["plugin directory symlink escaping the vendor tree", home => {
      addPlugin(home, "outside", "sites", "0.1.75", ["sites-building"]);
      mkdirSync(join(home, VENDOR), { recursive: true });
      symlinkSync(join(home, "outside", "sites"), join(home, VENDOR, "sites"));
    }],
    ["skill directory symlink escaping the vendor tree", home => {
      const [skill] = addPlugin(home, "outside", "sites", "0.1.75", ["sites-building"]);
      mkdirSync(join(home, VENDOR, "sites", "0.1.75", "skills"), { recursive: true });
      symlinkSync(skill!, join(home, VENDOR, "sites", "0.1.75", "skills", "sites-building"));
    }],
    ["SKILL.md symlink escaping the vendor tree", home => {
      put(join(home, "outside", "SKILL.md"), payload("sites-building"));
      mkdirSync(join(home, VENDOR, "sites", "0.1.75", "skills", "sites-building"), { recursive: true });
      symlinkSync(join(home, "outside", "SKILL.md"), join(home, VENDOR, "sites", "0.1.75", "skills", "sites-building", "SKILL.md"));
    }],
    ["accepted vendor content beside a rogue copy", home => {
      addPlugin(home, VENDOR, "sites", "0.1.75", ["sites-building"]);
      put(join(home, ".codex", "skills", "rogue", "SKILL.md"), payload("rogue"));
    }],
  ];
  for (const [label, arrange] of cases) {
    const { home, f } = installedHome("skills-vendor-cache-refuse-");
    arrange(home);
    let failure: unknown;
    try { assertManagedAgentBridge("codex", f); } catch (error) { failure = error; }
    expect(failure, label).toBeInstanceOf(Error);
    expect((failure as Error).message, label).toMatch(/NATIVE_SKILL_DRIFT|Refusing symlink/);
    expect(existsSync(codexVendorCacheReceiptPath(f.dataDir)), label).toBe(false);
  }
});

test("a home reached through a symlink or spelled differently is not the bound home", () => {
  const { home, f } = installedHome("skills-vendor-cache-home-");
  addPlugin(home, VENDOR, "sites", "0.1.75", ["sites-building"]);
  expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
  const outer = mkdtempSync(join(tmpdir(), "skills-vendor-cache-home-link-")); roots.push(outer);
  symlinkSync(home, join(outer, "home"));
  expect(() => assertManagedAgentBridge("codex", { ...f, home: join(outer, "home") })).toThrow(/NATIVE_SKILL_DRIFT|Refusing symlink/);
  expect(() => assertManagedAgentBridge("codex", { ...f, home: join(outer, "home", "..", "home") })).toThrow(/NATIVE_SKILL_DRIFT|Refusing symlink/);
});

test("vendor cache containment resolves real paths and refuses every lexical escape", () => {
  const home = mkdtempSync(join(tmpdir(), "skills-vendor-cache-contain-")); roots.push(home);
  const root = codexVendorCacheRoot(home);
  expect(root).toBe(join(home, ...CODEX_VENDOR_CACHE_ROOT_SEGMENTS));
  expect(codexVendorCacheRoot(`${home}${sep}`)).toBe(root);
  expect(codexVendorCacheRoot(join(home, "x", ".."))).toBe(root);
  const [skill] = addPlugin(home, VENDOR, "sites", "0.1.75", ["sites-building"]);
  const entry = (path: string, overrides: Partial<{ agent: string; vendor: boolean }> = {}) => ({ agent: "codex", vendor: true, path, hash: "0".repeat(64), managed: false, ...overrides });
  expect(isAcceptedCodexVendorCacheSkill(entry(skill!), root)).toBe(true);
  expect(isAcceptedCodexVendorCacheSkill(entry(skill!, { agent: "claude" }), root)).toBe(false);
  expect(isAcceptedCodexVendorCacheSkill(entry(skill!, { vendor: false }), root)).toBe(false);
  expect(isAcceptedCodexVendorCacheSkill(entry(root), root)).toBe(false);
  expect(isAcceptedCodexVendorCacheSkill(entry(join(root, "sites")), root)).toBe(false);
  // Lexical escapes: a parent reference, a sibling root and a lookalike prefix.
  addPlugin(home, join(".codex", "plugins", "cache", "other-vendor"), "sites", "0.1.75", ["sites-building"]);
  addPlugin(home, join(".codex", "plugins", "cache", "openai-curated-remote-evil"), "sites", "0.1.75", ["sites-building"]);
  expect(isAcceptedCodexVendorCacheSkill(entry(join(root, "..", "other-vendor", "sites", "0.1.75", "skills", "sites-building")), root)).toBe(false);
  expect(isAcceptedCodexVendorCacheSkill(entry(join(root, "sites", "..", "..", "other-vendor", "sites", "0.1.75", "skills", "sites-building")), root)).toBe(false);
  expect(isAcceptedCodexVendorCacheSkill(entry(`${root}-evil${sep}sites${sep}0.1.75${sep}skills${sep}sites-building`), root)).toBe(false);
  expect(isAcceptedCodexVendorCacheSkill(entry(join(home, ".codex", "plugins", "cache", "other-vendor", "sites", "0.1.75", "skills", "sites-building")), root)).toBe(false);
  expect(isAcceptedCodexVendorCacheSkill(entry(`${skill}${sep}`), root)).toBe(false);
  expect(isAcceptedCodexVendorCacheSkill(entry(skill!), `${root}${sep}`)).toBe(false);
  expect(isAcceptedCodexVendorCacheSkill(entry(skill!), join(root, ".."))).toBe(false);
  // A real path escape: the same skill reached through a symlinked plugin directory.
  const linked = join(root, "linked");
  symlinkSync(join(home, ".codex", "plugins", "cache", "other-vendor", "sites"), linked);
  expect(lstatSync(linked).isSymbolicLink()).toBe(true);
  expect(isAcceptedCodexVendorCacheSkill(entry(join(linked, "0.1.75", "skills", "sites-building")), root)).toBe(false);
  // The vendor root itself must be a real directory with exactly that on-disk name.
  rmSync(root, { recursive: true, force: true });
  symlinkSync(join(home, ".codex", "plugins", "cache", "other-vendor"), root);
  expect(isAcceptedCodexVendorCacheSkill(entry(join(root, "sites", "0.1.75", "skills", "sites-building")), root)).toBe(false);
});
