import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureDiscoveryByteSources, rebindAgentDiscovery, verifyAgentDiscovery, type AgentDiscoveryBinding } from "./agent-discovery.js";
import { AGENT_POLICY_LIMITS } from "./agent-policy-limits.js";
import { parseManagedSkillPolicy } from "./managed-policy.js";
import { applyAgentIntegration, planAgentIntegration } from "./agent-integration.js";

const roots: string[] = [];
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function file(bytes: Buffer) { const root = mkdtempSync(join(realpathSync(tmpdir()), "skills-byte-review-")); roots.push(root); const path = join(root, "runtime"); writeFileSync(path, bytes); return path; }
function binding(path: string, sha256: string | null, hashMode: unknown = "bytes"): AgentDiscoveryBinding { return { agent: "codex", method: "reviewed", roots: [], sources: [{ path, sha256, hashMode } as any] }; }

test("raw discovery witnesses accept the SHA256 of invalid UTF8 bytes and reject a different byte sequence", () => {
  const bytes = Buffer.from([0x80, 0x00, 0xff]), path = file(bytes), witness = binding(path, hash(bytes));
  expect(() => verifyAgentDiscovery(witness)).not.toThrow();
  writeFileSync(path, Buffer.from([0x81, 0x00, 0xff]));
  expect(() => verifyAgentDiscovery(witness)).toThrow("discovery input changed");
});

test("raw discovery witnesses support an executable beyond the legacy text input limit", () => {
  const bytes = Buffer.alloc(17 * 1024 * 1024, 0x80), path = file(bytes);
  expect(() => verifyAgentDiscovery(binding(path, hash(bytes)))).not.toThrow();
});

test("unknown discovery hash modes are refused instead of using legacy text hashing", () => {
  const bytes = Buffer.from("fixture"), path = file(bytes);
  expect(() => verifyAgentDiscovery(binding(path, hash(bytes), "unknown"))).toThrow("hash mode");
});

test("legacy omitted-mode witnesses retain their UTF8 decoding contract", () => {
  const bytes = Buffer.from([0x80]), path = file(bytes), witness = binding(path, hash(bytes.toString("utf8")));
  delete witness.sources[0]!.hashMode;
  expect(() => verifyAgentDiscovery(witness)).not.toThrow();
  writeFileSync(path, Buffer.from([0x81]));
  expect(() => verifyAgentDiscovery(witness)).not.toThrow();
  expect(captureDiscoveryByteSources([path])[0]!.sha256).toBe(hash(Buffer.from([0x81])));
});

test("raw capture preserves absent witnesses and rejects projections in runtime and stored policy", () => {
  const path = file(Buffer.from("{}")), missing = path + "-absent", sources = captureDiscoveryByteSources([path, missing]);
  expect(sources).toEqual([{ path, sha256: hash("{}"), hashMode: "bytes" }, { path: missing, sha256: null, hashMode: "bytes" }]);
  const valid = binding(path, hash("{}")), policy = (value: unknown) => JSON.stringify({ loading: "cli", bridge: { discovery: { codex: value } } });
  expect(() => parseManagedSkillPolicy(policy(valid))).not.toThrow();
  for (const projection of [{ format: "json", fields: ["hooks"] }, { fields: [] }]) {
    const invalid = { ...valid, sources: [{ ...valid.sources[0]!, ...projection }] } as AgentDiscoveryBinding;
    expect(() => verifyAgentDiscovery(invalid)).toThrow();
    expect(() => parseManagedSkillPolicy(policy(invalid))).toThrow("collection bounds");
  }
  expect(() => parseManagedSkillPolicy(policy(binding(path, hash("{}"), "unknown")))).toThrow("collection bounds");
  writeFileSync(missing, "new"); expect(() => verifyAgentDiscovery({ ...valid, sources })).toThrow("discovery input changed");
});

test("raw capture bounds paths, collection size, file bytes and aggregate bytes", () => {
  const path = file(Buffer.alloc(0));
  expect(() => captureDiscoveryByteSources([path, path])).toThrow("collection");
  expect(() => captureDiscoveryByteSources(Array(2049).fill(path))).toThrow("collection");
  for (const invalid of ["relative", path + "/../runtime", "/" + "a".repeat(4096), path + "\0"]) expect(() => captureDiscoveryByteSources([invalid])).toThrow("canonical absolute");
  truncateSync(path, AGENT_POLICY_LIMITS.discoveryRawSourceBytes);
  const sources = captureDiscoveryByteSources([path]); expect(sources[0]!.sha256).toHaveLength(64);
  const allowed = { ...binding(path, sources[0]!.sha256), sources: Array(4).fill(sources[0]) };
  expect(() => verifyAgentDiscovery(allowed)).not.toThrow();
  expect(() => verifyAgentDiscovery({ ...allowed, sources: Array(5).fill(sources[0]) })).toThrow("aggregate byte limit");
  truncateSync(path, AGENT_POLICY_LIMITS.discoveryRawSourceBytes + 1);
  expect(() => captureDiscoveryByteSources([path])).toThrow("oversized");
});

test("raw reads refuse directories, symlinks, symlink ancestors and a real FIFO", () => {
  const path = file(Buffer.from("fixture")), root = join(path, "..");
  expect(() => captureDiscoveryByteSources([realpathSync(root)])).toThrow("Unsupported");
  symlinkSync(path, path + "-link"); expect(() => captureDiscoveryByteSources([path + "-link"])).toThrow("symlink");
  symlinkSync(realpathSync(root), path + "-parent"); expect(() => captureDiscoveryByteSources([join(path + "-parent", "runtime")])).toThrow("symlink");
  const created = Bun.spawnSync(["mkfifo", path + "-fifo"]); expect(created.exitCode).toBe(0);
  expect(() => captureDiscoveryByteSources([path + "-fifo"])).toThrow("Unsupported");
});

test("raw owned configuration rebind uses exact planned UTF8 bytes while retaining hash mode", () => {
  const path = file(Buffer.from("before")), witness = binding(path, hash("before")), changes = new Map([[path, "after λ"]]);
  const after = rebindAgentDiscovery(witness, changes);
  expect(after.sources).toEqual([{ path, hashMode: "bytes", sha256: hash("after λ") }]);
  expect(witness.sources[0]!.sha256).toBe(hash("before"));
  writeFileSync(path, "after λ"); expect(() => verifyAgentDiscovery(after)).not.toThrow();
});

test("normal hook planning and installation preserve explicit raw configuration and runtime witnesses", () => {
  const runtime = file(Buffer.from([0x80, 0xff])), home = realpathSync(join(runtime, "..")), dataDir = join(home, ".hasna/skills"), config = join(home, ".codex/config.toml");
  mkdirSync(dataDir, { recursive: true }); admitCorpusFixture(join(home, ".codex")); writeFileSync(config, "");
  const reviewed = { version: 1 as const, agents: [{ agent: "codex" as const, roots: [], sources: captureDiscoveryByteSources([config, runtime]), pluginHooks: "reviewed-no-skill-injection" as const }] };
  const options = { home, dataDir, agents: ["codex" as const], command: "/fixture/skills", discoveryInputs: reviewed };
  const plan = planAgentIntegration(options);
  expect(plan.discoveryAfter?.[0]?.sources.some(source => source.path === runtime && source.hashMode === "bytes")).toBe(true);
  applyAgentIntegration(plan);
  expect(() => verifyAgentDiscovery(plan.discoveryAfter![0]!)).not.toThrow();
});

test("binary source drift refuses an approved plan before native bridge writes", () => {
  const runtime = file(Buffer.from([0x80])), home = realpathSync(join(runtime, "..")), dataDir = join(home, ".hasna/skills"), config = join(home, ".codex/config.toml");
  mkdirSync(dataDir, { recursive: true }); admitCorpusFixture(join(home, ".codex")); writeFileSync(config, "");
  const reviewed = { version: 1 as const, agents: [{ agent: "codex" as const, roots: [], sources: captureDiscoveryByteSources([config, runtime]), pluginHooks: "reviewed-no-skill-injection" as const }] };
  const plan = planAgentIntegration({ home, dataDir, agents: ["codex"], command: "/fixture/skills", discoveryInputs: reviewed });
  writeFileSync(runtime, Buffer.from([0x81]));
  expect(() => applyAgentIntegration(plan)).toThrow("discovery input changed");
  expect(existsSync(join(home, ".codex/skills/skills-cli/SKILL.md"))).toBe(false);
});

test("raw file reads reject actual path replacement, FIFO and concurrent growth without hanging", () => {
  const script = file(Buffer.from(`
import { mock } from "bun:test";
import * as original from "node:fs";
const fs = { ...original }, [target, mode, modulePath] = process.argv.slice(2); let changed = false;
mock.module("node:fs", () => ({ ...fs,
  openSync(path, ...args) {
    if (String(path) === target && !changed && mode !== "growth") {
      changed = true; fs.renameSync(target, target + "-original");
      if (mode === "fifo") { if (Bun.spawnSync(["mkfifo", target]).exitCode !== 0) throw Error("fixture FIFO failed"); }
      else if (mode === "symlink") fs.symlinkSync(target + "-original", target);
      else fs.writeFileSync(target, "fixture");
    }
    return fs.openSync(path, ...args);
  },
  readSync(...args) {
    const count = fs.readSync(...args);
    if (mode === "growth" && !changed) { changed = true; fs.truncateSync(target, 64 * 1024 * 1024 + 1); }
    return count;
  }
}));
const { hashRawDiscoveryFile, discoveryByteBudget } = await import(modulePath);
let refused = false; try { hashRawDiscoveryFile(target, discoveryByteBudget()); } catch { refused = true; }
process.stdout.write(JSON.stringify({ changed, refused }));
process.exitCode = changed && refused ? 0 : 2;
`));
  const modulePath = new URL("./agent-discovery-bytes.ts", import.meta.url).href;
  for (const mode of ["replacement", "fifo", "symlink", "growth"]) {
    const path = file(Buffer.from("fixture"));
    const result = Bun.spawnSync([process.execPath, "--no-env-file", script, path, mode, modulePath], { timeout: 5000, env: { PATH: process.env.PATH!, HOME: process.env.HOME! } });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({ changed: true, refused: true });
  }
});

test("rebinding a reviewed raw source cannot refresh drift outside planned writes", () => {
  const home = mkdtempSync(join(tmpdir(), "skills-rebind-drift-"));
  try {
    const path = join(home, "reviewed.js"); writeFileSync(path, "// Reviewed source\n");
    const binding: AgentDiscoveryBinding = { agent: "claude", method: "reviewed", roots: [], sources: captureDiscoveryByteSources([path]) };
    writeFileSync(path, "// Unreviewed replacement\n");
    expect(() => rebindAgentDiscovery(binding, new Map())).toThrow("fresh discovery review");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
