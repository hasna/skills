import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "skills-codex-witness-cli-")));
const binary = join(scratch, "skills.js");
beforeAll(async () => { await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary); });
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function fixture() {
  const root = mkdtempSync(join(scratch, "case-")), home = join(root, "home"), data = join(root, "data"), temporary = join(root, "tmp");
  for (const path of [home, data, temporary]) mkdirSync(path);
  const original = join(root, "config.toml"), text = 'tui.status_line=["current-dir"]\n';
  writeFileSync(original, text);
  async function run(args: string[]) {
    const child = Bun.spawn([process.execPath, "--no-env-file", binary, ...args], {
      cwd: root,
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_SKILLS_DIR: data, TMPDIR: temporary, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", NO_COLOR: "1", TERM: "dumb" },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, exitCode };
  }
  const rebind = (version?: string, agent = "codex") => run(["hook", "rebind-settings", "--agent", agent, "--reviewed-preimage", original,
    "--expected-policy-sha256", "0".repeat(64), "--expected-settings-sha256", "0".repeat(64), "--json", ...(version === undefined ? [] : ["--codex-witness-version", version])]);
  return { run, rebind, data, home, original, text };
}

test("the real rebind CLI admits V5 and legacy targets to the exact policy preimage guard", async () => {
  const f = await fixture();
  // No policy is supplied: parsing must accept the target, then the owning
  // planner must refuse its missing preimage. Kernel-backed plan/apply tests
  // separately prove a complete upgrade with a genuine preserved original.
  for (const version of [undefined, "2", "3", "4", "5"]) {
    const result = await f.rebind(version);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("Managed policy preimage changed");
  }
  expect(readFileSync(f.original, "utf8")).toBe(f.text);
  expect(readdirSync(f.data)).toEqual([]);
  expect(readdirSync(f.home)).toEqual([]);
});

test("the real rebind CLI refuses unsupported and malformed targets and foreign agents", async () => {
  const f = await fixture();
  for (const version of ["1", "6", "05", "5.0", "5x", ""]) {
    const result = await f.rebind(version);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("Codex witness version accepts 2, 3, 4 or 5");
  }
  const foreign = await f.rebind("5", "claude");
  expect(foreign.exitCode).toBe(1);
  expect(foreign.stderr.trim()).toBe("Invalid Codex witness target version");
  expect(foreign.stdout).toBe("");
  expect(readFileSync(f.original, "utf8")).toBe(f.text);
  expect(readdirSync(f.data)).toEqual([]);
});

test("the real witness CLI exposes V5 without changing V3 capture semantics", async () => {
  const f = await fixture();
  const capture = async (kind: string) => {
    const result = await f.run(["hook", "witness", "--kind", kind, "--path", f.original, "--json"]);
    expect(result.exitCode).toBe(0); expect(result.stderr).toBe("");
    const value = JSON.parse(result.stdout);
    expect(value.path).toBe(f.original); expect(value.hashMode).toBe(kind);
    return value.sha256;
  };
  const oldV3 = await capture("codex-settings-v3"), oldV5 = await capture("codex-settings-v5");
  writeFileSync(f.original, 'tui.status_line=["current-dir","context-used"]\n');
  expect(await capture("codex-settings-v5")).toBe(oldV5);
  expect(await capture("codex-settings-v3")).not.toBe(oldV3);
  writeFileSync(f.original, 'tui.status_line=["current-dir","unknown-status-item"]\n');
  expect(await capture("codex-settings-v5")).not.toBe(oldV5);
  expect(readdirSync(f.data)).toEqual([]);
});
