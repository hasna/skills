import { strict as assert } from "node:assert";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Real command, verification, workspace binding and SDK. Only HTTP responses
// are synthetic; every request is closed-loopback and native execution is denied.
const origin = "http://127.0.0.1:9";
assert.equal(process.env.HASNA_SKILLS_API_URL, origin);
const trace = process.env.HISTORY_FIXTURE_TRACE!;
const userId = "11111111-1111-4111-8111-111111111111", membershipId = "22222222-2222-4222-8222-222222222222";
const organizationId = "33333333-3333-4333-8333-333333333333", skillId = "44444444-4444-4444-8444-444444444444";
const currentId = "77777777-7777-4777-8777-777777777777", olderId = "66666666-6666-4666-8666-666666666666";
const scenario = process.env.HISTORY_FIXTURE_SCENARIO;
const token = "synthetic-history-session", key = "synthetic-profile-key";
const identity = { user: { id: userId, membershipId, email: "fixture@example.test", displayName: null, role: scenario === "viewer" ? "viewer" : "member" },
  organization: { id: organizationId, slug: "fixture", name: "Fixture" } };
const profileFile = join(process.env.HASNA_CONFIG_HOME!, "skills", "credentials-a");
if (["profile", "profile-change", "credential-file-change", "gateway-bound"].includes(scenario!)) {
  process.env.HASNA_PROFILE = "a"; mkdirSync(join(process.env.HASNA_CONFIG_HOME!, "skills"), { recursive: true });
  const selectedOrigin = scenario === "gateway-bound" ? "https://api.hasna.com/skills" : origin;
  writeFileSync(profileFile, `HASNA_SKILLS_API_KEY=${key}\nHASNA_SKILLS_API_URL=${selectedOrigin}\nHASNA_SKILLS_BOUND_API_URL=${selectedOrigin}\n`, { mode: 0o600 });
}
if (scenario?.endsWith("-change")) {
  const iterate = process.stdin[Symbol.asyncIterator].bind(process.stdin);
  process.stdin[Symbol.asyncIterator] = () => {
    if (scenario === "origin-change") process.env.HASNA_SKILLS_API_URL = "http://127.0.0.1:10";
    if (scenario === "profile-change") process.env.HASNA_PROFILE = "b";
    if (scenario === "credential-file-change") writeFileSync(profileFile,
      `HASNA_SKILLS_API_KEY=${key}\nHASNA_SKILLS_API_URL=http://127.0.0.1:10\nHASNA_SKILLS_BOUND_API_URL=http://127.0.0.1:10\n`, { mode: 0o600 });
    return iterate();
  };
}
let checking = true;
const log = (row: unknown) => appendFileSync(trace, JSON.stringify(row) + "\n");
const deny = () => { if (!checking) log({ event: "unexpected-native" }); throw Error("HISTORY_NATIVE_REFUSED"); };
Bun.spawn = deny as typeof Bun.spawn; Bun.spawnSync = deny as typeof Bun.spawnSync;
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) (cp as unknown as Record<string, unknown>)[name] = deny;
syncBuiltinESMExports();
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const target = new URL(input instanceof Request ? input.url : String(input));
  if (target.origin !== origin) throw Error("HISTORY_TARGET_REFUSED");
  const path = target.pathname, method = init?.method ?? "GET", headers = new Headers(init?.headers);
  const authenticated = headers.get("authorization") === `Bearer ${token}`, metadata = headers.get("authorization") === `Bearer ${key}`;
  const allowed = ["/api/auth/verify", "/api/auth/whoami", "/api/v1/account/workspaces/switch", `/api/v1/skills/${skillId}/versions`];
  log({ event: "request", path: allowed.includes(path) ? path : "unknown", method: ["GET", "POST"].includes(method) ? method : "unknown", authenticated, metadata });
  if (path === "/api/auth/verify") {
    assert.equal(method, "POST"); assert.equal(headers.has("authorization"), false);
    if (scenario === "auth-refused") return Response.json({ error: token }, { status: 401 });
    const user = scenario === "foreign-account" ? { ...identity.user, id: skillId } : identity.user;
    return Response.json({ token, user });
  }
  if (!authenticated && !metadata) throw Error("HISTORY_AUTH_REQUIRED");
  if (path === "/api/auth/whoami") return Response.json({ ...identity, authMethod: metadata ? "api_key" : "jwt" });
  if (path === "/api/v1/account/workspaces/switch") {
    assert.equal(authenticated, true); assert.equal(method, "POST"); assert.deepEqual(JSON.parse(String(init?.body)), { membershipId });
    return Response.json({ ...identity, token, user: scenario === "foreign-membership" ? { ...identity.user, membershipId: skillId } : identity.user });
  }
  if (path === `/api/v1/skills/${skillId}/versions`) {
    assert.equal(authenticated, true); assert.equal(metadata, false); assert.equal(method, "GET"); assert.equal(init?.body, undefined);
    assert.equal(headers.get("x-skills-user-id"), userId); assert.equal(headers.get("x-skills-workspace-id"), organizationId);
    assert.equal(headers.get("x-skills-membership-id"), membershipId); assert.equal(init?.redirect, "error"); assert.equal(init?.credentials, "omit");
    if (scenario === "not-found") return Response.json({ code: "PUBLICATION_UNAVAILABLE", error: token }, { status: 404 });
    if (scenario === "read-refused") return Response.json({ code: "WORKSPACE_CONTEXT_CHANGED", error: token }, { status: 409 });
    if (scenario === "invalid-json") return new Response(token);
    const versions = [{ id: currentId, version: "1.1.0", releasedAt: "2026-10-17T09:00:00.123456Z", createdAt: "2026-10-17T08:00:00.654321+00:00" },
      { id: olderId, version: "1.0.0", releasedAt: null, createdAt: "2026-10-16T08:00:00Z" }];
    const page = target.searchParams.get("cursor") === currentId ? [versions[1]] : versions;
    const empty = scenario === "empty";
    return Response.json({ organizationId: scenario === "foreign-tenant" ? userId : organizationId, skillId, slug: "my-private-skill",
      currentVersion: empty ? null : "1.1.0", currentVersionId: empty ? null : currentId,
      versions: empty ? [] : page, nextCursor: empty || target.searchParams.has("cursor") ? null : olderId,
      source: token, uploadUrl: "https://invalid.example/?capability=synthetic" });
  }
  throw Error("HISTORY_ROUTE_REFUSED");
}) as unknown as typeof fetch;
for (const control of [() => Bun.spawn(["unreachable-native"]), () => cp.execFileSync("unreachable-native")]) {
  assert.throws(control, /HISTORY_NATIVE_REFUSED/);
}
await assert.rejects(fetch("http://127.0.0.1:10"), /HISTORY_TARGET_REFUSED/);
checking = false; log({ event: "guards", nativeControls: 2, targetControls: 1 });
const { Command } = await import("commander");
const { registerPrivatePublications } = await import("../../src/cli/commands/private-publications.js");
const program = new Command(); registerPrivatePublications(program);
await program.parseAsync(process.argv);
