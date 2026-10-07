/** Deadline and abort signals that session-pin renewal may report as its spent budget. Synthetic loopback servers and fixtures only. */
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HttpProfileClient } from "./profile-client.js";
import { inspectSkillBundle, packSkillBundle, SkillBundleInspectionError } from "./skill-bundle.js";
import { SkillSelectionError, verifySelectionBundleResponse } from "./selection-cache.js";
import type { ResolvedSkillSelection } from "../types/skill-selection.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
function bundle(bodyBytes = 0) {
  const root = mkdtempSync(join(tmpdir(), "skills-renewal-deadline-")); roots.push(root);
  const source = join(root, "source"); mkdirSync(source);
  writeFileSync(join(source, "SKILL.md"), "---\nname: review-code\ndescription: Review code\nkind: instruction\n---\nBody.\n");
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "review-code", version: "1.0.0", skills: { kind: "instruction" } }));
  if (bodyBytes) writeFileSync(join(source, "reference.txt"), "synthetic reference line for bundle inspection timing\n".repeat(Math.ceil(bodyBytes / 52)));
  return packSkillBundle(source);
}
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try { await promise; } catch (error) { return error; }
  throw new Error("expected a rejection");
}

test("an aborted or timed-out request keeps a fixed abort cause; an authority failure or refused connection has none", async () => {
  let stalled!: () => void;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/api/v1/profiles/slow/resolve") { await Bun.sleep(2000); return Response.json({}); }
    if (path === "/api/v1/profiles/stalled-body/resolve") {
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{\"profileId\":")); stalled = () => controller.close(); } }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("synthetic failure body", { status: 503 });
  } });
  const origin = `http://127.0.0.1:${server.port}`;
  try {
    for (const profile of ["slow", "stalled-body"]) {
      const controller = new AbortController(), client = new HttpProfileClient("synthetic-test-token", origin, controller.signal);
      setTimeout(() => controller.abort(), 50);
      const error = await rejection(client.resolveProfile(profile)) as SkillSelectionError;
      expect(error, profile).toBeInstanceOf(SkillSelectionError);
      expect(error.code, profile).toBe("SKILLS_API_UNAVAILABLE");
      expect((error.cause as DOMException).name, profile).toBe("AbortError");
      expect((error.cause as DOMException).message, profile).toBe("The Skills API request was cut short");
    }
    stalled();
    const failed = await rejection(new HttpProfileClient("synthetic-test-token", origin).resolveProfile("fleet")) as SkillSelectionError;
    expect(failed.code).toBe("SKILLS_API_UNAVAILABLE"); expect(failed.cause).toBeUndefined();
    expect(failed.message).not.toContain("synthetic failure body");
  } finally { server.stop(true); }
  const refused = await rejection(new HttpProfileClient("synthetic-test-token", origin).resolveProfile("fleet")) as SkillSelectionError;
  expect(refused.code).toBe("SKILLS_API_UNAVAILABLE"); expect(refused.cause).toBeUndefined();
});

test("an inner bundle deadline never fires before the renewal deadline", async () => {
  const packed = bundle();
  const selection: ResolvedSkillSelection = { authority: "https://skills.example.com/api/v1", workspaceId: "org-test", profileRevision: "current",
    slug: "review-code", version: "1.0.0", bundleDigest: `sha256:${packed.sha256}` };
  for (let round = 0; round < 45; round++) {
    // Deadlines a fraction of a millisecond ahead: floor rounding used to fire them early.
    const deadline = performance.now() + 0.1 + (round % 9) * 0.1;
    try { await verifySelectionBundleResponse(selection, new Response(packed.bytes), undefined, deadline); }
    catch (error) {
      const at = performance.now();
      expect(error).toBeInstanceOf(SkillBundleInspectionError);
      expect((error as SkillBundleInspectionError).code).toBe("BUNDLE_TIMEOUT");
      expect(at).toBeGreaterThanOrEqual(deadline);
    }
  }
});

test("bundle inspection never reports its own deadline early", async () => {
  const packed = bundle(3 * 1024 * 1024);
  let timeouts = 0;
  for (let round = 0; round < 30; round++) {
    const timeoutMs = 1 + (round % 5), started = performance.now();
    try { await inspectSkillBundle(packed.bytes, { limits: { timeoutMs } }); }
    catch (error) {
      const elapsed = performance.now() - started;
      expect((error as SkillBundleInspectionError).code).toBe("BUNDLE_TIMEOUT");
      expect(elapsed).toBeGreaterThanOrEqual(timeoutMs);
      timeouts++;
    }
  }
  // The positive control: the deadline was actually exercised.
  expect(timeouts).toBeGreaterThan(0);
});
