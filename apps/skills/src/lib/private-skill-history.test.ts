import { afterEach, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
import { RemoteSkillsClient } from "./remote-client.js";
import { RemotePrivatePublicationsClient, RemotePrivateSkillHistoryClient } from "./remote-private-publications.js";
import type { PrivateSkillVersionHistory as RootHistory } from "../index.js";
import type { PrivateSkillVersionHistory as SdkHistory } from "../sdk/index.js";

useDefaultTestTimeout();
const origin = "http://127.0.0.1:9";
const userId = "11111111-1111-4111-8111-111111111111", membershipId = "22222222-2222-4222-8222-222222222222";
const organizationId = "33333333-3333-4333-8333-333333333333", skillId = "44444444-4444-4444-8444-444444444444";
const currentId = "77777777-7777-4777-8777-777777777777", olderId = "66666666-6666-4666-8666-666666666666";
const session = { token: "synthetic-history-session", user: { id: userId, membershipId, email: "fixture@example.test", displayName: null, role: "member" as const },
  organization: { id: organizationId, slug: "fixture", name: "Fixture" } };
const rows = [{ id: currentId, version: "1.1.0", releasedAt: "2026-10-17T09:00:00.123456Z", createdAt: "2026-10-17T08:00:00.654321+00:00" },
  { id: olderId, version: "1.0.0", releasedAt: null, createdAt: "2026-10-16T08:00:00Z" }];
const history = () => ({ organizationId, skillId, slug: "my-private-skill", currentVersion: "1.1.0", currentVersionId: currentId, versions: rows, nextCursor: olderId });
const client = () => new RemotePrivateSkillHistoryClient(origin, session);
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function transport(reply: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  let calls = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = new URL(String(url)); expect(target.origin).toBe(origin); calls++;
    expect(target.pathname).toBe(`/api/v1/skills/${skillId}/versions`); expect(init?.method).toBe("GET"); expect(init?.body).toBeUndefined();
    expect(init?.credentials).toBe("omit"); expect(init?.redirect).toBe("error");
    expect(init?.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${session.token}`,
      "x-skills-user-id": userId, "x-skills-workspace-id": organizationId, "x-skills-membership-id": membershipId });
    return reply(target, init!);
  }) as typeof fetch;
  return () => calls;
}
test("private SDK history projects only bound metadata, exact dates and current version through both exports", async () => {
  const calls = transport(url => { expect(url.search).toBe(""); return Response.json({ ...history(), token: session.token,
    source: "discarded", versions: rows.map(row => ({ ...row, sourceArchiveStorageKey: "discarded", manifestText: session.token })) }); });
  const sdk: SdkHistory = await client().listVersions(skillId); const root: RootHistory = sdk;
  expect(root).toEqual(history()); expect(calls()).toBe(1);
  expect(JSON.stringify(root)).not.toContain(session.token); expect(JSON.stringify(client())).not.toContain(session.token);
  expect(Object.isFrozen(root.versions)).toBe(true);
});
test("private history retains PostgreSQL wire timestamps, offset spelling, fractions and nullable release dates", async () => {
  const timestamps: ReadonlyArray<readonly [createdAt: string, releasedAt: string | null]> = [
    ["2026-10-17 08:00:00.654321+00", "2026-10-17 09:00:00.123456+00"],
    ["2026-10-17 08:00:00+03", "2026-10-17 09:00:00.1-04"],
    ["2026-10-17 08:00:00.654321+05:30", "2026-10-17 09:00:00.123456-04:30"],
    ["2024-02-29T08:00:00.123456789Z", null],
  ];
  for (const [createdAt, releasedAt] of timestamps) {
    const versions = [{ ...rows[0], createdAt, releasedAt }, rows[1]];
    const calls = transport(() => Response.json({ ...history(), versions }));
    expect((await client().listVersions(skillId)).versions).toEqual(versions); expect(calls()).toBe(1);
  }
});
test("private history rejects impossible dates, malformed offsets and unsupported PostgreSQL wire forms", async () => {
  for (const field of ["releasedAt", "createdAt"]) for (const value of [
    "2026-02-30 08:00:00+00", "2025-02-29T08:00:00Z", "2026-13-17 08:00:00+00",
    "2026-10-17 24:00:00+00", "2026-10-17 08:60:00+00", "2026-10-17 08:00:60+00",
    "2026-10-17 08:00:00+24", "2026-10-17 08:00:00+05:60", "2026-10-17 08:00:00.1234567+00",
    "2026-10-17T08:00:00", "2026-10-17 08:00:00+00 trailing", "2026-10-17T08:00:00Z\n",
  ]) {
    const calls = transport(() => Response.json({ ...history(), versions: [{ ...rows[0], [field]: value }, rows[1]] }));
    await expect(client().listVersions(skillId)).rejects.toMatchObject({ code: "INVALID_PRIVATE_HISTORY_RESPONSE", uncertain: false });
    expect(calls()).toBe(1);
  }
});
test("pagination binds the exact requested cursor and preserves an empty page with its current pointer", async () => {
  const calls = transport(url => {
    expect(url.search).toBe(`?limit=1&cursor=${currentId}`);
    return Response.json({ ...history(), versions: [rows[1]], nextCursor: null });
  });
  expect((await client().listVersions(skillId, { limit: 1, cursor: currentId })).versions).toEqual([rows[1]]); expect(calls()).toBe(1);
  transport(() => Response.json({ ...history(), versions: [], nextCursor: null }));
  expect((await client().listVersions(skillId)).currentVersionId).toBe(currentId);
  transport(() => Response.json({ ...history(), versions: [], currentVersion: null, currentVersionId: null, nextCursor: null }));
  expect((await client().listVersions(skillId)).currentVersion).toBeNull();
});
test("viewer history has no write methods and does not weaken publication viewer/API-key refusals", async () => {
  transport(() => Response.json(history()));
  const viewer = new RemotePrivateSkillHistoryClient(origin, { ...session, user: { ...session.user, role: "viewer" } });
  expect((await viewer.listVersions(skillId)).skillId).toBe(skillId);
  for (const method of ["createSkill", "begin", "queue", "cancel", "upload"]) expect(method in viewer).toBe(false);
  expect(() => new RemotePrivatePublicationsClient(origin, { ...session, user: { ...session.user, role: "viewer" } })).toThrow();
  expect(() => new RemotePrivateSkillHistoryClient(origin, { ...session, token: "sk_synthetic-key" })).toThrow();
});
test("malformed IDs, limits, cursors and deadlines fail before any traffic", async () => {
  let calls = 0; globalThis.fetch = (() => { calls++; throw Error("Unexpected request"); }) as unknown as typeof fetch;
  for (const id of ["my-private-skill", skillId + "/source", "", skillId + "\n"])
    await expect(client().listVersions(id)).rejects.toMatchObject({ code: "INVALID_PRIVATE_HISTORY_INPUT", uncertain: false });
  for (const options of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { cursor: "bad" }, { timeoutMs: 0 }, { timeoutMs: 15001 }])
    await expect(client().listVersions(skillId, options)).rejects.toMatchObject({ code: "INVALID_PRIVATE_HISTORY_INPUT", uncertain: false });
  expect(calls).toBe(0);
});
test("foreign tenancy, skill identity, malformed current pointer, duplicate/reordered rows and unsafe values are refused", async () => {
  for (const change of [{ organizationId: userId }, { skillId: userId }, { slug: "bad/slug" }, { currentVersionId: null },
    { currentVersion: "1.0.0" }, { versions: [rows[0], rows[0]] }, { versions: [...rows].reverse() },
    { versions: [{ ...rows[0], version: "unsafe\u001b[0m" }] }, { versions: [{ ...rows[0], releasedAt: "invalid" }] },
    { versions: [{ ...rows[0], createdAt: null }] }, { nextCursor: currentId }, { versions: [], nextCursor: olderId }]) {
    const calls = transport(() => Response.json({ ...history(), ...change, token: session.token }));
    const error = await client().listVersions(skillId).catch((error: unknown) => error) as Error & { code: string };
    expect(error.code).toBe("INVALID_PRIVATE_HISTORY_RESPONSE"); expect(error.message).not.toContain(session.token); expect(calls()).toBe(1);
  }
  transport(() => Response.json(history()));
  await expect(client().listVersions(skillId, { limit: 1 })).rejects.toMatchObject({ code: "INVALID_PRIVATE_HISTORY_RESPONSE" });
  await expect(client().listVersions(skillId, { cursor: olderId })).rejects.toMatchObject({ code: "INVALID_PRIVATE_HISTORY_RESPONSE" });
});
test("response failures, redirects, invalid UTF-8 and oversized bodies are safe single-attempt read failures", async () => {
  for (const reply of [() => Response.json({ error: session.token }, { status: 401 }),
    () => Response.json({ code: "ACCOUNT_UNAVAILABLE", error: session.token }, { status: 403 }),
    () => Response.json({ code: "WORKSPACE_CONTEXT_CHANGED", error: session.token }, { status: 409 }),
    () => new Response(null, { status: 302, headers: { location: "https://invalid.example/?capability=synthetic" } }),
    () => Response.json(history(), { status: 201 }),
    () => new Response(new Uint8Array([255])), () => new Response("{}", { headers: { "content-length": "65537" } }),
    () => { throw Error(session.token); }]) {
    const calls = transport(reply); const error = await client().listVersions(skillId).catch((error: unknown) => error) as Error & { uncertain: boolean };
    expect(error).toBeInstanceOf(Error); expect(error.uncertain).toBe(false); expect(error.message).not.toContain(session.token);
    expect(error.message).not.toContain("capability="); expect(calls()).toBe(1);
  }
});
test("a deadline and abort bound a stalled read without another request or credential changes", async () => {
  const calls = transport(() => new Promise(() => {}));
  await expect(client().listVersions(skillId, { timeoutMs: 5 })).rejects.toMatchObject({ code: "PRIVATE_HISTORY_UNAVAILABLE", uncertain: false }); expect(calls()).toBe(1);
  const controller = new AbortController(); controller.abort();
  const before = calls(); await expect(client().listVersions(skillId, { signal: controller.signal })).rejects.toMatchObject({ uncertain: false }); expect(calls()).toBe(before);
});

test("existing public slug/API-key history keeps its original response and authentication contract", async () => {
  const row = { slug: "public-skill", version: "1.0.0", bundleSha256: "a".repeat(64), bundleByteSize: 42,
    createdAt: "2026-10-16T08:00:00.123456Z", current: true, storageKind: "fixture" };
  let calls = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe(`${origin}/api/v1/skills/public-skill/versions`); calls++;
    const headers = new Headers(init?.headers); expect(headers.get("authorization")).toBe("Bearer synthetic-public-key");
    expect(headers.has("x-skills-user-id")).toBe(false); return Response.json({ versions: [row] });
  }) as typeof fetch;
  expect(await new RemoteSkillsClient("synthetic-public-key", origin).listSkillVersions("public-skill")).toEqual([row]); expect(calls).toBe(1);
});
