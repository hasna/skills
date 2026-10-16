import { Command } from "commander";
import { appendFileSync } from "node:fs";
import { registerPrivatePublications } from "./commands/private-publications.js";

// Real command, auth/session factory and SDK; only the transport is synthetic.
// Every probe pins a closed loopback target and cannot reach another origin.
const userId = "11111111-1111-4111-8111-111111111111";
const membershipId = "22222222-2222-4222-8222-222222222222";
const organizationId = "33333333-3333-4333-8333-333333333333";
const identity = { user: { id: userId, membershipId, email: "fixture@example.com", displayName: null, role: "member" },
  organization: { id: organizationId, slug: "fixture", name: "Fixture" } };
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const target = new URL(String(url));
  if (target.origin !== "http://127.0.0.1:1") throw new Error("Fixture target refused");
  const path = target.pathname, scenario = process.env.SKILLS_CREATE_SCENARIO;
  const authenticated = new Headers(init?.headers).get("authorization") === "Bearer synthetic-session";
  appendFileSync(process.env.SKILLS_CREATE_TRACE!, JSON.stringify({ path, method: init?.method ?? "GET", authenticated }) + "\n");
  if (path === "/api/auth/verify") {
    if (scenario === "auth-refused") return Response.json({ error: "synthetic-session" }, { status: 401 });
    return Response.json({ token: "synthetic-session", user: identity.user });
  }
  if (!authenticated) throw new Error("Fixture authorization refused");
  if (path === "/api/auth/whoami") return Response.json({ ...identity, authMethod: "jwt" });
  if (path === "/api/v1/account/workspaces/switch") return Response.json({ ...identity, token: "synthetic-session" });
  if (path === "/api/v1/skills" && init?.method === "POST") {
    if (scenario === "lost-response") throw new Error("synthetic-session https://invalid.example/?capability=synthetic");
    if (scenario === "pro-refused") return Response.json({ code: "PLAN_REQUIRED", error: "synthetic-session" }, { status: 403 });
    if (scenario === "session-refused") return Response.json({ code: "INTERACTIVE_SESSION_REQUIRED", error: "synthetic-session" }, { status: 403 });
    const body = JSON.parse(String(init.body));
    return Response.json({ id: "44444444-4444-4444-8444-444444444444", ...body, category: null, sourceType: "private_hosted",
      metadata: { ownerOrganizationId: scenario === "foreign-tenant" ? userId : organizationId, nested: { token: "synthetic-session" } },
      uploadUrl: "https://invalid.example/?capability=synthetic" }, { status: 201 });
  }
  throw new Error("Unexpected fixture route");
}) as typeof fetch;
const program = new Command();
registerPrivatePublications(program);
await program.parseAsync(process.argv);
