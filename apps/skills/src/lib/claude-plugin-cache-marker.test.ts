import { afterEach, expect, spyOn, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { captureDiscoveryByteSources, captureDiscoveryDirectories, captureDiscoveryPathSources, verifyAgentDiscovery, type AgentDiscoveryBinding, type DiscoverySource } from "./agent-discovery.js";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration } from "./agent-integration.js";
import { parseManagedSkillPolicy } from "./managed-policy.js";
import { snapshotPluginTree } from "./plugin-projection-store.js";
import { pluginFileWitnesses } from "./plugin-projection.js";

// Deliberately not imported from the implementation, so this file also runs
// against a build without the typed marker (the negative control).
const MODE = "claude-plugin-orphaned-at-v1";
const timestamp = "1791981120000", rewritten = "1791981121000";
const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
const put = (path: string, body: string | Buffer) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body, { mode: 0o644 }); };
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
type Capture = "path-bytes" | "bytes" | "legacy";

/** A retired (orphaned) and an active version of one enabled cache plugin,
 * each carrying the Claude-written version-root marker. */
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "skills-claude-orphan-marker-")); homes.push(home);
  const claude = join(home, ".claude"), parent = join(claude, "plugins/cache/market/plugin");
  const retired = join(parent, "1.0.0"), active = join(parent, "2.0.0");
  const settings = join(claude, "settings.json"), registry = join(claude, "plugins/installed_plugins.json");
  put(settings, JSON.stringify({ enabledPlugins: { "plugin@market": true } }));
  put(registry, JSON.stringify({ version: 2, plugins: { "plugin@market": [{ scope: "user", installPath: active, version: "2.0.0" }] } }));
  for (const root of [retired, active]) {
    put(join(root, ".claude-plugin/plugin.json"), JSON.stringify({ name: "plugin", version: basename(root) }));
    mkdirSync(join(root, "skills"), { recursive: true });
    put(join(root, ".orphaned_at"), timestamp);
  }
  const markers = [join(retired, ".orphaned_at"), join(active, ".orphaned_at")];
  const options = { home, dataDir: join(home, "skills-data"), projectDir: home, agents: ["claude" as const], command: "/fixture/skills" };
  const policy = () => JSON.parse(readFileSync(join(options.dataDir, "agent-policy.json"), "utf8")).bridge.discovery.claude;
  /** Review exactly as a reviewer would: markers captured by the selected tool. */
  const install = (capture: Capture) => {
    const files = [settings, registry, ...[retired, active].map(root => join(root, ".claude-plugin/plugin.json"))];
    const markerSources: DiscoverySource[] = capture === "path-bytes" ? captureDiscoveryPathSources(markers)
      : capture === "bytes" ? captureDiscoveryByteSources(markers)
      : markers.map(path => ({ path, sha256: sha(readFileSync(path, "utf8")) }));
    applyAgentIntegration(planAgentIntegration({ ...options, discoveryInputs: { version: 1, agents: [{
      agent: "claude", roots: [join(retired, "skills"), join(active, "skills")], pluginHooks: "reviewed-no-skill-injection",
      sources: [...captureDiscoveryByteSources(files), ...markerSources], directories: captureDiscoveryDirectories([active]),
    }] } }));
  };
  const check = () => assertManagedAgentBridge("claude", options);
  return { home, retired, active, markers, options, policy, install, check };
}

test.each(["path-bytes", "bytes", "legacy"] as const)("a %s reviewed marker survives Claude rewriting its timestamp at every start", capture => {
  const f = fixture();
  f.install(capture);
  expect(() => f.check()).not.toThrow();
  // Claude rewrites the 13-byte timestamp in place on start...
  for (const marker of f.markers) put(marker, rewritten);
  expect(() => f.check()).not.toThrow();
  expect(f.markers.map(path => f.policy().sources.find((source: DiscoverySource) => source.path === path)?.hashMode)).toEqual([MODE, MODE]);
  // ...and may also replace the file's inode.
  put(join(f.home, "next-marker"), "1791981122000"); renameSync(join(f.home, "next-marker"), f.markers[1]!);
  expect(() => f.check()).not.toThrow();
  // A retained reinstall keeps the typed witnesses rather than re-adopting bytes.
  const stored = f.policy().sources;
  applyAgentIntegration(planAgentIntegration(f.options));
  expect(f.policy().sources).toEqual(stored);
  expect(() => f.check()).not.toThrow();
  // Claude later prunes the orphaned version; the retired-root exemption still holds.
  renameSync(f.retired, join(f.home, "preserved-retired"));
  expect(() => f.check()).not.toThrow();
  // A different new file next to the marker is still membership drift.
  put(join(f.active, "unreviewed.txt"), "new capability input");
  expect(() => f.check()).toThrow("NATIVE_SKILL_DRIFT");
});

const mutations: Record<string, (marker: string, home: string) => void> = {
  "malformed text": marker => put(marker, "not-a-timestamp"),
  "leading zero": marker => put(marker, "0791981120000"),
  "trailing newline": marker => put(marker, timestamp + "\n"),
  "byte-order mark": marker => put(marker, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(timestamp)])),
  "non-ASCII digits": marker => put(marker, Buffer.alloc(13, 0xb1)),
  oversized: marker => put(marker, "1".repeat(33)),
  symlink: (marker, home) => { put(join(home, "elsewhere"), timestamp); rmSync(marker); symlinkSync(join(home, "elsewhere"), marker); },
  directory: marker => { rmSync(marker); mkdirSync(marker); },
  removed: marker => rmSync(marker),
};
test.each(Object.keys(mutations))("a %s marker still refuses after review", name => {
  const f = fixture(), marker = f.markers[1]!;
  f.install("path-bytes");
  expect(() => f.check()).not.toThrow();
  mutations[name]!(marker, f.home);
  expect(() => f.check()).toThrow("NATIVE_SKILL_DRIFT");
  // A typed capture also refuses invalid content rather than binding it.
  if (name !== "removed") {
    expect(() => captureDiscoveryPathSources([marker])).toThrow();
    expect(() => captureDiscoveryByteSources([marker])).toThrow();
  }
  rmSync(marker, { recursive: true, force: true }); put(marker, timestamp);
  expect(() => f.check()).not.toThrow();
});

test("a marker owned by another user refuses", () => {
  const f = fixture(), marker = f.markers[1]!;
  const binding: AgentDiscoveryBinding = { agent: "claude", method: "reviewed", roots: [], sources: captureDiscoveryPathSources([marker]) };
  expect(binding.sources[0]!.hashMode).toBe(MODE);
  const uid = process.getuid!(), mocked = spyOn(process, "getuid").mockReturnValue(uid + 1);
  try {
    expect(() => captureDiscoveryPathSources([marker])).toThrow("orphan marker file or owner");
    expect(() => verifyAgentDiscovery(binding)).toThrow("orphan marker file or owner");
  } finally { mocked.mockRestore(); }
  expect(() => verifyAgentDiscovery(binding)).not.toThrow();
});

test("other depths, other names and Skills producer trees keep exact byte witnesses", () => {
  const f = fixture(), cache = join(f.home, ".claude/plugins/cache");
  const paths = [
    join(cache, ".orphaned_at"), join(cache, "market/.orphaned_at"), join(cache, "market/plugin/.orphaned_at"),
    join(f.active, "skills/.orphaned_at"), join(f.active, "vendor/.claude/plugins/cache/a/b/c/.orphaned_at"),
    join(f.active, ".orphaned_at.tmp"), join(f.active, "orphaned_at"), join(f.home, "skills-data/plugins/producer/1.0.0/.orphaned_at"),
  ];
  for (const path of paths) {
    put(path, timestamp);
    const bytes = captureDiscoveryByteSources([path]), traced = captureDiscoveryPathSources([path]);
    expect([bytes[0]!.hashMode, traced[0]!.hashMode]).toEqual(["bytes", "path-bytes"]);
    put(path, rewritten);
    for (const sources of [bytes, traced]) expect(() => verifyAgentDiscovery({ agent: "claude", method: "reviewed", roots: [], sources })).toThrow("Native discovery input changed");
    // Nor can a stored policy claim the typed mode for such a path.
    const forged: AgentDiscoveryBinding = { agent: "claude", method: "reviewed", roots: [], sources: [{ path, hashMode: MODE, sha256: sha(path) }] };
    expect(() => verifyAgentDiscovery(forged)).toThrow();
    expect(() => parseManagedSkillPolicy(JSON.stringify({ loading: "cli", bridge: { discovery: { claude: forged } } }))).toThrow();
  }
});

test("the typed marker mode is limited to reviewed Claude discovery", () => {
  const f = fixture();
  const valid: AgentDiscoveryBinding = { agent: "claude", method: "reviewed", roots: [], sources: captureDiscoveryPathSources([f.markers[1]!]) };
  expect(() => parseManagedSkillPolicy(JSON.stringify({ loading: "cli", bridge: { discovery: { claude: valid } } }))).not.toThrow();
  for (const patch of [{ agent: "codex" }, { method: "automatic" }, { sources: [{ ...valid.sources[0]!, format: "json", fields: ["hooks"] }] }] as Partial<AgentDiscoveryBinding>[]) {
    const invalid = { ...valid, ...patch } as AgentDiscoveryBinding;
    expect(() => verifyAgentDiscovery(invalid)).toThrow();
    expect(() => parseManagedSkillPolicy(JSON.stringify({ loading: "cli", bridge: { discovery: { [invalid.agent]: invalid } } }))).toThrow();
  }
});

test.each(["claude-2.1.274", "claude-2.1.276"] as const)("%s managed-cache snapshots apply the same strict marker rule", nativeRuntime => {
  const f = fixture(), root = join(f.home, ".claude/plugins/cache/market/managed/1.0.0"), marker = join(root, ".orphaned_at");
  put(join(root, ".claude-plugin/plugin.json"), JSON.stringify({ name: "managed" })); put(marker, timestamp);
  const before = pluginFileWitnesses(snapshotPluginTree(root, { nativeRuntime }));
  put(marker, rewritten);
  expect(pluginFileWitnesses(snapshotPluginTree(root, { nativeRuntime }))).toEqual(before);
  for (const invalid of [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(timestamp)]), timestamp + "\n", "not-a-timestamp"]) {
    put(marker, invalid);
    expect(() => snapshotPluginTree(root, { nativeRuntime })).toThrow();
  }
});
