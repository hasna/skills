import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-run-polling-"));
// Select the actual npm-installed release candidate for distribution acceptance.
const installed = process.env.SKILLS_RUN_POLLING_TEST_PACKAGE;
const binary = installed ? join(resolve(installed), "bin/index.js") : join(scratch, "skills.js");
beforeAll(async () => { if (!installed) await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary); });
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function snapshot(path: string): unknown {
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (stat.isDirectory()) return [stat.mode, stat.ino, stat.mtimeMs, readdirSync(path).sort().map(name => [name, snapshot(join(path, name))])];
  if (!stat.isFile()) throw Error("Unexpected fixture file type");
  return [stat.mode, stat.ino, stat.mtimeMs, createHash("sha256").update(readFileSync(path)).digest("hex")];
}

async function fixture(action: (cli: (args: string[], observe?: (stop: (signal?: "SIGINT" | "SIGTERM") => void) => Promise<void>) => Promise<{ stdout: string; stderr: string; exitCode: number }>, requests: string[], paths: string[], polling: { first: Promise<void>; firstLog: Promise<void>; count: () => number; origin: string }) => Promise<void>, wait = false) {
  const root = mkdtempSync(join(scratch, "owned-"));
  const home = join(root, "home"), project = join(root, "project"), data = join(root, "data");
  for (const path of [home, project, data, join(root, "tmp"), join(root, "empty-bin")]) mkdirSync(path);
  writeFileSync(join(home, "keep.txt"), "owned home preservation\n");
  writeFileSync(join(project, "keep.txt"), "owned project preservation\n");
  const requests: string[] = [];
  let polls = 0, arrived!: () => void;
  const first = new Promise<void>(resolve => { arrived = resolve; });
  let logArrived!: () => void;
  const firstLog = new Promise<void>(resolve => { logArrived = resolve; });
  const runId = "00000000-0000-4000-8000-000000000007";
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    requests.push(`${request.method} ${path}`);
    if (wait) {
      if (request.method === "POST" && path === "/api/v1/skills/owned-polling-skill/quote") return Response.json({ skill: "owned-polling-skill", pricing: { costCredits: 0 }, quoteReceipt: "owned.polling.receipt" });
      if (request.method === "GET" && path === "/api/v1/capabilities") return Response.json({ contractVersion: 1, apiVersion: 1, capabilities: ["runs.submit"], billing: { unit: "credits", boundedRunApproval: true } });
      if (request.method === "POST" && path === "/api/v1/runs/owned-polling-skill") return Response.json({ id: runId, skill: "owned-polling-skill", status: "queued" }, { status: 202 });
      if (request.method === "GET" && path === `/api/v1/runs/${runId}`) { polls++; arrived(); return Response.json({ id: runId, skill: "owned-polling-skill", status: "queued" }); }
      if (request.method === "GET" && path === `/api/v1/runs/${runId}/logs`) {
        logArrived();
        return new Promise<Response>(resolve => request.signal.addEventListener("abort", () => resolve(Response.json({ logs: [] })), { once: true }));
      }
    }
    // A valid preflight reaches quoting, but never submission or paid work.
    return Response.json({ error: "OWNED_QUOTE_STOP" }, { status: 503 });
  } });
  const guard = join(root, "guard.js");
  writeFileSync(guard, `import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const deny=()=>{throw Error('OWNED_RUN_POLLING_GUARD')};const fetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.protocol!=="data:"&&url.origin!==${JSON.stringify(server.url.origin)})return deny();return fetch(input,init)};
Bun.spawn=deny;Bun.spawnSync=deny;for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[k]=deny;syncBuiltinESMExports();`);
  const env = { PATH: join(root, "empty-bin"), HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"),
    HASNA_CONFIG_HOME: join(home, "config"), HASNA_SKILLS_DIR: data, HASNA_SKILLS_API_URL: server.url.origin,
    HASNA_SKILLS_API_KEY_OVERRIDE: "owned-run-polling-credential", HASNA_STATION: "owned-polling-no-keychain",
    TMPDIR: join(root, "tmp"), NO_COLOR: "1", TERM: "dumb", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" };
  const cli = async (args: string[], observe?: (stop: (signal?: "SIGINT" | "SIGTERM") => void) => Promise<void>) => {
    const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, binary, ...args], {
      cwd: project, env, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 10_000);
    try {
      const observation = observe?.((signal = "SIGTERM") => child.kill(signal));
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited, observation]);
      expect(timedOut).toBe(false); expect(stdout.length + stderr.length).toBeLessThan(16_000);
      expect(stdout + stderr).not.toContain(env.HASNA_SKILLS_API_KEY_OVERRIDE);
      return { stdout, stderr, exitCode };
    } finally { clearTimeout(timer); if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; } }
  };
  try {
    const version = await cli(["--version"]); expect(version).toMatchObject({ exitCode: 0, stderr: "" });
    await action(cli, requests, [home, project, data], { first, firstLog, count: () => polls, origin: server.url.origin });
  } finally { await server.stop(true); rmSync(root, { recursive: true, force: true }); }
}

for (const flag of ["--poll-interval-ms", "--poll-timeout-ms"]) {
  test(`remote ${flag} refuses malformed or unsafe values before quote, hold or run-state writes`, async () => {
    await fixture(async (cli, requests, paths) => {
      const before = paths.map(snapshot);
      for (const json of [false, true]) for (const value of ["0", "-1", "1.5", "1junk", "1e3", "0x10", "+1", "Infinity", "2147483648", "9007199254740991", "9007199254740992", "", " ", " 1", "1 "]) {
        const result = await cli(["run", "--remote", "--yes", ...(json ? ["--json"] : []), flag, value, "owned-polling-skill"]);
        expect(result.exitCode).toBe(1);
        const error = json ? JSON.parse(result.stdout).error : result.stderr;
        expect(error).toContain(`${flag} must be an integer from 1 to 2147483647 milliseconds`);
        expect(requests).toEqual([]); expect(paths.map(snapshot)).toEqual(before);
      }
    });
  });
}

test("remote polling defaults and exact positive values reach only the configured quote endpoint", async () => {
  await fixture(async (cli, requests, paths) => {
    const before = paths.map(snapshot);
    for (const flags of [[], ["--poll-interval-ms", "1", "--poll-timeout-ms", "1"],
      ["--poll-interval-ms", "100", "--poll-timeout-ms", "30000"],
      ["--poll-interval-ms", "001", "--poll-timeout-ms", "030000"],
      ["--poll-interval-ms", "2147483647", "--poll-timeout-ms", "2147483647"]]) {
      const result = await cli(["run", "--remote", "--yes", "--json", ...flags, "owned-polling-skill"]);
      expect(result.exitCode).toBe(1); expect(JSON.parse(result.stdout).error).toContain("failed: HTTP 503");
      expect(paths.map(snapshot)).toEqual(before);
    }
    expect(requests).toEqual(Array(5).fill("POST /api/v1/skills/owned-polling-skill/quote"));
  });
});


test("maximum remote polling delay waits without overflowing into rapid HTTP polling", async () => {
  await fixture(async (cli, requests, paths, polling) => {
    const homeBefore = snapshot(paths[0]!);
    const result = await cli(["run", "--remote", "--yes", "--json", "--wait", "--poll-interval-ms", "2147483647", "--poll-timeout-ms", "2147483647", "owned-polling-skill"], async stop => {
      // Start the observation only once actual remote polling has begun.
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([polling.first, new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(Error("Polling never began")), 5000); })]);
        await new Promise(resolve => setTimeout(resolve, 150));
        expect(polling.count()).toBe(1);
      } finally { if (deadline) clearTimeout(deadline); stop(); }
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toContain("TimeoutOverflowWarning");
    expect(polling.count()).toBe(1);
    expect(requests).toEqual(["POST /api/v1/skills/owned-polling-skill/quote", "GET /api/v1/capabilities", "POST /api/v1/runs/owned-polling-skill", "GET /api/v1/runs/00000000-0000-4000-8000-000000000007"]);
    expect(snapshot(paths[0]!)).toEqual(homeBefore);
    // The fixture contains no provider or billing engine. SIGTERM ends only
    // this owned CLI wait; it is not a remote cancellation/settlement proof.
  }, true);
});

for (const waiting of [true, false]) {
  test(`SIGINT during remote ${waiting ? "polling" : "log retrieval"} preserves the admitted run for fresh CLI lookup`, async () => {
    await fixture(async (cli, requests, paths, polling) => {
      const [home, project] = paths as [string, string, string];
      const homeBefore = snapshot(home);
      const remoteId = "00000000-0000-4000-8000-000000000007";
      const readRun = () => {
        const files = [...new Bun.Glob(".skills/runs/*/*/run.json").scanSync({ cwd: project, dot: true })];
        expect(files).toHaveLength(1);
        return JSON.parse(readFileSync(join(project, files[0]!), "utf8"));
      };
      let localId = "";
      const interrupted = await cli(["run", "--remote", "--yes", ...(waiting ? ["--json", "--wait"] : []),
        "--poll-interval-ms", "2147483647", "--poll-timeout-ms", "2147483647", "owned-polling-skill"], async stop => {
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([waiting ? polling.first : polling.firstLog,
            new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(Error("Remote observation never began")), 5000); })]);
          // The server observed polling/log retrieval, so admission must already
          // be durable before the CLI can be interrupted at this await point.
          const stored = readRun();
          expect(stored).toMatchObject({ remote: true, remoteRunId: remoteId, remoteApiOrigin: polling.origin, status: "queued" });
          localId = stored.id;
        } finally { if (deadline) clearTimeout(deadline); stop("SIGINT"); }
      });
      expect(interrupted.exitCode).toBe(130);
      expect(readRun()).toMatchObject({ id: localId, remoteRunId: remoteId, status: "queued" });
      const shown = await cli(["runs", "show", "--json", localId]);
      expect(shown.exitCode).toBe(0);
      expect(JSON.parse(shown.stdout)).toMatchObject({ id: localId, remoteRunId: remoteId, remoteApiOrigin: polling.origin, status: "queued" });
      const status = await cli(["runs", "status", "--json", localId]);
      expect(status.exitCode).toBe(0);
      expect(JSON.parse(status.stdout)).toMatchObject({ localRunId: localId, runId: remoteId, run: { status: "queued" } });
      expect(requests).toEqual(["POST /api/v1/skills/owned-polling-skill/quote", "GET /api/v1/capabilities",
        "POST /api/v1/runs/owned-polling-skill", `GET /api/v1/runs/${remoteId}${waiting ? "" : "/logs"}`, `GET /api/v1/runs/${remoteId}`]);
      expect(snapshot(home)).toEqual(homeBefore);
      // Exactly one admission; interrupting a local wait never cancels remote work.
    }, true);
  });
}
