import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "skills-marketplace-entry-cli-")));
const binary = join(scratch, "skills.js");
beforeAll(async () => { await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary); });
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function run(root: string, args: string[]) {
  const home = join(root, "home"), temporary = join(root, "tmp");
  mkdirSync(home, { recursive: true });
  mkdirSync(temporary, { recursive: true });
  const child = Bun.spawn([process.execPath, "--no-env-file", binary, ...args], {
    cwd: root,
    env: { PATH: `${process.env.PATH ?? ""}`, HOME: home, USERPROFILE: home, TMPDIR: temporary, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", NO_COLOR: "1", TERM: "dumb" },
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, exitCode };
}

test("hook witness captures one reviewed marketplace entry and refuses misplaced selectors", async () => {
  const root = mkdtempSync(join(scratch, "case-"));
  const path = join(root, "marketplace/.claude-plugin/marketplace.json");
  mkdirSync(join(root, "marketplace/.claude-plugin"), { recursive: true });
  writeFileSync(path, JSON.stringify({ name: "claude-plugins-official", owner: { name: "Anthropic" }, plugins: [
    { name: "swift-lsp", description: "Swift language server (SourceKit-LSP) for code intelligence", version: "1.0.0", author: { name: "Anthropic", email: "support@anthropic.com" }, source: "./plugins/swift-lsp", category: "development", strict: false, lspServers: { "sourcekit-lsp": { command: "sourcekit-lsp", extensionToLanguage: { ".swift": "swift" } } } },
  ] }));
  const result = await run(root, ["hook", "witness", "--kind", "claude-marketplace-entry-v1", "--path", path, "--marketplace", "claude-plugins-official", "--plugin", "swift-lsp", "--json"]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ path, hashMode: "claude-marketplace-entry-v1", marketplace: "claude-plugins-official", plugin: "swift-lsp",
    sha256: "10021f42a1a3d5d53b0b9da96ba0317b047e44187a77a7822a1c1a323871e04f" });
  const missing = await run(root, ["hook", "witness", "--kind", "claude-marketplace-entry-v1", "--path", path, "--marketplace", "claude-plugins-official", "--json"]);
  expect(missing.exitCode).not.toBe(0);
  expect(missing.stderr).toContain("claude-marketplace-entry-v1 requires --marketplace and --plugin");
  const misplaced = await run(root, ["hook", "witness", "--kind", "claude-settings-v3", "--path", path, "--plugin", "swift-lsp", "--json"]);
  expect(misplaced.exitCode).not.toBe(0);
  expect(misplaced.stderr).toContain("--marketplace and --plugin apply only to claude-marketplace-entry-v1");
  // Capture is read-only: nothing beyond the fixture and the CLI's own scratch dirs appears.
  expect(readdirSync(join(root, "marketplace/.claude-plugin"))).toEqual(["marketplace.json"]);
});
