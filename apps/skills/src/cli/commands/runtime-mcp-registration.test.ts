import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { useDefaultTestTimeout } from "../../test-preload.js";

useDefaultTestTimeout();

for (const mode of ["profile", "environment-profile", "transient", "default", "claude-native", "setup", "auth", "gateway", "bad-url", "aliases", "invalid-toml"]) {
  test(`agent MCP registration preserves selection and stdio: ${mode}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "skills-mcp-registration-"));
    for (const name of ["home", "tmp"]) mkdirSync(join(root, name), { mode: 0o700 });
    const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install", resolve(import.meta.dir, "runtime-mcp-registration.fixture.ts"), mode], {
      cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { HOME: join(root, "home"), TMPDIR: join(root, "tmp"), PATH: "/nonexistent-fixture-bin", NO_COLOR: "1",
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", REGISTRATION_FIXTURE_ROOT: root },
    });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 20_000);
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(timedOut).toBe(false); expect(stderr.length).toBe(0); expect(code).toBe(0);
      const receipt = JSON.parse(stdout);
      expect(receipt).toMatchObject({ mode, unrelatedEntriesPreserved: true, credentialsUnchanged: true, credentialsNotDisclosed: true, networkCalls: 0 });
      expect(receipt.adapters).toBe(["bad-url", "aliases"].includes(mode) ? 0 : mode === "invalid-toml" ? 6 : 7);
    } finally {
      clearTimeout(timer);
      // Only this test's freshly created child and synthetic files are owned here.
      if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; }
      rmSync(root, { recursive: true, force: true });
    }
  });
}
