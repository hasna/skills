import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { useDefaultTestTimeout } from "../../test-preload.js";

useDefaultTestTimeout();

const firstRunModes = ["claude-first-run", "claude-first-run-no-userid", ...["invalid-userid", "unknown", "wrong-server", "unrelated-server", "concurrent-creator", "policy-refused", "native-refusal-after-write", "dangling-link", "config-dir-alias", "post-symlink", "post-hardlink", "parent-drift", "late-lock"].map(kind => `claude-first-run-${kind}`)];
const bootstrapModes = ["claude-native-bootstrap", "claude-native-bootstrap-existing", "claude-native-bootstrap-unknown",
  "claude-native-bootstrap-existing-change", "claude-native-bootstrap-userid", "claude-native-bootstrap-existing-userid-change", "claude-native-bootstrap-existing-remove", "claude-native-bootstrap-unrelated-change",
  "claude-native-bootstrap-wrong-server", ...["firstStartTime", "firstStartVersion", "machineID", "opusProMigrationComplete",
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
      expect(receipt).toMatchObject({ mode, unrelatedEntriesPreserved: mode !== "claude-native-bootstrap-unrelated-change", credentialsUnchanged: true, credentialsNotDisclosed: true, networkCalls: 0 });
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

const guardedModes = ["atomic", "new", "race", "new-race", "cas-stat-race", "locked", "symlink", "parent-symlink", "home-ancestor-symlink", "hardlink",
  "invalid", "invalid-container", "backup-readback", "temp-write", "final-readback", "group-preserved", "group-refused",
  "acl-deny-directory", "acl-allow-directory", "acl-deny-file", "acl-allow-file", "acl-backup-inherit-allow", "acl-temp-inherit-allow", "acl-unknown", "acl-read-error",
  "linux-acl-absent", "linux-acl-file", "linux-acl-directory", "linux-acl-default", "linux-acl-ancestor-default", "linux-acl-create-parent-default", "linux-acl-error", "linux-acl-unsupported"];
for (const agent of ["codex", "gemini", "pi", "opencode", "cursor", "windsurf"]) for (const mode of guardedModes) {
  test.skipIf(mode.startsWith("linux-acl-") && process.platform !== "linux")(`direct MCP config writes preserve originals and refuse unsafe changes: ${agent}/${mode}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "skills-mcp-guarded-"));
    for (const name of ["home", "tmp"]) mkdirSync(join(root, name), { mode: 0o700 });
    let home = join(root, "home");
    if (mode === "home-ancestor-symlink") {
      mkdirSync(join(home, "nested"), { mode: 0o700 });
      const alias = join(root, "home-alias"); symlinkSync(home, alias); home = join(alias, "nested");
    }
    const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install",
      resolve(import.meta.dir, "runtime-mcp-guarded-writes.fixture.ts"), agent, mode], {
      cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { HOME: home, TMPDIR: join(root, "tmp"), PATH: "/nonexistent-fixture-bin",
        HASNA_HOME: join(home, ".hasna"), HASNA_CONFIG_HOME: join(home, "config"), HASNA_PROFILE: "guarded-fixture",
        HASNA_SKILLS_API_URL: "http://127.0.0.1:9", SKILLS_API_URL: "http://127.0.0.1:9",
        HASNA_STATION: "guarded-config-fixture", NO_COLOR: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
        GUARDED_CONFIG_FIXTURE_ROOT: root },
    });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 20_000);
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      const diagnostic = JSON.stringify({ exit: Number.isInteger(code) ? code : null,
        location: stderr.match(/runtime-mcp-guarded-writes\.fixture\.ts:[0-9]{1,7}:[0-9]{1,7}(?![0-9])/)?.[0] ?? "unavailable" });
      expect(timedOut, diagnostic).toBe(false); expect(stderr.length, diagnostic).toBe(0); expect(code, diagnostic).toBe(0);
      expect(JSON.parse(stdout)).toEqual({ agent, mode, cases: 1, networkCalls: 0, syntheticOnly: true });
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; }
      // Only this fresh sandbox's synthetic HOME, config, backups and output.
      rmSync(root, { recursive: true, force: true });
    }
  });
}
