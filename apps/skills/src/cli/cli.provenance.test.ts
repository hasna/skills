import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { buildCliFixture } from "./cli-build.fixture.js";
import { activateSelectionProfile, selectionKey, sessionReceiptPath, writeSelectionJson } from "../lib/selection-cache.js";
import { PROVENANCE_DRIFT_LIMIT, readSelectionProvenance } from "../lib/selection-provenance.js";
import type { ResolvedSkillProfile, ResolvedSkillSelection, SkillProfile, StationSkillState } from "../types/skill-selection.js";

// A synthetic cache root must be symlink-free: the selection cache refuses a
// path that traverses one, and on macOS /var itself is a link.
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "skills-provenance-")));
const binary = join(scratch, "skills.js");
beforeAll(async () => { await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary); });
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;
const PROFILE = "fleet", STATION = "station-fixture", WORKSPACE = "fixture";
const SELECTED = "rev-selected", APPLIED = "rev-applied", PINNED = "rev-pinned";

/** Four selections whose versions are the only thing that differs per revision. */
function selections(revision: string, versions: Record<string, string>, authority: string, workspaceId = WORKSPACE): ResolvedSkillSelection[] {
  return Object.entries(versions).map(([slug, version]) => ({
    authority, workspaceId, profileRevision: revision, slug, version, bundleDigest: digest(slug[0]!),
  }));
}
function profile(revision: string, versions: Record<string, string>, authority: string, workspaceId = WORKSPACE): ResolvedSkillProfile {
  return { authority, workspaceId, profileId: PROFILE, profileRevision: revision, selections: selections(revision, versions, authority, workspaceId) };
}

const SELECTED_VERSIONS = { alpha: "1.0.0", bravo: "2.0.0", charlie: "3.0.0", delta: "4.0.0" };
const APPLIED_VERSIONS = { alpha: "0.9.0", bravo: "2.0.0", charlie: "3.0.0", delta: "3.0.0" };
const PINNED_VERSIONS = { alpha: "0.9.0", bravo: "2.0.0", charlie: "3.0.0", delta: "3.0.0" };

/** Every file the read could have written, by relative path and exact bytes. */
function cacheTree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else out[relative(root, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  try { walk(root); } catch { /* absent: an empty tree is the comparison */ }
  return out;
}

interface Fixture {
  home: string; data: string; cacheDir: string; sessionId: string;
  requests: string[]; env: Record<string, string>;
  cli: (args: string[], env?: Record<string, string>) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}
/** A synthetic station: one authority, one activated snapshot and one session pin. */
function fixtureFor(options: {
  appliedRevision: string; appliedVersions: Record<string, string>; syncSnapshot: boolean;
  writeSession?: { authority?: string; workspaceId?: string; profileRevision?: string };
  /** Emit an incomplete station receipt, which the HTTP reader accepts. */
  omitStationField?: "profileId" | "profileRevision";
}): Fixture {
  const token = randomUUID(), requests: string[] = [];
  let origin = "http://127.0.0.1";
  let authority = `${origin}/api/v1`;
  const resolvedProfile = (): ResolvedSkillProfile => ({
    authority, workspaceId: WORKSPACE, profileId: PROFILE, profileRevision: SELECTED,
    selections: selections(SELECTED, SELECTED_VERSIONS, authority),
  });
  const stationBody = (id: string): StationSkillState => {
    const body = {
      stationId: id, workspaceId: WORKSPACE, actorId: "actor-fixture", profileId: PROFILE,
      profileRevision: options.appliedRevision, appliedAt: "2026-01-02T00:00:00Z",
      selections: selections(options.appliedRevision, options.appliedVersions, authority),
    } as Record<string, unknown>;
    if (options.omitStationField) delete body[options.omitStationField];
    return body as unknown as StationSkillState;
  };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const raw = new URL(request.url).pathname;
    const path = raw.replace(/^\/api/, "");
    requests.push(path);
    if (request.headers.get("authorization") !== `Bearer ${token}`) return new Response("refused", { status: 401 });
    // The resolver's own read: this is the abstraction whose authority the stored
    // receipts bind to, so the fixture serves it rather than the admin projection.
    if (path === `/v1/profiles/${PROFILE}/resolve`) return Response.json(resolvedProfile());
    if (path === `/v1/profiles/${PROFILE}`) return Response.json({ id: PROFILE, workspaceId: WORKSPACE, revision: SELECTED, selections: selections(SELECTED, SELECTED_VERSIONS, authority), updatedAt: "2026-01-01T00:00:00Z" } satisfies SkillProfile);
    if (path === `/v1/stations/${STATION}/state`) return Response.json(stationBody(STATION));
    return new Response(`unexpected operation: ${path}`, { status: 404 });
  } });
  origin = `http://127.0.0.1:${server.port}`;
  authority = `${origin}/api/v1`;
  const home = mkdtempSync(join(scratch, "home-")), data = join(home, ".hasna", "skills"), cacheDir = join(data, "selection-cache");
  const sessionId = "provenance-fixture";
  if (options.syncSnapshot) activateSelectionProfile(profile(SELECTED, SELECTED_VERSIONS, authority), { cacheDir, now: () => Date.parse("2026-01-03T00:00:00Z") });
  if (options.writeSession) {
    const pin = options.writeSession;
    const pinned = profile(pin.profileRevision ?? PINNED, PINNED_VERSIONS, pin.authority ?? authority, pin.workspaceId ?? WORKSPACE);
    writeSelectionJson(sessionReceiptPath(sessionId, { cacheDir }), {
      schemaVersion: 1, verifiedAt: "2026-01-04T00:00:00Z", profile: pinned, sessionId,
      loaded: pinned.selections.filter(selection => selection.slug !== "charlie" && selection.slug !== "delta").map(selectionKey),
      generation: 1,
    });
  }
  const env = {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"),
    HASNA_SKILLS_DIR: data, NO_COLOR: "1", TERM: "dumb", TMPDIR: scratch, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    HASNA_SKILLS_API_URL: origin, HASNA_SKILLS_API_KEY_OVERRIDE: token,
  };
  return { home, data, cacheDir, sessionId, requests, env, cli: async (args, extra = {}) => {
    const child = Bun.spawn([process.execPath, "--no-env-file", binary, ...args], { cwd: scratch, env: { ...env, ...extra }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, exitCode };
  } };
}

test("the receipt keeps selected, activated, applied, pinned and consumed distinct and writes nothing", async () => {
  const f = fixtureFor({ appliedRevision: APPLIED, appliedVersions: APPLIED_VERSIONS, syncSnapshot: true, writeSession: {} });
  const before = cacheTree(f.cacheDir);
  const { stdout, stderr, exitCode } = await f.cli(["provenance", "--selection-profile", PROFILE, "--station", STATION, "--session", f.sessionId, "--json"]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const receipt = JSON.parse(stdout);
  expect(receipt).toMatchObject({ schemaVersion: 1, readOnly: true, selectionProfile: PROFILE, driftTruncated: false });
  // Selected is the authority's revision, and the reference says so.
  expect(receipt.selected).toMatchObject({ profileId: PROFILE, profileRevision: SELECTED, selectionCount: 4, source: "authority" });
  const [activated, applied, session] = receipt.consumers;
  // The machine's own activation is current; the authority's station record lags it, and only
  // an explicit sync writes that record — the two must never be collapsed into one number.
  expect(activated).toMatchObject({ kind: "station", source: "local-receipt", idKind: "local-host", profileRevision: SELECTED, status: "current" });
  expect(applied).toMatchObject({ kind: "station", source: "authority-receipt", idKind: "requested-station", id: STATION, profileRevision: APPLIED, status: "behind" });
  // A session pinned before the profile moved on is custody by design, not drift.
  expect(session).toMatchObject({ kind: "session", source: "session-receipt", id: f.sessionId, profileRevision: PINNED, status: "pinned", selectionCount: 4, loadedCount: 2 });
  expect(session.consumed.map((row: { slug: string; version: string }) => `${row.slug}@${row.version}`)).toEqual(["alpha@0.9.0", "bravo@2.0.0"]);
  // Drift compares exact versions: the two bundles the station record differs on, plus the one
  // the session actually consumed at an older version. Rows follow the consumer order, then slug.
  expect(receipt.drift).toEqual([
    { source: "authority-receipt", id: STATION, slug: "alpha", selectedVersion: "1.0.0", observedVersion: "0.9.0" },
    { source: "authority-receipt", id: STATION, slug: "delta", selectedVersion: "4.0.0", observedVersion: "3.0.0" },
    { source: "session-receipt", id: f.sessionId, slug: "alpha", selectedVersion: "1.0.0", observedVersion: "0.9.0" },
  ]);
  // What it does not attest is stated, not implied.
  expect(receipt.notAttested.join(" ")).toContain("Native discovery");
  expect(f.requests).toEqual([`/v1/profiles/${PROFILE}/resolve`, `/v1/stations/${STATION}/state`]);
  // A read-only receipt: not one byte of the cache moved.
  expect(cacheTree(f.cacheDir)).toEqual(before);

  const plain = await f.cli(["provenance", "--selection-profile", PROFILE, "--station", STATION, "--session", f.sessionId]);
  expect(plain.stderr).toBe("");
  expect(plain.stdout).toContain(`Selected: ${SELECTED} (4 selections, authority)`);
  expect(plain.stdout).toContain("Activated: this machine (");
  expect(plain.stdout).toContain(`Applied: station ${STATION} ${APPLIED} [behind]`);
  expect(plain.stdout).toContain(`Pinned: session ${f.sessionId} ${PINNED} [pinned]`);
  expect(plain.stdout).toContain("Consumed: 2 of 4 selections loaded");
  expect(plain.stdout).toContain("Drift (3):");
  expect(plain.stdout).toContain(`- authority-receipt ${STATION}: alpha 1.0.0 -> 0.9.0`);
  expect(cacheTree(f.cacheDir)).toEqual(before);
  rmSync(f.home, { recursive: true, force: true });
});

test("a consumer that matches the selected revision is current, and an unreadable one is unverified with a reason", async () => {
  const f = fixtureFor({ appliedRevision: SELECTED, appliedVersions: SELECTED_VERSIONS, syncSnapshot: true, writeSession: undefined });
  const current = JSON.parse((await f.cli(["provenance", "--selection-profile", PROFILE, "--station", STATION, "--session", "absent-session", "--json"])).stdout);
  expect(current.consumers.map((consumer: { status: string }) => consumer.status)).toEqual(["current", "current", "unverified"]);
  expect(current.drift).toEqual([]);
  // A station with no activated snapshot and no session named says so rather than guessing.
  const empty = JSON.parse((await f.cli(["provenance", "--selection-profile", PROFILE, "--station", STATION, "--json"], { HASNA_SKILLS_DIR: join(f.home, ".hasna", "skills-absent") })).stdout);
  expect(empty.consumers[0]).toMatchObject({ source: "local-receipt", status: "unverified", reasonCode: "NO_LOCAL_RECEIPT" });
  expect(empty.consumers[0].reason).toContain("holds no activated snapshot");
  expect(empty.consumers[2].reasonCode).toBe("NO_SESSION_NAMED");
  rmSync(f.home, { recursive: true, force: true });
});

test("--cached never asks the authority and reports every comparison unverified rather than current", async () => {
  const f = fixtureFor({ appliedRevision: APPLIED, appliedVersions: APPLIED_VERSIONS, syncSnapshot: true, writeSession: {} });
  const { stdout, stderr, exitCode } = await f.cli(["provenance", "--selection-profile", PROFILE, "--station", STATION, "--session", f.sessionId, "--cached", "--json"]);
  expect(stderr).toBe(""); expect(exitCode).toBe(0);
  expect(f.requests).toEqual([]);
  const receipt = JSON.parse(stdout);
  expect(receipt.selected).toMatchObject({ profileRevision: SELECTED, source: "synced-snapshot" });
  expect(receipt.consumers.map((consumer: { status: string }) => consumer.status)).toEqual(["unverified", "unverified", "unverified"]);
  expect(receipt.drift).toEqual([]);
  expect(receipt.selected.reason).toContain("not proof of adoption");
  rmSync(f.home, { recursive: true, force: true });
});

/**
 * DEFECT 1 CONTROL. A pin with the SAME profile and revision but a FOREIGN
 * authority is not current. The resolver refuses this state with
 * PROFILE_IDENTITY_MISMATCH, so a receipt that reports it current would be a
 * false green, and diffing its selections would fabricate drift rows.
 */
test("identity binds: a foreign pin at the same revision is not current and yields no drift", async () => {
  const f = fixtureFor({ appliedRevision: APPLIED, appliedVersions: APPLIED_VERSIONS, syncSnapshot: true, writeSession: { authority: "http://127.0.0.1:9/api/v1" } });
  const receipt = JSON.parse((await f.cli(["provenance", "--selection-profile", PROFILE, "--station", STATION, "--session", f.sessionId, "--json"])).stdout);
  const session = receipt.consumers[2];
  expect(session.status).toBe("unverified");
  expect(session.reasonCode).toBe("IDENTITY_MISMATCH");
  expect(session.status).not.toBe("current");
  expect(session.status).not.toBe("pinned");
  // No row may be diffed across identities: every one of them would be false.
  expect(receipt.drift.filter((row: { source: string }) => row.source === "session-receipt")).toEqual([]);
  expect(receipt.drift).toEqual([
    { source: "authority-receipt", id: STATION, slug: "alpha", selectedVersion: "1.0.0", observedVersion: "0.9.0" },
    { source: "authority-receipt", id: STATION, slug: "delta", selectedVersion: "4.0.0", observedVersion: "3.0.0" },
  ]);
  rmSync(f.home, { recursive: true, force: true });
});

/**
 * DEFECT 2 CONTROL. `--station` names the station whose AUTHORITY receipt is read.
 * It must never relabel this machine's own activation, which belongs to the host.
 */
test("--station names the remote receipt only; the local activation keeps its own host identity", async () => {
  const f = fixtureFor({ appliedRevision: APPLIED, appliedVersions: APPLIED_VERSIONS, syncSnapshot: true, writeSession: {} });
  const receipt = JSON.parse((await f.cli(["provenance", "--selection-profile", PROFILE, "--station", "some-other-station", "--json"])).stdout);
  const [activated, applied] = receipt.consumers;
  expect(activated.source).toBe("local-receipt");
  expect(activated.idKind).toBe("local-host");
  expect(activated.id).not.toBe("some-other-station");
  expect(applied.idKind).toBe("requested-station");
  expect(applied.id).toBe("some-other-station");
  // The two must be genuinely distinguishable, not the same string twice.
  expect(activated.id).not.toBe(applied.id);
  rmSync(f.home, { recursive: true, force: true });
});

/**
 * DEFECT 3 CONTROL. A reader's exception message is never carried. Truncating
 * foreign text is not redacting it, so a credential inside it must not survive.
 */
test("a reader failure is a fixed code, never the exception message", async () => {
  const secret = `Bearer ${randomUUID()}`;
  const boom = async (): Promise<never> => { throw new Error(`authority refused: ${secret} at https://user:pass@example.invalid/x`); };
  const receipt = await readSelectionProvenance(
    { profileId: PROFILE, stationId: STATION, localStationId: "host-fixture", sessionId: "control-session-absent" },
    { readSelected: boom as never, readStation: boom as never },
  );
  const serialized = JSON.stringify(receipt);
  // The control that matters: nothing from the exception survives, in any field.
  expect(serialized).not.toContain(secret);
  expect(serialized).not.toContain("user:pass");
  expect(serialized).not.toContain("example.invalid");
  expect(serialized).not.toContain("authority refused");
  // Every reason is a fixed code from the vocabulary, never free text.
  const codes = [receipt.selected.reasonCode, ...receipt.consumers.map(consumer => consumer.reasonCode)];
  expect(codes.every(code => /^[A-Z][A-Z0-9_]*$/.test(code))).toBe(true);
  // With no local snapshot either, the reference itself is unavailable, and the
  // failed reads are reported as their own class rather than as adoption.
  expect(receipt.selected.reasonCode).toBe("REFERENCE_UNAVAILABLE");
  expect(receipt.consumers.map(consumer => consumer.reasonCode)).toEqual(["NO_LOCAL_RECEIPT", "REFERENCE_NOT_AUTHORITY", "READ_REFUSED"]);
  expect(receipt.drift).toEqual([]);
});

/**
 * DEFECT CONTROL (changed-contract rereview). The normal HTTP reader accepts a
 * station receipt that omits `profileId` or `profileRevision`. An absent field is
 * not a match and not an older revision: both shapes must be unverified with no
 * drift, never `current`/`CURRENT_SCHEMA_MATCH` or `behind`/`REVISION_BEHIND`.
 */
for (const omitted of ["profileId", "profileRevision"] as const) {
  test(`an incomplete station receipt is unverified with no drift: missing ${omitted}`, async () => {
    const f = fixtureFor({
      appliedRevision: APPLIED, appliedVersions: APPLIED_VERSIONS, syncSnapshot: true, writeSession: {},
      omitStationField: omitted,
    });
    const { stdout, stderr, exitCode } = await f.cli(["provenance", "--selection-profile", PROFILE, "--station", STATION, "--session", f.sessionId, "--json"]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const receipt = JSON.parse(stdout);
    const station = receipt.consumers[1];
    expect(station).toMatchObject({ source: "authority-receipt", idKind: "requested-station", status: "unverified", reasonCode: "INCOMPLETE_RECEIPT" });
    // The two wrong answers this control exists to prevent.
    expect(station.status).not.toBe("current");
    expect(station.reasonCode).not.toBe("CURRENT_SCHEMA_MATCH");
    expect(station.status).not.toBe("behind");
    expect(station.reasonCode).not.toBe("REVISION_BEHIND");
    expect(station.reason).toContain(omitted);
    // No drift may be derived from a receipt that cannot be compared.
    expect(receipt.drift.filter((row: { source: string }) => row.source === "authority-receipt")).toEqual([]);
    // The other consumers are unaffected: the session stays pinned by design.
    expect(receipt.consumers[2]).toMatchObject({ source: "session-receipt", status: "pinned" });
    expect(receipt.consumers[0]).toMatchObject({ source: "local-receipt", status: "current" });
    rmSync(f.home, { recursive: true, force: true });
  });
}

test("drift is bounded so one receipt cannot carry an unbounded list", () => {
  expect(PROVENANCE_DRIFT_LIMIT).toBeGreaterThan(0);
  expect(PROVENANCE_DRIFT_LIMIT).toBeLessThanOrEqual(1000);
  expect(typeof readSelectionProvenance).toBe("function");
});
