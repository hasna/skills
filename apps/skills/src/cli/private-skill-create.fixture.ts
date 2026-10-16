import { Command } from "commander";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerPrivatePublications } from "./commands/private-publications.js";
import { registerBrowse } from "./commands/list.js";
import { registerIntrospect } from "./commands/introspect.js";

// Real command, auth/session factory and SDK; only the transport is synthetic.
// Every probe pins a closed loopback target and cannot reach another origin.
const userId = "11111111-1111-4111-8111-111111111111";
const membershipId = "22222222-2222-4222-8222-222222222222";
const organizationId = "33333333-3333-4333-8333-333333333333";
const identity = { user: { id: userId, membershipId, email: "fixture@example.com", displayName: null, role: "member" },
  organization: { id: organizationId, slug: "fixture", name: "Fixture" } };
const scenario = process.env.SKILLS_CREATE_SCENARIO;
const metadataKey = process.env.HASNA_SKILLS_API_KEY_OVERRIDE ?? randomUUID();
if (["profile-change", "credential-file-change"].includes(scenario!)) {
  process.env.HASNA_PROFILE = "a";
  const config = join(process.env.HASNA_CONFIG_HOME!, "skills"); mkdirSync(config, { recursive: true });
  for (const profile of ["a", "b"]) writeFileSync(join(config, `credentials-${profile}`),
    `HASNA_SKILLS_API_KEY=${metadataKey}\nHASNA_SKILLS_API_URL=http://127.0.0.1:1\nHASNA_SKILLS_BOUND_API_URL=http://127.0.0.1:1\n`, { mode: 0o600 });
}
if (scenario?.endsWith("-change")) {
  const iterator = process.stdin[Symbol.asyncIterator].bind(process.stdin);
  process.stdin[Symbol.asyncIterator] = () => {
  if (scenario === "origin-change") process.env.HASNA_SKILLS_API_URL = "http://127.0.0.1:2";
  if (scenario === "profile-change") process.env.HASNA_PROFILE = "b";
  if (scenario === "credential-file-change") writeFileSync(join(process.env.HASNA_CONFIG_HOME!, "skills", "credentials-a"),
    `HASNA_SKILLS_API_KEY=${metadataKey}\nHASNA_SKILLS_API_URL=http://127.0.0.1:2\nHASNA_SKILLS_BOUND_API_URL=http://127.0.0.1:2\n`, { mode: 0o600 });
  writeFileSync(process.env.SKILLS_CREATE_WAITING!, "code pending");
  return iterator();
  };
}
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const target = new URL(String(url));
  if (!["http://127.0.0.1:1", "http://127.0.0.1:2"].includes(target.origin)) throw new Error("Fixture target refused");
  const path = target.pathname;
  const authenticated = new Headers(init?.headers).get("authorization") === "Bearer synthetic-session";
  const metadataAuthenticated = new Headers(init?.headers).get("authorization") === `Bearer ${metadataKey}`;
  appendFileSync(process.env.SKILLS_CREATE_TRACE!, JSON.stringify({ path, origin: target.origin, method: init?.method ?? "GET", authenticated, metadataAuthenticated }) + "\n");
  if (path === "/api/auth/verify") {
    if (scenario === "auth-refused") return Response.json({ error: "synthetic-session" }, { status: 401 });
    return Response.json({ token: "synthetic-session", user: identity.user });
  }
  if (!authenticated && !metadataAuthenticated) throw new Error("Fixture authorization refused");
  if (path === "/api/auth/whoami") return Response.json({ ...identity, authMethod: authenticated ? "jwt" : "api_key" });
  if (path === "/api/v1/account/workspaces/switch") return Response.json({ ...identity, token: "synthetic-session" });
  if (path === "/api/v1/skills" && init?.method === "POST") {
    if (!authenticated) throw new Error("Fixture session-only creation refused");
    if (scenario === "pro-refused") return Response.json({ code: "PLAN_REQUIRED", error: "synthetic-session" }, { status: 403 });
    if (scenario === "session-refused") return Response.json({ code: "INTERACTIVE_SESSION_REQUIRED", error: "synthetic-session" }, { status: 403 });
    const body = JSON.parse(String(init.body));
    const row = { id: "44444444-4444-4444-8444-444444444444", ...body, category: null, sourceType: "private_hosted", currentVersion: null };
    if (process.env.SKILLS_CREATE_ROW) writeFileSync(process.env.SKILLS_CREATE_ROW, JSON.stringify(row));
    if (scenario === "lost-response") throw new Error("synthetic-session https://invalid.example/?capability=synthetic");
    return Response.json({ ...row,
      metadata: { ownerOrganizationId: scenario === "foreign-tenant" ? userId : organizationId, nested: { token: "synthetic-session" } },
      uploadUrl: "https://invalid.example/?capability=synthetic" }, { status: 201 });
  }
  if (init?.method === undefined || init.method === "GET") {
    const rowFile = process.env.SKILLS_CREATE_ROW;
    const row = rowFile && existsSync(rowFile) ? JSON.parse(readFileSync(rowFile, "utf8")) : null;
    if (path === "/api/v1/skills") return Response.json(row ? [row] : []);
    if (path === "/api/v1/skills/my-private-skill") return row ? Response.json(row) : Response.json({}, { status: 404 });
  }
  throw new Error("Unexpected fixture route");
}) as typeof fetch;
const program = new Command();
registerPrivatePublications(program);
registerBrowse(program);
registerIntrospect(program);
await program.parseAsync(process.argv);
