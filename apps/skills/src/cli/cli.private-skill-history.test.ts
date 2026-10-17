import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const root = mkdtempSync(join(tmpdir(), "skills-private-history-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const skillId = "44444444-4444-4444-8444-444444444444", currentId = "77777777-7777-4777-8777-777777777777";
const olderId = "66666666-6666-4666-8666-666666666666";
const args = ["publication", "versions", skillId, "--email", "fixture@example.test", "--user-id", "11111111-1111-4111-8111-111111111111",
  "--membership-id", "22222222-2222-4222-8222-222222222222", "--code-stdin", "--json"];
async function run(scenario = "success", command = args, code = "123456\n") {
  const home = mkdtempSync(join(root, "home-")), trace = join(home, "trace.jsonl");
  const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install", join(import.meta.dir, "..", "..", "test", "fixtures", "private-skill-history.fixture.ts"), ...command], {
    cwd: home, env: { HOME: home, USERPROFILE: home, TMPDIR: home, HASNA_HOME: join(home, ".hasna"), HASNA_CONFIG_HOME: join(home, "config"),
      HASNA_SKILLS_DIR: join(home, "data"), HASNA_SKILLS_API_URL: "http://127.0.0.1:9", HASNA_STATION: "synthetic-no-keychain", NO_COLOR: "1",
      XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, "data"), XDG_CACHE_HOME: join(home, "cache"), XDG_STATE_HOME: join(home, "state"),
      PATH: join(home, "empty-path"), HISTORY_FIXTURE_SCENARIO: scenario, HISTORY_FIXTURE_TRACE: trace, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  (child.stdin as import("bun").FileSink).write(code); (child.stdin as import("bun").FileSink).end();
  const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const entries = existsSync(trace) ? readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
  const calls = entries.filter(row => row.event === "request");
  const diagnostic = JSON.stringify({ exit: status, requestCount: calls.length, nativeUnexpected: entries.some(row => row.event === "unexpected-native") });
  expect(entries.filter(row => row.event === "guards"), diagnostic).toEqual([{ event: "guards", nativeControls: 2, targetControls: 1 }]);
  expect(entries.some(row => row.event === "unexpected-native"), diagnostic).toBe(false);
  for (const marker of ["synthetic-history-session", "synthetic-profile-key", "capability=", "123456"]) expect((stdout + stderr).includes(marker), diagnostic).toBe(false);
  if (!["profile", "profile-change", "credential-file-change", "gateway-bound"].includes(scenario)) expect(readdirSync(home), diagnostic).toEqual(["trace.jsonl"]);
  return { stdout, stderr, status, calls, diagnostic };
}
test("private versions command verifies the account, selects its workspace and makes one bound history GET", async () => {
  const result = await run(); expect(result.status, result.diagnostic).toBe(0); expect(result.stderr, result.diagnostic).toBe("");
  const history = JSON.parse(result.stdout);
  expect(history).toMatchObject({ skillId, currentVersion: "1.1.0", currentVersionId: currentId, nextCursor: olderId, slug: "my-private-skill" });
  expect(history.versions.map((row: { version: string }) => row.version)).toEqual(["1.1.0", "1.0.0"]);
  expect(history.versions[0].releasedAt).toBe("2026-10-17T09:00:00.123456Z");
  expect(result.calls.map(row => row.path)).toEqual(["/api/auth/verify", "/api/auth/whoami", "/api/v1/account/workspaces/switch", "/api/auth/whoami", `/api/v1/skills/${skillId}/versions`]);
  expect(result.calls.slice(1).every(row => row.authenticated), result.diagnostic).toBe(true);
});
test("history pagination and empty results remain explicit rather than pretending to be complete or published", async () => {
  const page = await run("success", [...args, "--limit", "1", "--cursor", currentId]);
  expect(page.status, page.diagnostic).toBe(0); expect(JSON.parse(page.stdout).versions.map((row: { version: string }) => row.version)).toEqual(["1.0.0"]);
  expect(JSON.parse(page.stdout).nextCursor).toBeNull();
  const empty = await run("empty"); expect(empty.status, empty.diagnostic).toBe(0);
  expect(JSON.parse(empty.stdout)).toMatchObject({ currentVersion: null, currentVersionId: null, versions: [], nextCursor: null });
});
test("human history prints exact dates/current marker and the next cursor without a recovery directory", async () => {
  const result = await run("success", args.filter(arg => arg !== "--json")); expect(result.status, result.diagnostic).toBe(0);
  for (const value of ["Private versions of my-private-skill", "Current version: 1.1.0", "1.1.0 (current)",
    "2026-10-17T09:00:00.123456Z", "2026-10-17T08:00:00.654321+00:00", `--cursor ${olderId}`]) expect(result.stdout.includes(value), result.diagnostic).toBe(true);
});
test("viewer reads and enrolled profile sign-in use session history without converting a saved key into read authority", async () => {
  for (const scenario of ["viewer", "profile"]) {
    const result = await run(scenario); expect(result.status, result.diagnostic).toBe(0);
    const historyCalls = result.calls.filter(row => row.path.endsWith("/versions"));
    expect(historyCalls).toHaveLength(1); expect(historyCalls[0]).toMatchObject({ method: "GET", authenticated: true, metadata: false });
    expect(result.calls.filter(row => row.metadata).every(row => row.path === "/api/auth/whoami"), result.diagnostic).toBe(true);
  }
});
test("invalid IDs, context, pagination, unknown options and invalid code refuse before authentication", async () => {
  for (const command of [args.map(arg => arg === skillId ? "my-private-skill" : arg), [...args, "--limit", "0"], [...args, "--limit", "51"],
    [...args, "--cursor", "bad"], args.filter((_, index) => ![5, 6, 7, 8].includes(index)), [...args, "--confirm"], [...args, "unexpected-argument"], args.map(arg => arg.startsWith("22222222") ? "bad" : arg)]) {
    const result = await run("success", command); expect(result.status, result.diagnostic).toBe(1); expect(result.calls, result.diagnostic).toEqual([]);
  }
  const badCode = await run("success", args, "invalid\n"); expect(badCode.status, badCode.diagnostic).toBe(1); expect(badCode.calls).toEqual([]);
});
test("auth, binding, foreign ownership and read errors never print partial history or retry a read", async () => {
  for (const scenario of ["auth-refused", "foreign-account", "foreign-membership", "foreign-tenant", "not-found", "read-refused", "invalid-json"]) {
    const result = await run(scenario); expect(result.status, result.diagnostic).toBe(1);
    expect(JSON.parse(result.stdout).uncertain).toBe(false); expect("versions" in JSON.parse(result.stdout)).toBe(false);
    expect(result.calls.filter(row => row.path.endsWith("/versions")).length).toBeLessThanOrEqual(1);
  }
});
test("profile, origin, credential-file drift and a gateway-bound profile never reach another instance", async () => {
  for (const scenario of ["profile-change", "origin-change", "credential-file-change", "gateway-bound"]) {
    const result = await run(scenario); expect(result.status, result.diagnostic).toBe(1); expect(result.calls, result.diagnostic).toEqual([]);
  }
});
