import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "skills-codex-v6-cli-"))), binary = join(scratch, "skills.js");
beforeAll(async () => { await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary); });
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
test("real CLI captures V6/executable witnesses and refuses unsafe metadata without state writes", async () => {
  const root = mkdtempSync(join(scratch, "case-")), home = join(root, "home"), data = join(root, "data"), temporary = join(root, "tmp");
  for (const path of [home, data, temporary]) mkdirSync(path);
  const native = join(home, ".codex"); mkdirSync(join(native, "plugins/cache"), { recursive: true });
  const config = join(native, "config.toml"), hooks = join(native, "hooks.json"), metadata = join(root, "review.json");
  const hook = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "mcp_tool", server: "provider", tool: "activate" }] }] } });
  writeFileSync(hooks, hook); writeFileSync(config, 'mcp_servers.provider.command="/synthetic/provider"\ntui.status_line=["future"]\n');
  const rows = [{ path: hooks, sha256: createHash("sha256").update(hook).digest("hex") }]; writeFileSync(metadata, JSON.stringify(rows));
  async function run(args: string[]) {
    const child = Bun.spawn([process.execPath, "--no-env-file", binary, "hook", "witness", ...args, "--json"], {
      cwd: root, env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_SKILLS_DIR: data, TMPDIR: temporary, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", NO_COLOR: "1", TERM: "dumb" },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); return { stdout, stderr, exitCode };
  }
  const args = ["--kind", "codex-settings-v6", "--path", config, "--reviewed-hook-sources", metadata];
  const good = await run(args); expect(good.exitCode).toBe(0); expect(good.stderr).toBe("");
  expect(JSON.parse(good.stdout)).toMatchObject({ path: config, hashMode: "codex-settings-v6", hookSources: rows });
  const alias = join(root, "review-alias.json"); symlinkSync(metadata, alias);
  expect((await run([...args.slice(0, -1), alias])).exitCode).toBe(1);
  writeFileSync(metadata, `[{"path":${JSON.stringify(hooks)},"sha256":null,"sha256":${JSON.stringify(rows[0]!.sha256)}}]`);
  expect((await run(args)).exitCode).toBe(1);
  const executable = join(root, "synthetic-runtime"); writeFileSync(executable, "synthetic-never-executed"); chmodSync(executable, 0o700);
  const captured = await run(["--kind", "executable-v1", "--path", executable]); expect(captured.exitCode).toBe(0);
  expect(JSON.parse(captured.stdout)).toMatchObject({ path: executable, hashMode: "executable-v1", sha256: createHash("sha256").update(readFileSync(executable)).digest("hex") });
  expect(readFileSync(hooks, "utf8")).toBe(hook); expect(readdirSync(data)).toEqual([]); expect(readdirSync(home)).toEqual([".codex"]);
});
