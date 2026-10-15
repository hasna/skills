import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliInCwd } from "./cli.test-utils.js";
import { packSkillBundle } from "../lib/skill-bundle.js";
import { selectedProfileId } from "./commands/context.js";
import { readManagedSkillPolicy, requiresCliSkillLoading } from "../lib/managed-policy.js";
import { registerDiscoveryTools } from "../mcp/discovery-tools.js";
import { registerOperationTools } from "../mcp/operation-tools.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
const roots: string[] = [], servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => { servers.splice(0).forEach(server => server.stop(true)); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
function dir() { const root = mkdtempSync(join(tmpdir(), "skills-managed-test-")); roots.push(root); return root; }
function fixture(options: { operation?: string; runtimeEntrypoint?: string; commandEntry?: string; otherEntry?: string } = {}) {
  const source = dir(), data = dir(), cwd = dir();
  writeFileSync(join(source, "SKILL.md"), "---\nname: managed-review\ndescription: Managed review\nkind: instruction\n---\nExact published instructions.");
  if (options.operation) {
    mkdirSync(join(source, "scripts"));
    writeFileSync(join(source, "scripts", "check.ts"), options.operation);
    if (options.otherEntry) writeFileSync(join(source, "scripts", "other.ts"), options.otherEntry);
    writeFileSync(join(source, "skill.json"), JSON.stringify({ kind: "instruction",
      commands: [{ name: "check", description: "Check one draft.", entry: options.commandEntry ?? "scripts/check.ts" }],
      runtime: { runtime: "bun", entrypoint: options.runtimeEntrypoint ?? "scripts/check.ts", timeout: 60 } }));
  }
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "managed-review", version: "1.0.0", skills: { kind: "instruction" } }));
  const bundle = packSkillBundle(source), requests: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request): Response {
    const path = new URL(request.url).pathname; requests.push(`${request.method} ${path}`);
    const authority: string = `${new URL(request.url).origin}/api/v1`;
    const selection = { authority, workspaceId: "workspace", profileRevision: "revision", slug: "managed-review", version: "1.0.0", bundleDigest: `sha256:${bundle.sha256}` };
    if (path === "/api/v1/profiles/engineering/resolve") return Response.json({ authority, workspaceId: "workspace", profileId: "engineering", profileRevision: "revision", selections: [selection] });
    if (path === "/api/v1/skills/managed-review/versions/1.0.0/bundle") return new Response(bundle.bytes);
    return new Response("Fixture route not found", { status: 404 });
  } }); servers.push(server);
  writeFileSync(join(data, "agent-policy.json"), JSON.stringify({ version: 1, loading: "cli", profileId: "engineering" }));
  const draft = join(data, "installed", "managed-review"); mkdirSync(draft, { recursive: true }); writeFileSync(join(draft, "SKILL.md"), "Edited local draft must survive.");
  return { data, cwd, draft, requests, env: { HOME: dir(), HASNA_HOME: join(data, "hasna"), HASNA_SKILLS_DIR: data, HASNA_SKILLS_API_KEY: "managed-fixture-key", HASNA_SKILLS_API_URL: `http://127.0.0.1:${server.port}`, HASNA_SKILLS_LOCAL: "0" } };
}
test("managed pull consumes exact profile selections and preserves edited native corpus", async () => {
  const f = fixture();
  for (const args of [["pull", "managed-review@1.0.0", "--json"], ["pull", "--all", "--json"]]) {
    const result = await runCliInCwd(args, f.cwd, f.env); expect(result.exitCode).toBe(0); expect(result.stdout).toContain('"version":"1.0.0"');
  }
  const rejected = await runCliInCwd(["pull", "managed-review@2.0.0", "--json"], f.cwd, f.env);
  expect(rejected.exitCode).toBe(1); expect(readFileSync(join(f.draft, "SKILL.md"), "utf8")).toBe("Edited local draft must survive.");
  expect(f.requests.every(request => request.startsWith("GET "))).toBe(true); expect(existsSync(join(f.cwd, ".claude", "skills"))).toBe(false);
});
test("managed cloud sync consumes only; publication and deletion resurrection are refused", async () => {
  const f = fixture();
  const dry = await runCliInCwd(["cloud", "sync", "--dry-run", "--json"], f.cwd, f.env);
  expect(dry.exitCode).toBe(0); expect(existsSync(join(f.data, "selection-cache"))).toBe(false);
  const synced = await runCliInCwd(["cloud", "sync", "--json"], f.cwd, f.env); expect(synced.exitCode).toBe(0); expect(JSON.parse(synced.stdout).direction).toBe("pull");
  f.requests.length = 0;
  for (const flag of ["--push", "--all"]) {
    const rejected = await runCliInCwd(["cloud", "sync", flag, "--json"], f.cwd, f.env); expect(rejected.exitCode).toBe(1); expect(rejected.stdout).toContain("skills push");
  }
  expect(f.requests).toEqual([]); expect(readFileSync(join(f.draft, "SKILL.md"), "utf8")).toContain("Edited local draft");
});
test("managed run executes a declared instruction operation and still refuses a prose-only instruction skill", async () => {
  const proseOnly = fixture();
  const refused = await runCliInCwd(["run", "managed-review@1.0.0", "--json"], proseOnly.cwd, proseOnly.env);
  expect(refused.exitCode).toBe(1); expect(refused.stdout).toContain("Use skills load instead of skills run");
  const f = fixture({ operation: 'console.log(`check: 0 error(s) for ${process.argv[2] ?? "no draft"}`)' });
  const run = await runCliInCwd(["run", "managed-review@1.0.0", "--json", "--", "draft.md"], f.cwd, f.env);
  expect(run.exitCode).toBe(0);
  const result = JSON.parse(run.stdout);
  expect(result.stdout.trim()).toBe("check: 0 error(s) for draft.md");
  expect(result.selection).toMatchObject({ slug: "managed-review", version: "1.0.0" });
  expect(result.selection.bundleDigest).toMatch(/^sha256:[a-f0-9]{64}$/); expect(result.target).toBe("local");
  expect(readFileSync(join(f.draft, "SKILL.md"), "utf8")).toBe("Edited local draft must survive.");
  expect(f.requests.every(request => request.startsWith("GET "))).toBe(true);
});
test("managed run refuses an inconsistent or missing declared operation through the CLI", async () => {
  // Disagreement between the declared command entry and runtime.entrypoint refuses; the other file never runs.
  const disagreeing = fixture({ operation: 'console.log("declared-command-entry")', otherEntry: 'console.log("other-entrypoint-ran")', runtimeEntrypoint: "scripts/other.ts" });
  const refused = await runCliInCwd(["run", "managed-review@1.0.0", "--json"], disagreeing.cwd, disagreeing.env);
  expect(refused.exitCode).toBe(1); expect(refused.stdout).toContain("runtime.entrypoint");
  expect(refused.stdout).not.toContain("other-entrypoint-ran"); expect(refused.stdout).not.toContain("declared-command-entry");
  // A declared command entry that is not in the bundle refuses even though runtime.entrypoint exists.
  const missing = fixture({ operation: 'console.log("declared-command-entry")', commandEntry: "scripts/missing.ts" });
  const refusedMissing = await runCliInCwd(["run", "managed-review@1.0.0", "--json"], missing.cwd, missing.env);
  expect(refusedMissing.exitCode).toBe(1); expect(refusedMissing.stdout).toContain("scripts/missing.ts");
  expect(refusedMissing.stdout).not.toContain("declared-command-entry");
  expect(disagreeing.requests.every(request => request.startsWith("GET "))).toBe(true);
});
test("managed policy profile is honored and malformed policy never falls back", () => {
  const f = fixture(); const previous = process.env.HASNA_SKILLS_DIR, selection = process.env.HASNA_SKILLS_SELECTION_PROFILE;
  try {
    process.env.HASNA_SKILLS_DIR = f.data; delete process.env.HASNA_SKILLS_SELECTION_PROFILE;
    expect(requiresCliSkillLoading()).toBe(true); expect(selectedProfileId()).toBe("engineering"); expect(selectedProfileId("explicit")).toBe("explicit");
    process.env.HASNA_SKILLS_SELECTION_PROFILE = "environment"; expect(selectedProfileId()).toBe("environment");
    writeFileSync(join(f.data, "agent-policy.json"), "invalid"); expect(() => readManagedSkillPolicy()).toThrow("refusing legacy fallback");
  } finally { if (previous === undefined) delete process.env.HASNA_SKILLS_DIR; else process.env.HASNA_SKILLS_DIR = previous; if (selection === undefined) delete process.env.HASNA_SKILLS_SELECTION_PROFILE; else process.env.HASNA_SKILLS_SELECTION_PROFILE = selection; }
});
test("managed MCP docs and pins use exact selection and instruction run cannot execute mutable corpus", async () => {
  const f = fixture(), previousCwd = process.cwd(), prior = Object.fromEntries(Object.keys(f.env).map(key => [key, process.env[key]]));
  const selection = process.env.HASNA_SKILLS_SELECTION_PROFILE;
  try {
    Object.assign(process.env, f.env); delete process.env.HASNA_SKILLS_SELECTION_PROFILE; process.chdir(f.cwd);
    const handlers = new Map<string, (args: any) => Promise<any>>();
    const server = { registerTool: (name: string, _schema: unknown, callback: any) => handlers.set(name, callback) };
    registerDiscoveryTools(server as any); registerOperationTools(server as any);
    const docs = await handlers.get("get_skill_docs")!({ name: "managed-review@1.0.0" });
    expect(docs.content[0].text).toContain("Exact published instructions"); expect(docs.isError).not.toBe(true); const payload = JSON.parse(docs.content[0].text); expect(payload.content).not.toContain("Edited local draft"); expect(payload.selection.version).toBe("1.0.0");
    const pin = await handlers.get("pin_skill")!({ name: "managed-review@1.0.0" }); expect(pin.isError).not.toBe(true); expect(existsSync(join(f.cwd, ".skills", "selection.lock.json"))).toBe(true);
    const run = await handlers.get("run_skill")!({ name: "managed-review@1.0.0" }); expect(run.isError).toBe(true); expect(run.content[0].text).toContain("INSTRUCTION_SKILL");
    const native = await handlers.get("pin_skill")!({ name: "managed-review", for: "claude" }); expect(native.isError).toBe(true); expect(native.content[0].text).toContain("NATIVE_SKILL_EXPORT_DISABLED");
    expect(readFileSync(join(f.draft, "SKILL.md"), "utf8")).toContain("Edited local draft"); expect(f.requests.every(request => request.startsWith("GET "))).toBe(true);
  } finally { process.chdir(previousCwd); for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } if (selection === undefined) delete process.env.HASNA_SKILLS_SELECTION_PROFILE; else process.env.HASNA_SKILLS_SELECTION_PROFILE = selection; }
});
