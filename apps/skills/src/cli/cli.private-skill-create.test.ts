import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const root = mkdtempSync(join(tmpdir(), "skills-create-command-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const args = ["publication", "create", "my-private-skill", "--display-name", "My private skill", "--description", "Fixture description",
  "--email", "fixture@example.com", "--user-id", "11111111-1111-4111-8111-111111111111", "--membership-id", "22222222-2222-4222-8222-222222222222",
  "--code-stdin", "--confirm", "--json"];
async function run(scenario = "success", command = args, code = "123456\n", rowFile?: string) {
  const home = mkdtempSync(join(root, "home-")), trace = join(home, "trace.jsonl"), waiting = join(home, "waiting");
  const pendingCode = scenario.endsWith("-change"), metadataRead = ["info", "list"].includes(command[0]!);
  const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install", join(import.meta.dir, "private-skill-create.fixture.ts"), ...command], {
    cwd: home, env: { HOME: home, TMPDIR: process.env.TMPDIR!, HASNA_HOME: join(home, ".hasna"), HASNA_CONFIG_HOME: join(home, "config"),
      HASNA_SKILLS_DIR: join(home, "data"), HASNA_SKILLS_API_URL: "http://127.0.0.1:1", HASNA_STATION: "synthetic-no-keychain", NO_COLOR: "1",
      PATH: "/usr/bin:/bin", SKILLS_CREATE_SCENARIO: scenario, SKILLS_CREATE_TRACE: trace, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
      SKILLS_CREATE_WAITING: waiting, ...(rowFile ? { SKILLS_CREATE_ROW: rowFile } : {}),
      ...(metadataRead ? { HASNA_SKILLS_API_KEY_OVERRIDE: "synthetic-metadata-key" } : {}) },
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  // Feed process.stdin through the same pipe as the pending-code controls.
  try {
    if (pendingCode) {
      for (let i = 0; i < 200 && !existsSync(waiting); i++) await Bun.sleep(10);
      expect(existsSync(waiting)).toBe(true);
    }
    (child.stdin as import("bun").FileSink).write(code);
  } finally { (child.stdin as import("bun").FileSink).end(); }
  const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const calls = existsSync(trace) ? readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
  expect(stdout + stderr).not.toContain("synthetic-session"); expect(stdout + stderr).not.toContain("capability=");
  expect(stdout + stderr).not.toContain("123456");
  if (!pendingCode) expect(readdirSync(home)).toEqual(existsSync(trace) ? ["trace.jsonl"] : []);
  const diagnostic = JSON.stringify({
    scenario: ["success", "pro-refused", "session-refused", "auth-refused", "foreign-tenant", "lost-response", "profile-change", "origin-change", "credential-file-change"].includes(scenario) ? scenario : "unknown",
    exit: Number.isInteger(status) ? status : null, requestCount: calls.length,
    requests: calls.slice(0, 16).map(call => ({
      path: ["/api/auth/verify", "/api/auth/whoami", "/api/v1/account/workspaces/switch", "/api/v1/skills", "/api/v1/skills/my-private-skill"].includes(call?.path) ? call.path : "unrecognized-route",
      method: ["GET", "POST"].includes(call?.method) ? call.method : "unrecognized-method", authenticated: call?.authenticated === true,
    })),
  });
  return { stdout, stderr, status, calls, diagnostic };
}

test("real create command verifies, selects workspace and returns the new private skill ID", async () => {
  const result = await run();
  expect(result.status, result.diagnostic).toBe(0); expect(result.stderr, result.diagnostic).toBe("");
  expect(JSON.parse(result.stdout), result.diagnostic).toEqual({ id: "44444444-4444-4444-8444-444444444444", slug: "my-private-skill", visibility: "private",
    sourceType: "private_hosted", ownerOrganizationId: "33333333-3333-4333-8333-333333333333" });
  expect(result.calls.map(call => call.path)).toEqual(["/api/auth/verify", "/api/auth/whoami", "/api/v1/account/workspaces/switch", "/api/auth/whoami", "/api/v1/skills"]);
  expect(result.calls.slice(1).every(call => call.authenticated)).toBe(true);
});

test("create rejects missing consent, malformed slug, visibility, context and code before authentication", async () => {
  for (const command of [args.filter(arg => arg !== "--confirm"), args.map(arg => arg === "my-private-skill" ? "bad--slug" : arg),
    [...args, "--visibility", "public"], args.map(arg => arg.startsWith("22222222") ? "bad-context" : arg)]) {
    const result = await run("success", command); expect(result.status, result.diagnostic).toBe(1); expect(result.calls, result.diagnostic).toEqual([]);
  }
  const badCode = await run("success", args, "invalid\n"); expect(badCode.status, badCode.diagnostic).toBe(1); expect(badCode.calls, badCode.diagnostic).toEqual([]);
});

test("create reports Pro and session refusals safely with one create POST", async () => {
  for (const [scenario, code] of [["pro-refused", "PLAN_REQUIRED"], ["session-refused", "INTERACTIVE_SESSION_REQUIRED"]]) {
    const result = await run(scenario); expect(result.status, result.diagnostic).toBe(1);
    expect(JSON.parse(result.stdout), result.diagnostic).toMatchObject({ code, uncertain: false });
    expect(result.calls.filter(call => call.path === "/api/v1/skills")).toHaveLength(1);
  }
  const auth = await run("auth-refused"); expect(auth.status, auth.diagnostic).toBe(1); expect(auth.calls, auth.diagnostic).toHaveLength(1);
});

test("create refuses foreign tenant responses and preserves lost-response uncertainty without retry", async () => {
  for (const scenario of ["foreign-tenant", "lost-response"]) {
    const result = await run(scenario); expect(result.status, result.diagnostic).toBe(1);
    expect(JSON.parse(result.stdout), result.diagnostic).toMatchObject({ code: "SKILL_CREATE_UNCONFIRMED", uncertain: true });
    expect(result.calls.filter(call => call.path === "/api/v1/skills")).toHaveLength(1);
  }
});

test("plain create output contains the usable skill ID and no foreign free text", async () => {
  const result = await run("success", args.filter(arg => arg !== "--json"));
  expect(result.status, result.diagnostic).toBe(0); expect(result.stdout, result.diagnostic).toContain("44444444-4444-4444-8444-444444444444");
  expect(result.stdout, result.diagnostic).toContain("my-private-skill");
});

for (const scenario of ["profile-change", "origin-change", "credential-file-change"]) {
  test(`pending-code ${scenario} refuses before any traffic`, async () => {
    const result = await run(scenario);
    expect(result.status, result.diagnostic).toBe(1); expect(result.calls, result.diagnostic).toEqual([]);
  });
}

test("created and ambiguously created rows remain discoverable through ordinary list and detail", async () => {
  for (const scenario of ["success", "lost-response"]) {
    const row = join(root, `${scenario}.json`);
    const created = await run(scenario, args, "123456\n", row);
    expect(created.status, created.diagnostic).toBe(scenario === "success" ? 0 : 1);
    const listed = await run("success", ["list", "--remote", "--json"], "", row);
    expect(listed.status, listed.diagnostic).toBe(0);
    const item = JSON.parse(listed.stdout)[0];
    expect(item, created.diagnostic + " " + listed.diagnostic).toMatchObject({ id: "44444444-4444-4444-8444-444444444444", name: "my-private-skill", category: "Remote" });
    const detail = await run("success", ["info", "my-private-skill", "--remote", "--json"], "", row);
    expect(detail.status, detail.diagnostic).toBe(0); expect(JSON.parse(detail.stdout).id).toBe(item.id);
    expect(created.calls.filter(call => call.path === "/api/v1/skills" && call.method === "POST")).toHaveLength(1);
  }
});
