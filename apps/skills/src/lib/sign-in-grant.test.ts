import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAuthFilePath } from "./auth-store.js";
import { resolveSkillsConnection } from "./fleet-credentials.js";
import { RemoteSkillsClient } from "./remote-client.js";
import { persistSignIn } from "./sign-in.js";

const origin = "https://skills.md";
const originalFetch = globalThis.fetch;
// Deliberately inert strings; every request is intercepted before transport.
const session = "inert-session";
const issuedKey = "inert-issued-key";

afterEach(() => { globalThis.fetch = originalFetch; });

function isolatedEnv() {
  const home = mkdtempSync(join(tmpdir(), "skills-sign-in-grant-"));
  return {
    HOME: home,
    HASNA_HOME: join(home, ".hasna"),
    HASNA_CONFIG_HOME: join(home, "config"),
    HASNA_PROFILE: "sign-in-grant-fixture",
    HASNA_SKILLS_API_URL: origin,
  };
}

function intercept(handler: (url: URL, init: RequestInit) => Response) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    expect(url.origin).toBe(origin);
    expect(init?.redirect).toBe("error");
    return handler(url, init ?? {});
  }) as typeof fetch;
}

describe("hosted CLI sign-in key grant", () => {
  test("returning-customer sign-in persists a key that can read billing", async () => {
    const env = isolatedEnv();
    let keyRequests = 0;
    let granted: string[] = [];
    intercept((url, init) => {
      if (url.pathname === "/api/auth/keys") {
        keyRequests++;
        const body = JSON.parse(String(init.body));
        expect(body.name).toBe("cli");
        // The generic server default remains deliberately least-privilege.
        granted = body.scopes ?? ["skills:read", "skills:run", "runs:read", "connectors:read"];
        return Response.json({ key: issuedKey });
      }
      if (url.pathname === "/api/v1/billing/status") {
        return granted.includes("billing:read")
          ? Response.json({ creditBalance: 123 })
          : Response.json({ code: "INSUFFICIENT_SCOPE" }, { status: 403 });
      }
      throw new Error("Unexpected fixture request");
    });

    await persistSignIn({ token: session, firstLogin: false, user: { role: "member" } }, origin, env);
    const connection = await resolveSkillsConnection(env);
    expect(connection?.apiOrigin).toBe(origin);
    if (!connection) throw new Error("Fixture profile did not resolve");
    const billing = await new RemoteSkillsClient(connection.apiKey, connection.apiOrigin).getBillingStatus();
    expect(billing.creditBalance).toBe(123);
    expect(keyRequests).toBe(1);
    expect(granted).toEqual([
      "skills:read", "skills:run", "runs:read", "connectors:read",
      "connectors:write", "billing:read", "billing:write",
    ]);
    expect(statSync(getAuthFilePath(env)).mode & 0o777).toBe(0o600);
  });

  test("an already-issued device or first-login key is reused without another grant", async () => {
    const env = isolatedEnv();
    let calls = 0;
    intercept(() => { calls++; throw new Error("Unexpected key issuance"); });
    await persistSignIn({ apiKey: issuedKey, token: session, user: { role: "viewer" } }, origin, env);
    const connection = await resolveSkillsConnection(env);
    expect(Boolean(connection && connection.apiKey === issuedKey)).toBe(true);
    expect(calls).toBe(0);
  });

  test("generic key creation preserves explicit caller scopes", async () => {
    let body: Record<string, unknown> = {};
    intercept((url, init) => {
      expect(url.pathname).toBe("/api/auth/keys");
      body = JSON.parse(String(init.body));
      return Response.json({ key: issuedKey });
    });
    await new RemoteSkillsClient(session, origin).createApiKey("automation", ["runs:read"]);
    expect(body).toEqual({ name: "automation", scopes: ["runs:read"] });
  });

  test("generic key creation still leaves omitted scopes to the server", async () => {
    let body: Record<string, unknown> = {};
    intercept((_url, init) => {
      body = JSON.parse(String(init.body));
      return Response.json({ key: issuedKey });
    });
    await new RemoteSkillsClient(session, origin).createApiKey("cli");
    expect(body).toEqual({ name: "cli" });
  });

  test("a role refusal is propagated without retry or profile persistence", async () => {
    const env = isolatedEnv();
    let calls = 0;
    intercept(() => { calls++; return Response.json({ error: "interactive session required" }, { status: 403 }); });
    await expect(persistSignIn({ token: session, user: { role: "viewer" } }, origin, env)).rejects.toThrow();
    expect(calls).toBe(1);
    expect(existsSync(getAuthFilePath(env))).toBe(false);
  });

  test("a redirect response is refused without storing a key or following it", async () => {
    const env = isolatedEnv();
    let calls = 0;
    intercept(() => { calls++; return new Response(null, { status: 302, headers: { Location: "https://example.invalid/" } }); });
    await expect(persistSignIn({ token: session }, origin, env)).rejects.toThrow();
    expect(calls).toBe(1);
    expect(existsSync(getAuthFilePath(env))).toBe(false);
  });
});
