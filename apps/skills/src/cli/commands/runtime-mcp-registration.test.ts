import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { useDefaultTestTimeout } from "../../test-preload.js";

useDefaultTestTimeout();

const firstRunModes = ["claude-first-run", "claude-first-run-no-userid", ...["invalid-userid", "unknown", "wrong-server", "unrelated-server", "concurrent-creator", "policy-refused", "native-refusal-after-write", "dangling-link", "config-dir-alias", "post-symlink", "post-hardlink", "parent-drift", "late-lock"].map(kind => `claude-first-run-${kind}`)];
const bootstrapModes = ["claude-native-bootstrap", "claude-native-bootstrap-existing", "claude-native-bootstrap-unknown",
  "claude-native-bootstrap-existing-change", "claude-native-bootstrap-userid", "claude-native-bootstrap-existing-userid-change", "claude-native-bootstrap-existing-remove", "claude-native-bootstrap-unrelated-change",
  "claude-native-bootstrap-wrong-server", "claude-native-bootstrap-existing-theme-drop", "claude-native-bootstrap-no-skills-entry",
  "claude-native-bootstrap-existing-exit1", "claude-native-bootstrap-existing-concurrent", "claude-native-bootstrap-existing-hardlink", ...["firstStartTime", "firstStartVersion", "machineID", "opusProMigrationComplete",
    "sonnet1m45MigrationComplete", "seenNotifications", "hasResetAutoModeOptInForDefaultOffer", "migrationVersion"]
    .map(field => `claude-native-bootstrap-invalid-${field}`)];

for (const mode of [...firstRunModes, ...bootstrapModes, "profile", "environment-profile", "transient", "default", "claude-native", "claude-config-dir", "claude-custom-oauth", "claude-legacy", "claude-unavailable", "claude-drift", "claude-locked", "claude-late-lock", "claude-policy-refused", "claude-blocked", "claude-unknown-refusal", "claude-spawn-refused", "setup", "auth", "gateway", "bad-url", "aliases", "invalid-toml"]) {
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
      const diagnostic = JSON.stringify({ exit: Number.isInteger(code) ? code : null,
        location: stderr.match(/runtime-mcp-registration\.fixture\.ts:[0-9]{1,7}:[0-9]{1,7}(?![0-9])/)?.[0] ?? "unavailable" });
      expect(timedOut, diagnostic).toBe(false); expect(stderr.length, diagnostic).toBe(0); expect(code, diagnostic).toBe(0);
      const receipt = JSON.parse(stdout);
      expect(receipt).toMatchObject({ mode, unrelatedEntriesPreserved: true, credentialsUnchanged: true, credentialsNotDisclosed: true, networkCalls: 0 });
      const firstRunRefused = firstRunModes.includes(mode) && !["claude-first-run", "claude-first-run-no-userid"].includes(mode);
      const bootstrapRefused = bootstrapModes.includes(mode) && !["claude-native-bootstrap", "claude-native-bootstrap-existing"].includes(mode);
      expect(receipt.adapters).toBe(["bad-url", "aliases"].includes(mode) ? 0 : bootstrapRefused || firstRunRefused ? 6 : ["invalid-toml", "claude-drift", "claude-locked", "claude-late-lock", "claude-policy-refused", "claude-blocked", "claude-unknown-refusal", "claude-spawn-refused"].includes(mode) ? 6 : 7);
    } finally {
      clearTimeout(timer);
      // Only this test's freshly created child and synthetic files are owned here.
      if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; }
      rmSync(root, { recursive: true, force: true });
    }
  });
}
