import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as discovery from "./agent-discovery.js";
import { parseManagedSkillPolicy } from "./managed-policy.js";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration } from "./agent-integration.js";

const roots: string[] = [];
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
function root() { const path = mkdtempSync(join(realpathSync(tmpdir()), "skills-path-")); roots.push(path); return path; }
const capture = (paths: string[]) => (discovery as any).captureDiscoveryPathSources(paths) as discovery.DiscoverySource[];
const binding = (sources: discovery.DiscoverySource[]): discovery.AgentDiscoveryBinding => ({ agent: "codex", method: "reviewed", roots: [], sources });
const verify = (sources: discovery.DiscoverySource[]) => discovery.verifyAgentDiscovery(binding(sources));

test("explicit path witnesses accept unchanged binary aliases while raw bytes still refuse links", () => {
  const dir = root(), target = join(dir, "binary"), link = join(dir, "launcher");
  writeFileSync(target, Buffer.from([0x80, 0, 0xff])); symlinkSync("binary", link);
  const sources = capture([link]);
  expect(sources[0]!.hashMode).toBe("path-bytes"); expect(sources[0]!.sha256).toHaveLength(64);
  expect(() => verify(sources)).not.toThrow();
  expect(() => discovery.captureDiscoveryByteSources([link])).toThrow("symlink");
  expect(() => parseManagedSkillPolicy(JSON.stringify({ loading: "cli", bridge: { discovery: { codex: binding(sources) } } }))).not.toThrow();
});

test("retargeting to identical bytes or recreating the same link invalidates its path witness", () => {
  const dir = root(), link = join(dir, "launcher");
  writeFileSync(join(dir, "one"), "same"); writeFileSync(join(dir, "two"), "same"); symlinkSync("one", link);
  const before = capture([link]); unlinkSync(link); symlinkSync("two", link);
  expect(() => verify(before)).toThrow("discovery input changed");
  const second = capture([link]); renameSync(link, link + "-preserved"); symlinkSync("two", link);
  expect(() => verify(second)).toThrow("discovery input changed");
});

test("an ancestor alias retarget to an identical executable is refused", () => {
  const dir = root(), link = join(dir, "current");
  for (const name of ["one", "two"]) { mkdirSync(join(dir, name)); writeFileSync(join(dir, name, "python"), "same"); }
  symlinkSync("one", link); const sources = capture([join(link, "python")]);
  unlinkSync(link); symlinkSync("two", link); expect(() => verify(sources)).toThrow("discovery input changed");
});

test("path witnesses retain raw binary exactness and regular versus link identity", () => {
  const dir = root(), file = join(dir, "runtime"); writeFileSync(file, Buffer.from([0x80]));
  const sources = capture([file]); writeFileSync(file, Buffer.from([0x81])); expect(() => verify(sources)).toThrow("discovery input changed");
  const current = capture([file]); renameSync(file, file + "-target"); symlinkSync("runtime-target", file);
  expect(() => verify(current)).toThrow("discovery input changed");
});

test("missing inputs bind ancestor identity and missing symlink destinations", () => {
  const dir = root(), parent = join(dir, "parent"), link = join(dir, "launcher"); mkdirSync(parent); symlinkSync("parent/missing-one", link);
  const absent = capture([link]); expect(absent[0]!.sha256).toHaveLength(64); expect(() => verify(absent)).not.toThrow();
  unlinkSync(link); symlinkSync("parent/missing-two", link); expect(() => verify(absent)).toThrow("discovery input changed");
  const direct = capture([join(parent, "absent")]); renameSync(parent, parent + "-old"); mkdirSync(parent);
  expect(() => verify(direct)).toThrow("discovery input changed");
});

test("relative parent components resolve after intermediate aliases as the kernel does", () => {
  const dir = root(); mkdirSync(join(dir, "nested", "deep"), { recursive: true });
  writeFileSync(join(dir, "binary"), "wrong"); writeFileSync(join(dir, "nested", "binary"), "actual");
  symlinkSync("nested/deep", join(dir, "alias")); symlinkSync("alias/../binary", join(dir, "launcher"));
  const sources = capture([join(dir, "launcher")]); writeFileSync(join(dir, "binary"), "irrelevant"); expect(() => verify(sources)).not.toThrow();
  writeFileSync(join(dir, "nested", "binary"), "changed"); expect(() => verify(sources)).toThrow("discovery input changed");
});

test("path witnesses refuse non-files, link cycles, excessive hops, malformed collections and oversized bytes", () => {
  const dir = root(), file = join(dir, "file"); writeFileSync(file, "fixture");
  expect(() => capture([dir])).toThrow("Unsupported");
  symlinkSync("cycle", join(dir, "cycle")); expect(() => capture([join(dir, "cycle")])).toThrow("limit");
  symlinkSync("./".repeat(256) + "file", join(dir, "steps")); expect(() => capture([join(dir, "steps")])).toThrow("step limit");
  symlinkSync("file/../file", join(dir, "not-directory")); expect(() => capture([join(dir, "not-directory")])).toThrow("Unsupported");
  for (let n = 0; n < 41; n++) symlinkSync(n === 40 ? "file" : "link-" + (n + 1), join(dir, "link-" + n));
  expect(() => capture([join(dir, "link-0")])).toThrow("limit");
  expect(Bun.spawnSync(["mkfifo", join(dir, "fifo")]).exitCode).toBe(0); expect(() => capture([join(dir, "fifo")])).toThrow("Unsupported");
  for (const bad of ["relative", file + "/../file", file + "\0", "/" + "a".repeat(4096)]) expect(() => capture([bad])).toThrow("canonical absolute");
  expect(() => capture([file, file])).toThrow("collection");
  truncateSync(file, 64 * 1024 * 1024 + 1); expect(() => capture([file])).toThrow("oversized");
});

test("path witnesses refuse non-UTF8 link targets and malformed Unicode input paths", () => {
  const dir = root(), link = join(dir, "launcher"), raw = Buffer.from([0xff]);
  // Link text can contain raw bytes even where filenames must be valid UTF-8.
  symlinkSync(raw, link);
  expect(readlinkSync(link, { encoding: "buffer" }).equals(raw)).toBe(true);
  expect(() => capture([link])).toThrow("non-UTF8 discovery link target");
  expect(() => capture([dir + "/\ud800"])).toThrow("canonical absolute discovery path");
});

test("path witnesses share the existing aggregate raw-byte budget", () => {
  const dir = root(), file = join(dir, "file"); writeFileSync(file, ""); truncateSync(file, 64 * 1024 * 1024);
  const source = capture([file])[0]!; expect(() => verify(Array(4).fill(source))).not.toThrow();
  expect(() => verify(Array(5).fill(source))).toThrow("aggregate byte limit");
});

test("path witnesses refuse projected configuration and planned replacement through an alias", () => {
  const dir = root(), file = join(dir, "file"), link = join(dir, "link"); writeFileSync(file, "{}"); symlinkSync("file", link);
  const sources = capture([link]);
  for (const extras of [{ format: "json", fields: ["hooks"] }, { fields: [] }, { sha256: null }]) {
    const invalid = [{ ...sources[0], ...extras }] as discovery.DiscoverySource[];
    expect(() => verify(invalid)).toThrow();
    expect(() => parseManagedSkillPolicy(JSON.stringify({ loading: "cli", bridge: { discovery: { codex: binding(invalid) } } }))).toThrow();
  }
  expect(() => discovery.rebindAgentDiscovery(binding(sources), new Map([[file, "after"]]))).toThrow("planned write");
  expect(() => discovery.rebindAgentDiscovery(binding(sources), new Map([[link, "after"]]))).toThrow("planned write");
});

test("planned writes cannot create a missing alias ancestor but allow unrelated sibling paths", () => {
  const dir = root(), missing = join(dir, "missing-parent"), link = join(dir, "launcher");
  symlinkSync("missing-parent/child/file", link);
  const absent = binding(capture([link]));
  for (const target of [missing, join(missing, "child"), join(missing, "child/file"), join(missing, "other")]) {
    expect(() => discovery.rebindAgentDiscovery(absent, new Map([[target, "planned"]]))).toThrow("planned write");
  }
  expect(existsSync(missing)).toBe(false);
  const neighbor = join(dir, "missing-parent-neighbor"), unrelated = join(neighbor, "file");
  const unchanged = discovery.rebindAgentDiscovery(absent, new Map([[unrelated, "unrelated"]]));
  mkdirSync(neighbor); writeFileSync(unrelated, "unrelated");
  expect(() => discovery.verifyAgentDiscovery(unchanged)).not.toThrow();

  const existing = join(dir, "existing"), existingLink = join(dir, "existing-launcher");
  mkdirSync(existing); writeFileSync(join(existing, "file"), "retained"); symlinkSync("existing/file", existingLink);
  const sibling = join(existing, "sibling");
  const retained = discovery.rebindAgentDiscovery(binding(capture([existingLink])), new Map([[sibling, "unrelated"]]));
  writeFileSync(sibling, "unrelated");
  expect(() => discovery.verifyAgentDiscovery(retained)).not.toThrow();
  expect(readFileSync(join(existing, "file"), "utf8")).toBe("retained");
});

test("normal bridge plans preserve explicit aliases and refuse retargeting before any native write", () => {
  const home = root(), config = join(home, ".codex/config.toml"), target = join(home, "runtime"), link = join(home, "launcher");
  admitCorpusFixture(join(home, ".codex")); writeFileSync(config, ""); writeFileSync(target, "binary"); symlinkSync("runtime", link);
  const review = { version: 1 as const, agents: [{ agent: "codex" as const, roots: [], sources: [...discovery.captureDiscoveryByteSources([config]), ...capture([link])], pluginHooks: "reviewed-no-skill-injection" as const }] };
  const plan = planAgentIntegration({ home, dataDir: join(home, ".hasna/skills"), agents: ["codex"], command: "/fixture/skills", discoveryInputs: review });
  renameSync(link, link + "-old"); symlinkSync("runtime", link);
  expect(() => applyAgentIntegration(plan)).toThrow("discovery input changed");
  expect(existsSync(join(home, ".codex/skills/skills-cli/SKILL.md"))).toBe(false);
});

test("normal installed hook guard continuously checks an explicit launcher path", () => {
  const home = root(), config = join(home, ".codex/config.toml"), target = join(home, "runtime"), link = join(home, "launcher"), dataDir = join(home, ".hasna/skills");
  admitCorpusFixture(join(home, ".codex")); writeFileSync(config, ""); writeFileSync(target, "binary"); symlinkSync("runtime", link);
  const review = { version: 1 as const, agents: [{ agent: "codex" as const, roots: [], sources: [...discovery.captureDiscoveryByteSources([config]), ...capture([link])], pluginHooks: "reviewed-no-skill-injection" as const }] };
  applyAgentIntegration(planAgentIntegration({ home, dataDir, agents: ["codex"], command: "/fixture/skills", discoveryInputs: review }));
  expect(() => assertManagedAgentBridge("codex", { home, dataDir, projectDir: home })).not.toThrow();
  renameSync(link, link + "-old"); symlinkSync("runtime", link);
  expect(() => assertManagedAgentBridge("codex", { home, dataDir, projectDir: home })).toThrow("discovery input changed");
});

test("post-write alias drift compensates owned bridge files and preserves the new external link", () => {
  const home = root(), config = join(home, ".codex/config.toml"), target = join(home, "runtime"), link = join(home, "launcher"), dataDir = join(home, ".hasna/skills");
  admitCorpusFixture(join(home, ".codex")); writeFileSync(config, ""); writeFileSync(target, "binary"); symlinkSync("runtime", link);
  const review = { version: 1 as const, agents: [{ agent: "codex" as const, roots: [], sources: [...discovery.captureDiscoveryByteSources([config]), ...capture([link])], pluginHooks: "reviewed-no-skill-injection" as const }] };
  const plan = planAgentIntegration({ home, dataDir, agents: ["codex"], command: "/fixture/skills", discoveryInputs: review }), after = plan.discoveryAfter;
  const bridge = join(home, ".codex/skills/skills-cli/SKILL.md");
  Object.defineProperty(plan, "discoveryAfter", { get() { expect(existsSync(bridge)).toBe(true); renameSync(link, link + "-old"); symlinkSync("runtime", link); return after; } });
  expect(() => applyAgentIntegration(plan)).toThrow("discovery input changed");
  expect(realpathSync(link)).toBe(target); expect(readFileSync(config, "utf8")).toBe("");
  expect(existsSync(bridge)).toBe(false); expect(existsSync(join(dataDir, "agent-policy.json"))).toBe(false);
});

test("path metadata has finite per-source and aggregate budgets", () => {
  let dir = root();
  // Short components keep real paths portable; repeated witnesses and absolute
  // link traversal still exceed the unchanged aggregate and per-source budgets.
  for (let n = 0; n < 20; n++) { dir = join(dir, "d".repeat(20) + n); mkdirSync(dir); }
  const file = join(dir, "file"); writeFileSync(file, "fixture");
  const sources = capture([file]);
  expect(() => verify(Array(1500).fill(sources[0]))).toThrow("aggregate metadata limit");
  for (let n = 0; n < 35; n++) symlinkSync(join(dir, n === 34 ? "file" : "link-" + (n + 1)), join(dir, "link-" + n));
  expect(() => capture([join(dir, "link-0")])).toThrow("Discovery path metadata limit exceeded");
});

test("real path races refuse link, ancestor, regular-file, FIFO and growth replacements without hanging", () => {
  const script = join(root(), "race.mjs"); writeFileSync(script, `
import { mock } from "bun:test";
import * as original from "node:fs";
const fs = { ...original }, [input, target, mode, modulePath] = process.argv.slice(2); let changed = false;
mock.module("node:fs", () => ({ ...fs,
  readlinkSync(path, ...args) {
    const value = fs.readlinkSync(path, ...args);
    if (mode === "link-read" && path === input && !changed) { changed = true; fs.unlinkSync(input); fs.symlinkSync(target + "-same", input); }
    return value;
  },
  openSync(path, ...args) {
    if (String(path) === target && !changed && mode !== "growth" && mode !== "link-read") {
      changed = true;
      if (mode === "link-open") { fs.unlinkSync(input); fs.symlinkSync(target + "-same", input); }
      else if (mode === "ancestor") { const parent = input.slice(0, input.lastIndexOf("/")); fs.unlinkSync(parent); fs.symlinkSync(target.slice(0, target.lastIndexOf("/")) + "-same", parent); }
      else { fs.renameSync(target, target + "-old");
        if (mode === "fifo") { if (Bun.spawnSync(["mkfifo", target]).exitCode !== 0) throw Error("FIFO fixture failed"); }
        else if (mode === "regular-link") fs.symlinkSync(target + "-old", target);
        else fs.writeFileSync(target, "fixture");
      }
    }
    return fs.openSync(path, ...args);
  },
  readSync(...args) {
    const count = fs.readSync(...args);
    if (mode === "growth" && !changed) { changed = true; fs.truncateSync(target, 64 * 1024 * 1024 + 1); }
    return count;
  }
}));
const { hashDiscoveryPathFile } = await import(modulePath);
let refused = false; try { hashDiscoveryPathFile(input, { remaining: 256 * 1024 * 1024 }); } catch { refused = true; }
process.stdout.write(JSON.stringify({ changed, refused })); process.exitCode = changed && refused ? 0 : 2;
`);
  for (const mode of ["link-read", "link-open", "ancestor", "replacement", "fifo", "regular-link", "growth"]) {
    const dir = root(), targetDir = join(dir, "target"); mkdirSync(targetDir); mkdirSync(targetDir + "-same");
    const target = join(targetDir, "file"); writeFileSync(target, "fixture"); writeFileSync(target + "-same", "fixture"); writeFileSync(join(targetDir + "-same", "file"), "fixture");
    const alias = join(dir, "alias"); symlinkSync(mode === "ancestor" ? targetDir : target, alias);
    const input = mode === "ancestor" ? join(alias, "file") : alias;
    const result = Bun.spawnSync([process.execPath, "--no-env-file", script, input, target, mode, new URL("./agent-discovery-path-bytes.ts", import.meta.url).href], { timeout: 5000, env: { PATH: process.env.PATH!, HOME: process.env.HOME! } });
    expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout.toString())).toEqual({ changed: true, refused: true });
  }
});
