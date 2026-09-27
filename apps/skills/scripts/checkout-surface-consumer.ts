#!/usr/bin/env bun
/** Exercise the selected archive's actual CLI and stdio MCP. No provider requests. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, sep } from "node:path";

const consumer = process.argv[2];
assert(consumer && isAbsolute(consumer), "Pass the absolute, isolated installed-consumer directory");
const root = realpathSync(join(consumer, "node_modules/@hasna/skills"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert.equal(pkg.name, "@hasna/skills");
const entry = (name: string) => { const path = realpathSync(join(root, name)); assert(path.startsWith(root + sep)); return path; };
const cli = entry(pkg.bin.skills), mcp = entry(pkg.bin["skills-mcp"]);
const scratch = mkdtempSync(join(tmpdir(), "skills-checkout-surfaces-"));
const preload = join(scratch, "fetch-fixture.ts"), ledger = join(scratch, "requests.jsonl");
const origin = "https://installed-checkout.example.test", credential = "synthetic-checkout-fixture";
writeFileSync(ledger, "", { mode: 0o600 });
writeFileSync(preload, `import assert from "node:assert/strict"; import {appendFileSync} from "node:fs";
let posts=0;
globalThis.fetch=async(input,init)=>{
 assert.equal(String(input),"${origin}/api/v1/billing/credits");
 assert.equal(init?.redirect,"error"); assert.equal(init?.credentials,"omit");
 const method=init?.method??"GET"; assert(["GET","POST"].includes(method));
 const body=method==="POST"?JSON.parse(String(init.body)):null;
 appendFileSync(process.env.QA_LEDGER,JSON.stringify({surface:process.env.QA_SURFACE,method,body})+"\\n");
 if(method==="GET")return Response.json([{id:"credits_100",credits:100}]);
 posts++; const phase=process.env.QA_PHASE??["unresolved","progress","ready","loss","ready"][posts-1];
 assert(phase,"unexpected automatic checkout retry");
 if(phase==="loss")throw Error("untrusted-network-message");
 return Response.json(phase==="ready"?{url:"https://checkout.example.test/session",requestIdempotencyKey:body.idempotencyKey}:
 {error:phase==="unresolved"?"credit checkout creation unresolved":"credit checkout in_progress",requestIdempotencyKey:body.idempotencyKey,detail:"untrusted-provider-message"},
 {status:phase==="ready"?200:phase==="unresolved"?503:409});
};`, { mode: 0o600 });
const phases = ["unresolved", "progress", "ready", "loss", "ready"];
const keys = (surface: string) => [`${surface}-checkout-0001`, `${surface}-checkout-0001`, `${surface}-checkout-0001`, `${surface}-checkout-0002`, `${surface}-checkout-0002`];
const rows = () => readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
function environment(surface: string, phase?: string) {
  const home = join(scratch, surface); mkdirSync(home, { recursive: true });
  return { PATH: "/usr/bin:/bin", HOME: home, TMPDIR: scratch, NO_COLOR: "1", TERM: "dumb",
    HASNA_HOME: join(home, "hasna"), HASNA_CONFIG_HOME: join(home, "config"), HASNA_SKILLS_DIR: join(home, "data"),
    HASNA_STATION: "checkout-consumer-no-owner", SKILLS_TEST_MODE: "1", HASNA_SKILLS_API_URL: origin,
    HASNA_SKILLS_API_KEY_OVERRIDE: credential, QA_LEDGER: ledger, QA_SURFACE: surface, ...(phase ? { QA_PHASE: phase } : {}) };
}
async function boundedText(stream: ReadableStream<Uint8Array>, limit = 128_000) {
  const reader = stream.getReader(), decoder = new TextDecoder(); let bytes = 0, value = "";
  try { while (true) { const part = await reader.read(); if (part.done) return value + decoder.decode();
    bytes += part.value.byteLength; assert(bytes <= limit, "Installed subprocess output limit"); value += decoder.decode(part.value, { stream: true });
  } } finally { reader.releaseLock(); }
}
function checkResponse(value: any, n: number, surface: string) {
  assert.equal(value.requestIdempotencyKey, keys(surface)[n]);
  if (n === 2 || n === 4) assert.equal(value.url, "https://checkout.example.test/session");
  else {
    assert.equal(value.code, n === 1 ? "CREDIT_CHECKOUT_IN_PROGRESS" : "CREDIT_CHECKOUT_UNCONFIRMED");
    assert.equal(value.status, n === 0 ? 503 : n === 1 ? 409 : 0);
  }
  const serialized = JSON.stringify(value);
  for (const forbidden of [credential, "untrusted-provider-message", "untrusted-network-message"]) assert(!serialized.includes(forbidden));
  assert.equal(rows().filter(row => row.surface === surface && row.method === "POST").length, n + 1, "Unexpected automatic retry");
}
try {
  for (const [n, phase] of phases.entries()) {
    const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", preload, cli, "credits", "buy", "credits_100", "--idempotency-key", keys("cli")[n]!, "--json"],
      { cwd: scratch, env: environment("cli", phase), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    try {
      const [stdout, stderr, code] = await Promise.all([boundedText(child.stdout), boundedText(child.stderr), child.exited]);
      assert(stdout.length + stderr.length < 128_000); assert.equal(stderr, "");
      assert.equal(code, n === 2 || n === 4 ? 0 : 1); checkResponse(JSON.parse(stdout), n, "cli");
    } finally { clearTimeout(timer); if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; } }
  }
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", preload, mcp, "--stdio"],
    { cwd: scratch, env: environment("mcp"), stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
  const reader = child.stdout.getReader(), decoder = new TextDecoder();
  let pending = "", outputBytes = 0;
  const stderr = boundedText(child.stderr);
  // Keep an early overflow rejection handled until the process cleanup joins it.
  void stderr.catch(() => child.kill("SIGKILL"));
  async function rpc(id: number, method: string, params: unknown) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    while (true) {
      const newline = pending.indexOf("\n");
      if (newline >= 0) {
        const value = JSON.parse(pending.slice(0, newline)); pending = pending.slice(newline + 1);
        if (value.id === undefined) continue;
        assert.equal(value.id, id); assert.equal(value.error, undefined); return value.result;
      }
      const part = await reader.read(); assert(!part.done, "MCP ended before its response");
      outputBytes += part.value.byteLength; assert(outputBytes <= 256_000, "MCP output limit"); pending += decoder.decode(part.value, { stream: true });
    }
  }
  try {
    await rpc(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "checkout-consumer", version: "1" } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const listed = await rpc(2, "tools/list", {}), tool = listed.tools.find((t: any) => t.name === "create_credit_checkout");
    assert(tool?.inputSchema.properties.idempotency_key, "Installed MCP must expose the caller key");
    for (let n = 0; n < 5; n++) {
      const value = await rpc(n + 3, "tools/call", { name: tool.name, arguments: { pack_id: "credits_100", idempotency_key: keys("mcp")[n] } });
      assert.equal(value.isError === true, n !== 2 && n !== 4); checkResponse(JSON.parse(value.content[0].text), n, "mcp");
    }
    child.stdin.end(); assert.equal(await child.exited, 0); assert.equal(await stderr, "");
  } finally { clearTimeout(timer); child.stdin.end(); if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; } reader.releaseLock(); }
  for (const surface of ["cli", "mcp"]) {
    assert.deepEqual(rows().filter(row => row.surface === surface && row.method === "POST").map(row => row.body), keys(surface).map(idempotencyKey => ({ packId: "credits_100", idempotencyKey })));
    assert.equal(rows().filter(row => row.surface === surface && row.method === "GET").length, 5);
  }
  console.log(JSON.stringify({ installedCheckoutSurfaces: ["cli", "mcp-stdio"], packageVersion: pkg.version, explicitAttemptsPerSurface: 5, totalCheckoutPosts: 10, automaticRetries: 0, transportLossRecovered: true, liveRequests: 0 }));
} finally { rmSync(scratch, { recursive: true, force: true }); }
