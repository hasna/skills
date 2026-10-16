import { afterEach, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
import { RemotePrivatePublicationsClient } from "./remote-private-publications.js";
import type { CreatePrivateSkillInput as RootInput, CreatedPrivateSkill as RootResult } from "../index.js";
import type { CreatePrivateSkillInput as SdkInput, CreatedPrivateSkill as SdkResult } from "../sdk/index.js";

useDefaultTestTimeout();
const origin = "http://127.0.0.1:1";
const userId = "11111111-1111-4111-8111-111111111111";
const membershipId = "22222222-2222-4222-8222-222222222222";
const organizationId = "33333333-3333-4333-8333-333333333333";
const skillId = "44444444-4444-4444-8444-444444444444";
const session = { token: "synthetic-session", user: { id: userId, membershipId, email: "fixture@example.com", displayName: null, role: "member" as const },
  organization: { id: organizationId, slug: "fixture", name: "Fixture" } };
const input = () => ({ slug: "my-private-skill", displayName: "My private skill", description: "Fixture description", confirm: true as const });
const response = () => ({ id: skillId, slug: "my-private-skill", displayName: "My private skill", description: "Fixture description", category: null,
  visibility: "private", sourceType: "private_hosted", metadata: { ownerOrganizationId: organizationId } });
const client = () => new RemotePrivatePublicationsClient(origin, session);
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function mockFetch(callback: (url: string, init: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe(`${origin}/api/v1/skills`);
    expect(init?.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${session.token}` });
    expect(init?.redirect).toBe("error"); expect(init?.credentials).toBe("omit");
    return Promise.resolve(callback(String(url), init!));
  }) as typeof fetch;
}

test("session SDK creates one private skill and projects only bound scalar identifiers", async () => {
  let calls = 0;
  mockFetch((_url, init) => {
    calls++;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ slug: "my-private-skill", displayName: "My private skill", description: "Fixture description", visibility: "private" });
    return Response.json({ ...response(), token: session.token, uploadUrl: "https://invalid.example/?capability=synthetic", metadata: { ...response().metadata, nested: { token: session.token } } }, { status: 201 });
  });
  const rootInput: RootInput = input(), sdkInput: SdkInput = rootInput;
  const result: SdkResult = await client().createSkill(sdkInput);
  const rootResult: RootResult = result;
  expect(rootResult.id).toBe(skillId);
  expect(result).toEqual({ id: skillId, slug: "my-private-skill", visibility: "private", sourceType: "private_hosted", ownerOrganizationId: organizationId });
  expect(JSON.stringify(result)).not.toContain(session.token);
  expect(JSON.stringify(client())).not.toContain(session.token);
  expect(calls).toBe(1);
});

test("team visibility and optional description are explicit in the captured create request", async () => {
  const request = { slug: "team-skill", displayName: "Team skill", visibility: "team" as const, confirm: true as const };
  mockFetch((_url, init) => {
    expect(JSON.parse(String(init.body))).toEqual({ slug: "team-skill", displayName: "Team skill", visibility: "team", description: "" });
    return Response.json({ ...response(), slug: "team-skill", displayName: "Team skill", visibility: "team", description: "" }, { status: 201 });
  });
  expect((await client().createSkill(request)).visibility).toBe("team");
});

test("invalid create fields and missing consent are refused before any request", async () => {
  let calls = 0; globalThis.fetch = (() => { calls++; throw new Error("unexpected request"); }) as unknown as typeof fetch;
  for (const change of [ { confirm: false }, { confirm: undefined }, { slug: "Bad-Slug" }, { slug: "-leading" }, { slug: "trailing-" },
    { slug: "two--hyphens" }, { slug: "with_space" }, { slug: "a".repeat(129) }, { displayName: " " }, { displayName: "line\nbreak" },
    { description: "a".repeat(8193) }, { visibility: "public" }, { visibility: "unlisted" }, { apiKey: "unexpected" } ]) {
    await expect(client().createSkill({ ...input(), ...change } as never)).rejects.toMatchObject({ uncertain: false });
  }
  expect(calls).toBe(0);
});

test("API-key-shaped sessions and viewer memberships cannot create skills", () => {
  expect(() => new RemotePrivatePublicationsClient(origin, { ...session, token: "sk_fixture" })).toThrow();
  expect(() => new RemotePrivatePublicationsClient(origin, { ...session, user: { ...session.user, role: "viewer" } })).toThrow("cannot manage");
});

for (const [code, status] of [["PLAN_REQUIRED", 403], ["INTERACTIVE_SESSION_REQUIRED", 403], ["SESSION_EXPIRED", 401],
  ["ACCOUNT_UNAVAILABLE", 403], ["INVALID_SLUG", 400], ["INVALID_DISPLAY_NAME", 400], ["INVALID_VISIBILITY", 400], ["SLUG_CONFLICT", 409]] as const) {
  test(`create refuses ${code} without rendering foreign response text or retrying`, async () => {
    let calls = 0;
    mockFetch(() => { calls++; return Response.json({ code, error: session.token, nested: { uploadUrl: "https://invalid.example/?capability=synthetic" } }, { status }); });
    const error = await client().createSkill(input()).catch((e: unknown) => e) as Error & { code: string; uncertain: boolean; status: number };
    expect(error.code).toBe(code); expect(error.status).toBe(status); expect(error.uncertain).toBe(false);
    expect(error.message).not.toContain(session.token); expect(error.message).not.toContain("capability="); expect(calls).toBe(1);
  });
}

for (const change of [{ id: "invalid" }, { slug: "different-skill" }, { visibility: "public" }, { sourceType: "public" },
  { displayName: "Foreign display name" }, { description: "Foreign description" }, { metadata: {} },
  { metadata: { ownerOrganizationId: "55555555-5555-4555-8555-555555555555" } }]) {
  test(`create treats an unbound response as uncertain (${Object.keys(change)[0]})`, async () => {
    let calls = 0; mockFetch(() => { calls++; return Response.json({ ...response(), ...change }, { status: 201 }); });
    await expect(client().createSkill(input())).rejects.toMatchObject({ code: "SKILL_CREATE_UNCONFIRMED", uncertain: true });
    expect(calls).toBe(1);
  });
}

test("lost POST, malformed success, oversized response and mismatched failure never retry", async () => {
  for (const result of [() => { throw new Error(session.token); }, () => new Response("not json", { status: 201 }),
    () => Response.json(response(), { status: 200 }),
    () => new Response("{}", { status: 201, headers: { "content-length": "65537" } }),
    () => Response.json({ code: "PLAN_REQUIRED", error: session.token }, { status: 500 })]) {
    let calls = 0; mockFetch(() => { calls++; return result(); });
    const error = await client().createSkill(input()).catch((e: unknown) => e) as Error & { uncertain: boolean };
    expect(error.uncertain).toBe(true); expect(error.message).toContain("Inspect");
    expect(error.message).not.toContain(session.token); expect(calls).toBe(1);
  }
});

test("a create deadline bounds an unresponsive response without another POST", async () => {
  let calls = 0; mockFetch(() => { calls++; return new Promise(() => {}); });
  await expect(client().createSkill(input(), { timeoutMs: 5 })).rejects.toMatchObject({ code: "SKILL_CREATE_UNCONFIRMED", uncertain: true });
  expect(calls).toBe(1);
});
