/**
 * Expired-pin renewal on the managed hook path. Runs the release-compiled
 * `context --stdin --json --cached --auto-reconcile-safe` child (what the hook
 * spawns) against a synthetic Skills authority serving a production-sized
 * profile with scripted latency. Every path is a fixture home; no live Skills
 * state, credential or session is read.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { buildCliFixture } from "./cli-build.fixture.js";
import { selectionKey, sessionReceiptPath, writeSelectionJson } from "../lib/selection-cache.js";
import type { ResolvedSkillProfile } from "../types/skill-selection.js";

const scratch = mkdtempSync(join(tmpdir(), "skills-renewal-budget-")), binary = join(scratch, "skills.js");
beforeAll(async () => { await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary); });
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// Production shape observed on the affected session: 806 selections, about
// 561 KB resolved, 251 loaded, pinned for more than 24 hours.
const SELECTIONS = 806, LOADED = 251, SESSION = "renewal-budget-session";
const hex = (value: string) => createHash("sha256").update(value).digest("hex");
function fleetProfile(authority: string, revision: string, count = SELECTIONS): ResolvedSkillProfile {
  return {
    authority, workspaceId: "org-fixture", profileId: "fleet", profileRevision: revision,
    selections: Array.from({ length: count }, (_, index) => ({
      authority, workspaceId: "org-fixture", profileRevision: revision,
      slug: `fixture-skill-${String(index).padStart(4, "0")}`, version: "1.0.0",
      bundleDigest: `sha256:${hex(`bundle-${index}`)}`, authorizationEpoch: hex(`epoch-${index}`).slice(0, 32),
      triggers: { keywords: Array.from({ length: 8 }, (_, term) => `fixture keyword ${index} ${term} padding to production size`) },
    })),
  };
}

interface Authority { origin: string; token: string; resolves: () => number; close: () => void }
function authority(target: (authority: string) => ResolvedSkillProfile, delays: number[], status?: number): Authority {
  const token = randomUUID();
  let resolves = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.headers.get("authorization") !== `Bearer ${token}`) return new Response("unauthorized", { status: 401 });
      if (url.pathname === "/api/v1/profiles/fleet/resolve") {
        const delay = delays[Math.min(resolves, delays.length - 1)]!;
        resolves++;
        await Bun.sleep(delay);
        return status ? new Response("unavailable", { status }) : Response.json(target(`${url.origin}/api/v1`));
      }
      if (url.pathname === "/api/v1/capabilities") return Response.json({ capabilities: ["skills.session-pin-renewal"] });
      return new Response("not found", { status: 404 });
    },
  });
  return { origin: `http://127.0.0.1:${server.port}`, token, resolves: () => resolves, close: () => server.stop(true) };
}

function station(api: Authority, verifiedAt = new Date(Date.now() - 25 * 60 * 60 * 1000)) {
  const root = mkdtempSync(join(scratch, "case-")), home = join(root, "home"), data = join(home, ".hasna", "skills");
  const project = join(root, "project"), tmp = join(root, "tmp"), cacheDir = join(data, "selection-cache");
  for (const path of [home, data, project, tmp]) mkdirSync(path, { recursive: true });
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"),
    HASNA_SKILLS_DIR: data, HASNA_SKILLS_API_KEY_OVERRIDE: api.token, HASNA_SKILLS_API_URL: api.origin,
    NO_COLOR: "1", TERM: "dumb", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", TMPDIR: tmp };
  const pinned = fleetProfile(`${api.origin}/api/v1`, "pinned-revision");
  const receiptPath = sessionReceiptPath(SESSION, { cacheDir });
  writeSelectionJson(receiptPath, { schemaVersion: 1, verifiedAt: verifiedAt.toISOString(), profile: pinned, sessionId: SESSION,
    generation: 3, loaded: pinned.selections.slice(0, LOADED).map(selectionKey) });
  const before = readFileSync(receiptPath);
  async function prompt() {
    const started = performance.now();
    const child = Bun.spawn([process.execPath, "--no-env-file", binary, "context", "--stdin", "--json", "--selection-profile", "fleet", "--cached", "--auto-reconcile-safe"], {
      cwd: project, env, stdout: "pipe", stderr: "pipe",
      stdin: new Blob([JSON.stringify({ session_id: SESSION, hook_event_name: "UserPromptSubmit", prompt: "continue the current task", cwd: project })]),
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    try {
      const [stdout, , exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      let code: string | undefined;
      try { code = JSON.parse(stdout)?.error?.code; } catch { code = "UNPARSED_OUTPUT"; }
      return { code: code ?? (exitCode === 0 ? "OK" : `EXIT_${exitCode}`), ms: Math.round(performance.now() - started), resolves: api.resolves() };
    } finally { clearTimeout(timer); }
  }
  return { cacheDir, receiptPath, before, prompt, profileBytes: Buffer.byteLength(JSON.stringify(pinned)) };
}

const current = (authority: string) => {
  const profile = fleetProfile(authority, "current-revision");
  profile.selections.splice(17, 1); // a pinned, unloaded selection was removed
  return profile;
};
async function prompts(count: number, s: ReturnType<typeof station>) {
  const results = [];
  for (let index = 0; index < count; index++) results.push(await s.prompt());
  return results;
}
function report(name: string, s: ReturnType<typeof station>, results: Array<{ code: string; ms: number; resolves: number }>) {
  console.log(`[renewal-budget] ${name}: profile ${s.profileBytes} bytes, ${SELECTIONS} selections, ${LOADED} loaded`);
  results.forEach((result, index) => console.log(`[renewal-budget]   prompt ${index + 1}: ${result.code} in ${result.ms} ms; resolve requests so far ${result.resolves}`));
}

test("a definitive refusal is not re-resolved on every prompt and never interleaves with a budget timeout", async () => {
  // First resolve answers inside the budget; the next ones would exceed it.
  const api = authority(current, [1300, 4300, 4300, 1300, 1300]);
  try {
    const s = station(api), results = await prompts(5, s);
    report("refused pin, variable authority latency", s, results);
    expect(results.map(result => result.code)).toEqual(Array(5).fill("SESSION_RECONCILIATION_REQUIRED"));
    expect(api.resolves()).toBe(1);
    expect(Math.max(...results.slice(1).map(result => result.ms))).toBeLessThan(1500);
    expect(readFileSync(s.receiptPath)).toEqual(s.before);
    expect(existsSync(join(s.cacheDir, "session-reconciliations"))).toBe(false);
  } finally { api.close(); }
}, 60_000);

test("a renewal budget timeout has its own code and is retried, not cached", async () => {
  const api = authority(current, [4500]);
  try {
    const s = station(api), results = await prompts(2, s);
    report("refused pin, authority slower than the renewal budget", s, results);
    expect(results.map(result => result.code)).toEqual(["SESSION_RENEWAL_TIMEOUT", "SESSION_RENEWAL_TIMEOUT"]);
    expect(api.resolves()).toBe(2);
    expect(readFileSync(s.receiptPath)).toEqual(s.before);
  } finally { api.close(); }
}, 60_000);

test("an authority HTTP failure keeps the network failure code", async () => {
  const api = authority(current, [50], 503);
  try {
    const s = station(api), results = await prompts(2, s);
    report("authority HTTP 503", s, results);
    expect(results.map(result => result.code)).toEqual(["SKILLS_API_UNAVAILABLE", "SKILLS_API_UNAVAILABLE"]);
    expect(api.resolves()).toBe(2);
    expect(readFileSync(s.receiptPath)).toEqual(s.before);
  } finally { api.close(); }
}, 60_000);

test("baseline: a fresh session's cached context makes no authority request", async () => {
  const api = authority(current, [50]);
  try {
    const s = station(api, new Date()), results = await prompts(1, s);
    report("fresh pin", s, results);
    expect(results[0]!.code).toBe("OK");
    expect(api.resolves()).toBe(0);
  } finally { api.close(); }
}, 60_000);
