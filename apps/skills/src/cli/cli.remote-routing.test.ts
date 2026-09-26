import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildCliFixture } from "./cli-build.fixture.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-remote-routing-"));
const installed = process.env.SKILLS_REMOTE_ROUTING_TEST_PACKAGE;
const binary = installed ? join(resolve(installed), "bin/index.js") : join(scratch, "skills.js");
const mcpBinary = installed ? join(resolve(installed), "bin/mcp.js") : join(scratch, "mcp.js");
beforeAll(async () => { if (!installed) { await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary); await buildCliFixture(resolve(import.meta.dir, "../mcp/index.ts"), mcpBinary); } });
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type Call = { path: string; method: string; body: any; authorization: string | null };
async function fixture(managed: boolean, named: boolean, action: (f: {
  cli: (args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  mcp: (args: Record<string, unknown>) => Promise<any>;
  calls: Call[]; project: string; prefix: string; credential: string;
}) => Promise<void>, malformedPolicy = false) {
  const root = mkdtempSync(join(scratch, "owned-"));
  for (const name of ["home", "config/skills", "data", "project", "empty-bin", "tmp"]) mkdirSync(join(root, name), { recursive: true });
  const calls: Call[] = [], defaultKey = randomUUID(), customerKey = randomUUID();
  const runId = "00000000-0000-4000-8000-000000000007";
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    calls.push({ path, method: request.method, body: request.method === "POST" ? await request.json() : null, authorization: request.headers.get("authorization") });
    if (path.endsWith("/quote")) return Response.json({ skill: "owned-paid-skill", pricing: { costCredits: 25 }, quoteReceipt: "owned.quote.receipt" });
    if (path.endsWith("/capabilities")) return Response.json({ contractVersion: 1, apiVersion: 1, capabilities: ["runs.submit"], billing: { unit: "credits", boundedRunApproval: true } });
    if (path.endsWith("/runs/owned-paid-skill")) return Response.json({ id: runId, skill: "owned-paid-skill", status: "queued" }, { status: 202 });
    if (path.endsWith(`/runs/${runId}/logs`)) return Response.json([]);
    // Route-only controls stop at the selected profile or explicit execution
    // endpoint, before any bundle loading or workload could execute.
    return Response.json({ code: "OWNED_ROUTE_STOP" }, { status: 503 });
  } });
  const config = join(root, "config/skills");
  writeFileSync(join(config, "credentials"), `HASNA_SKILLS_API_KEY=${defaultKey}\nHASNA_SKILLS_API_URL=${server.url.origin}/internal/api/v1\n`, { mode: 0o600 });
  writeFileSync(join(config, "credentials-customer"), `HASNA_SKILLS_API_KEY=${customerKey}\nHASNA_SKILLS_API_URL=${server.url.origin}/customer/api/v1\n`, { mode: 0o600 });
  if (managed) writeFileSync(join(root, "data/agent-policy.json"), malformedPolicy ? "{ invalid" : JSON.stringify({ loading: "cli", profileId: "engineering" }));
  const preserved = new Map(["config/skills/credentials", "config/skills/credentials-customer", ...(managed ? ["data/agent-policy.json"] : [])].map(path => [path, readFileSync(join(root, path))]));
  const guard = join(root, "guard.js");
  writeFileSync(guard, `import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const deny=()=>{throw Error('owned child-process boundary')};Bun.spawn=deny;Bun.spawnSync=deny;for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[k]=deny;syncBuiltinESMExports();const original=globalThis.fetch;globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(u.protocol!=="data:"&&u.origin!==${JSON.stringify(server.url.origin)})throw Error('owned network boundary');return original(input,init)};`);
  const env = { PATH: join(root, "empty-bin"), HOME: join(root, "home"), HASNA_HOME: join(root, "home/hasna"), HASNA_CONFIG_HOME: join(root, "config"),
    HASNA_SKILLS_DIR: join(root, "data"), ...(!named ? { HASNA_SKILLS_API_KEY_OVERRIDE: defaultKey, HASNA_SKILLS_API_URL: server.url.origin + "/internal/api/v1" } : {}), HASNA_STATION: "owned-remote-routing-no-keychain", TMPDIR: join(root, "tmp"), NO_COLOR: "1", TERM: "dumb", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" };
  const cli = async (args: string[]) => {
    const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, binary, ...(named ? ["--profile", "customer"] : []), ...args], {
      cwd: join(root, "project"), env, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 10_000);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(timedOut).toBe(false); expect(stdout.length + stderr.length).toBeLessThan(16_000);
      expect(stdout + stderr).not.toContain(defaultKey); expect(stdout + stderr).not.toContain(customerKey);
      return { stdout, stderr, exitCode };
    } finally { clearTimeout(timer); }
  };
  const mcp = async (args: Record<string, unknown>) => {
    const transport = new StdioClientTransport({ command: process.execPath, args: ["--no-env-file", "--preload", guard, mcpBinary, "--stdio"],
      cwd: join(root, "project"), env: { ...env, ...(named ? { HASNA_PROFILE: "customer" } : {}) }, stderr: "pipe" });
    const client = new Client({ name: "owned-routing", version: "1" });
    let timedOut = false, stderr = "";
    transport.stderr?.on("data", chunk => { stderr += String(chunk); });
    const timer = setTimeout(() => { timedOut = true; void transport.close(); }, 10_000);
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: "run_skill", arguments: args });
      expect(timedOut).toBe(false);
      const output = JSON.stringify(result) + stderr;
      expect(output).not.toContain(defaultKey); expect(output).not.toContain(customerKey);
      return result;
    } finally { clearTimeout(timer); await client.close(); }
  };
  try {
    await action({ cli, mcp, calls, project: join(root, "project"), prefix: named ? "/customer/api/v1" : "/internal/api/v1", credential: named ? customerKey : defaultKey });
    for (const [path, bytes] of preserved) expect(readFileSync(join(root, path))).toEqual(bytes);
    expect(readdirSync(join(root, "home"))).toEqual([]);
  } finally { await server.stop(true); rmSync(root, { recursive: true, force: true }); }
}

for (const managed of [false, true]) for (const named of [false, true]) {
  test(`explicit remote retains quote approval and instance credentials (managed=${managed}, named=${named})`, async () => {
    await fixture(managed, named, async ({ cli, calls, project, prefix, credential }) => {
      const denied = await cli(["run", "--remote", "--json", "owned-paid-skill"]);
      expect(denied.exitCode).toBe(1); expect(JSON.parse(denied.stdout).error).toContain("CREDIT_APPROVAL_REQUIRED");
      expect(calls.map(c => c.path)).toEqual([`${prefix}/skills/owned-paid-skill/quote`]);
      expect(existsSync(join(project, ".skills/runs"))).toBe(false);
      calls.length = 0;
      const args = ["--topic", "owned topic", "--input", "skill argument"];
      const admitted = await cli(["run", "--remote", "--yes", "--json", "--idempotency-key", "owned-admission", "owned-paid-skill", ...args]);
      expect(admitted.exitCode).toBe(0); expect(JSON.parse(admitted.stdout)).toMatchObject({ remote: true, remoteRun: { status: "queued" } });
      expect(calls.map(c => `${c.method} ${c.path}`)).toEqual([`POST ${prefix}/skills/owned-paid-skill/quote`, `GET ${prefix}/capabilities`, `POST ${prefix}/runs/owned-paid-skill`, `GET ${prefix}/runs/00000000-0000-4000-8000-000000000007/logs`]);
      expect(calls[0]!.body.args).toEqual(args);
      expect(calls[2]!.body).toMatchObject({ maxCredits: 25, quoteReceipt: "owned.quote.receipt", idempotencyKey: "owned-admission", args });
      expect(calls.every(c => c.authorization === `Bearer ${credential}`)).toBe(true);
    });
  });
  test(`explicit execution conflicts refuse before HTTP (managed=${managed}, named=${named})`, async () => {
    await fixture(managed, named, async ({ cli, calls, project }) => {
      for (const target of ["local", "cloud"]) {
        const result = await cli(["run", "--remote", "--target", target, "--yes", "--json", "owned-paid-skill"]);
        expect(result.exitCode).toBe(1); expect(result.stderr).toContain("Conflicting --remote and --target");
      }
      expect(calls).toEqual([]); expect(readdirSync(project)).toEqual([]);
    });
  });
}
for (const named of [false, true]) test(`managed default and explicit selection profile remain selected-bundle routes (named=${named})`, async () => {
  await fixture(true, named, async ({ cli, calls, prefix, credential }) => {
    for (const target of [undefined, "local", "cloud"]) for (const selection of [undefined, "specific"]) {
      calls.length = 0;
      const result = await cli(["run", "--json", ...(target ? ["--target", target] : []), ...(selection ? ["--selection-profile", selection] : []), "owned-paid-skill"]);
      expect(result.exitCode).toBe(1);
      expect(calls.map(c => `${c.method} ${c.path}`)).toEqual([`GET ${prefix}/profiles/${selection ?? "engineering"}/resolve`]);
      expect(calls[0]!.authorization).toBe(`Bearer ${credential}`);
    }
  });
});
test("unmanaged explicit cloud still selects the execution endpoint", async () => {
  await fixture(false, true, async ({ cli, calls, prefix }) => {
    const result = await cli(["run", "--target", "cloud", "--input", "{}", "owned-paid-skill@1.0.0"]);
    expect(result.exitCode).toBe(1); expect(calls.map(c => `${c.method} ${c.path}`)).toEqual([`POST ${prefix}/executions/owned-paid-skill`]);
  });
});

for (const managed of [false, true]) test(`remote separator preserves child execution-looking flags (managed=${managed})`, async () => {
  await fixture(managed, true, async ({ cli, calls, prefix }) => {
    const args = ["--target", "child-only", "--input", "child data", "--json", "--no-color", "--secret-bindings", "child-file", "", "--", "--remote"];
    const result = await cli(["run", "--remote", "--yes", "--json", "owned-paid-skill", "--", ...args]);
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(calls[0]!.path).toBe(`${prefix}/skills/owned-paid-skill/quote`);
    expect(calls[0]!.body.args).toEqual(args);
    expect(calls[2]!.body.args).toEqual(args);
    expect(JSON.parse(result.stdout).remote).toBe(true);
  });
});

test("cloud permits an empty separator but refuses child arguments without reinterpreting them", async () => {
  await fixture(false, true, async ({ cli, calls, prefix }) => {
    const wrapper = ["run", "owned-paid-skill@1.0.0", "--target", "cloud", "--input", '{"wrapper":true}', "--json", "--"];
    await cli(wrapper);
    expect(calls.map(c => `${c.method} ${c.path}`)).toEqual([`POST ${prefix}/executions/owned-paid-skill`]);
    expect(calls[0]!.body.input).toEqual({ wrapper: true });
    calls.length = 0;
    const result = await cli([...wrapper, "--input", "child data", "--json"]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error).toBe("Cloud execution accepts structured --input only");
    expect(calls).toEqual([]);
  });
});

test("literal option values do not become separators or global color flags", async () => {
  await fixture(true, true, async ({ cli, calls }) => {
    for (const key of ["--", "--no-color"]) for (const beforeSkill of [false, true]) {
      calls.length = 0;
      const args = ["prepare", "--no-color", "--", "--json"];
      const result = await cli(["run", "--remote", "--yes", "--json", "--idempotency-key", key, "--no-color", ...(beforeSkill ? ["--"] : []), "owned-paid-skill", ...(beforeSkill ? [] : ["--"]), ...args]);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(calls[0]!.body.args).toEqual(args);
      expect(calls[2]!.body).toMatchObject({ idempotencyKey: key, args });
    }
  });
});

test("malformed managed policy still refuses remote and default execution without transport", async () => {
  await fixture(true, true, async ({ cli, calls, project }) => {
    for (const remote of [false, true]) {
      const result = await cli(["run", "--json", ...(remote ? ["--remote"] : []), "owned-paid-skill"]);
      expect(result.exitCode).toBe(1); expect(JSON.parse(result.stdout).error).toContain("policy is unreadable");
    }
    expect(calls).toEqual([]); expect(readdirSync(project)).toEqual([]);
  }, true);
});

for (const managed of [false, true]) for (const named of [false, true]) test(`MCP explicit remote preserves approval and instance routing (managed=${managed}, named=${named})`, async () => {
  await fixture(managed, named, async ({ mcp, calls, prefix, credential }) => {
    const denied = await mcp({ name: "owned-paid-skill", remote: true });
    expect(denied.isError).toBe(true); expect(JSON.stringify(denied)).toContain("approved maximum");
    expect(calls.map(c => c.path)).toEqual([`${prefix}/skills/owned-paid-skill/quote`]);
    calls.length = 0;
    const mismatch = await mcp({ name: "owned-paid-skill", remote: true, maxCredits: 25, maxCostCents: 24, quoteReceipt: "owned.quote.receipt" });
    expect(mismatch.isError).toBe(true); expect(JSON.stringify(mismatch)).toContain("Credit approval fields disagree"); expect(calls).toEqual([]);
    const admitted = await mcp({ name: "owned-paid-skill", remote: true, maxCredits: 25, quoteReceipt: "owned.quote.receipt", idempotency_key: "owned-mcp-admission", input: { topic: "owned" }, args: ["--input", "skill argument"], detail: true });
    expect(admitted.isError).not.toBe(true); expect(JSON.parse(admitted.content[0].text)).toMatchObject({ remote: true, status: "queued" });
    // An already approved receipt is sent unchanged without requesting another quote.
    expect(calls.map(c => `${c.method} ${c.path}`)).toEqual([`GET ${prefix}/capabilities`, `POST ${prefix}/runs/owned-paid-skill`]);
    expect(calls[1]!.body).toMatchObject({ maxCredits: 25, maxCostCents: 25, quoteReceipt: "owned.quote.receipt", idempotencyKey: "owned-mcp-admission", input: { topic: "owned" }, args: ["--input", "skill argument"] });
    expect(calls.every(c => c.authorization === `Bearer ${credential}`)).toBe(true);
    calls.length = 0;
    for (const target of ["local", "cloud"]) {
      const conflict = await mcp({ name: "owned-paid-skill", remote: true, target, maxCredits: 25 });
      expect(conflict.isError).toBe(true); expect(JSON.stringify(conflict)).toContain("CONFLICTING_EXECUTION_MODES");
    }
    expect(calls).toEqual([]);
  });
});
for (const named of [false, true]) test(`MCP managed defaults preserve selected profile routing (named=${named})`, async () => {
  await fixture(true, named, async ({ mcp, calls, prefix }) => {
    for (const target of [undefined, "local", "cloud"]) {
      calls.length = 0;
      const result = await mcp({ name: "owned-paid-skill", ...(target ? { target } : {}) });
      expect(result.isError).toBe(true);
      expect(calls.map(c => `${c.method} ${c.path}`)).toEqual([`GET ${prefix}/profiles/engineering/resolve`]);
    }
  });
});
test("MCP malformed managed policy still refuses explicit remote before transport", async () => {
  await fixture(true, true, async ({ mcp, calls }) => {
    const result = await mcp({ name: "owned-paid-skill", remote: true });
    expect(result.isError).toBe(true); expect(JSON.stringify(result)).toContain("INVALID_AGENT_POLICY"); expect(calls).toEqual([]);
  }, true);
});
