/**
 * `skills <group> sync` — the two-way reconcile between the canonical local corpus and the
 * hosted registry through the API.
 *
 * NAMING CONSTRAINT (deliberate): the CLI surface is the `cloud` command group with the
 * `sync` verb, per the plan (todos 9df1ea14). The module identifiers in this file avoid
 * the retired direct-storage feature's names, which two boundary tests
 * (src/no-cloud-boundary.test.ts, src/lib/public-package-boundary.test.ts) ban from every
 * public source file. This feature is the opposite of the retired one: it reconciles
 * through the one API client, never through a direct database snapshot or artifact sync.
 *
 * This is the unified state machine the agent-fan-out `skills sync` (agent-sync.ts) and
 * the snapshot path (native-storage) deliberately do not cover: those own the last mile
 * into agent folders and the on-box snapshot respectively, while this verb reconciles
 * the canonical corpus (T1: resolveCorpusRoot) against the hosted registry's list route.
 *
 * Diff basis: slug + version + bundle sha256, as the plan specifies. The bundle digest is
 * the content address — packSkillBundle is deterministic (canonical gzip), so a local
 * pack and the registry's stored digest are directly comparable. Version is diffed as an
 * axis of its own: a version-only divergence with an identical digest is reported (the
 * registry row's stored version can be overridden independently of the bundle, so the two
 * axes carry independent information).
 *
 * Pulls here are VERIFIED pulls only: a remote row without a bundle digest (the bundled
 * corpus, which the instance serves read-only and never with a digest) is not a pull
 * candidate — the metadata-only fallback is `skills pull --all`'s lane, not the
 * reconcile verb's. Such rows still participate in the diff when the local side exists: a
 * local version that diverged from the bundled row, or a baseline marker the local digest
 * moved away from, classifies as changed-locally and is pushed (a published row overrides
 * the bundled one).
 *
 * Direction of a change is proven by the per-skill baseline marker (`.hasna-skills.json`,
 * written by pull and by this module after a push — the marker's contentHash is what a
 * later sync compares against). A same-slug divergence with NO baseline (a skill that was
 * never synced) cannot prove which side changed, so it is a conflict.
 *
 * Conflict policy, DECLARED (default): local-wins-on-identical-digest-else-skip-and-report.
 * Identical digests are not a conflict — the states agree. A true divergence is skipped
 * and reported unless --conflict=local (push local over remote) or --conflict=remote (pull
 * remote over local) says otherwise.
 *
 * Safety properties:
 * - A dry run performs no writes anywhere: corpus resolution on the dry-run path is
 *   write-free (the legacy-layout migration that getPortableSkillsRoot performs is a
 *   write, so the dry-run path resolves the root read-only and reports whether a real run
 *   would migrate first).
 * - The registry listing is fail-closed: a non-array response (an error object, a
 *   truncation, a proxy page) aborts the run rather than being read as "the registry is
 *   empty" — an empty registry would otherwise be indistinguishable from an
 *   authentication failure, and every local skill would be planned as a push into the
 *   void.
 * - The cursor records a successful sync only: it is not advanced when any push or pull
 *   failed, so a later reader cannot mistake a failed run for convergence.
 * - Each push and pull re-checks both sides immediately before mutating. A remote digest
 *   that moved since the plan (a concurrent publisher) or a local directory that changed
 *   since the plan (a concurrent editor) skips that skill and reports it, instead of
 *   overwriting state the plan did not see. True atomicity against a concurrent writer
 *   requires server-side optimistic concurrency (plan task T8); the re-check closes the
 *   reachable race for single-writer-per-sync operation and narrows the window for the
 *   rest.
 *
 * Push reuses the publish path's own primitives (validatePortableSkillDirectory,
 * packSkillBundle, the RemoteSkillsClient the caller passes) and pull reuses pullSkills'
 * verification + atomic install. There is deliberately no second HTTP client: everything
 * goes through the one RemoteSkillsClient instance.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { pushSkill } from "../cli/commands/publish.js";
import { getDataDir, getDataDirReadOnly, INSTALLED_SKILLS_DIRNAME, SKILLS_CACHE_DIRNAME, isOwnerLayoutMigrated } from "./config.js";
import { resolveCorpusRoot } from "./home-migration.js";
import { getPortableSkillPath, listPortableSkillMetas, type PortableSkillOptions } from "./portable-skills.js";
import { pullSkills, writePullMarker, PULL_MARKER_FILE } from "./pull.js";
import { RemoteSkillsClient, createRemoteSkillsClient, createRemoteSkillsClientReadOnly } from "./remote-client.js";
import { packSkillBundle } from "./skill-bundle.js";
import { isSkillsOwnershipMarker } from "./agent-sync.js";

export type ReconcileConflictPolicy = "local" | "remote" | "skip";

/**
 * The default policy, named exactly as the plan specifies: when the digests are identical
 * the local state wins by construction (nothing to resolve); every other divergence is
 * skipped and reported unless --conflict says otherwise.
 */
export const DEFAULT_CONFLICT_POLICY = "local-wins-on-identical-digest-else-skip-and-report" as const;
export const CONFLICT_POLICIES: readonly ReconcileConflictPolicy[] = ["local", "remote", "skip"] as const;

/** Corpus-root cursor recording the last sync run. */
export const SYNC_CURSOR_FILE = ".sync-cursor.json";
export const SYNC_CURSOR_SCHEMA_VERSION = 1 as const;

export interface ReconcileRegistryOptions extends PortableSkillOptions {
  /** Push local-only, changed-locally, and conflicts won by local. */
  push?: boolean;
  /** Pull remote-only, changed-remotely, and conflicts won by remote. */
  pull?: boolean;
  /** Both directions (the default when neither --push nor --pull is given). */
  all?: boolean;
  /** Plan and report without writing anything. */
  dryRun?: boolean;
  /** Conflict resolution policy. */
  conflict?: ReconcileConflictPolicy;
  /** Client override. `undefined` resolves one from configuration; `null` models "no credential". */
  client?: RemoteSkillsClient | null;
  /** HMAC signing key for bundle signature verification. Defaults to $SKILLS_SIGNING_KEY. */
  signingKey?: string;
}

export type ReconcileSkillState =
  | "local-only"
  | "remote-only"
  | "changed-locally"
  | "changed-remotely"
  | "conflict"
  | "in-sync";

export type ReconcileAction = "push" | "pull" | "skip" | "none";

export interface ReconcileSkillEntry {
  slug: string;
  state: ReconcileSkillState;
  action: ReconcileAction;
  localVersion?: string;
  remoteVersion?: string;
  localSha256?: string;
  remoteSha256?: string;
  /** Why the entry was classified or skipped this way. */
  reason?: string;
  /** Present only for executed (non-dry-run) actions. */
  result?: { ok: boolean; detail?: string };
}

export interface ReconcileSummary {
  /** Skills found in the local corpus. */
  local: number;
  /** Skills the registry serves (published plus bundled). */
  remote: number;
  inSync: number;
  pushed: number;
  pulled: number;
  /** Divergences the conflict policy had to resolve (or decline to resolve). */
  conflicts: number;
  /** Divergences skipped under the policy. */
  skipped: number;
  errors: number;
}

export interface ReconcileCursor {
  schemaVersion: typeof SYNC_CURSOR_SCHEMA_VERSION;
  managedBy: string;
  lastSyncedAt: string;
  runCount: number;
  summary: ReconcileSummary;
}

export interface ReconcileRegistryResult {
  corpusRoot: string;
  /** True when a real run would first migrate the legacy corpus layout into place. */
  migrationPending: boolean;
  direction: "push" | "pull" | "all";
  dryRun: boolean;
  conflictPolicy: ReconcileConflictPolicy;
  /** The full declared policy label; identical to conflictPolicy for local/remote. */
  conflictPolicyDescription: string;
  summary: ReconcileSummary;
  skills: ReconcileSkillEntry[];
  /** Present only when the run was real and completed without errors. */
  cursor?: Pick<ReconcileCursor, "lastSyncedAt" | "runCount">;
}

export class ReconcileRegistryError extends Error {
  constructor(message: string, readonly detail?: string[]) {
    super(message);
    this.name = "ReconcileRegistryError";
  }
}

interface LocalSkill {
  slug: string;
  version?: string;
  sha256: string;
}

interface RemoteSkill {
  slug: string;
  version?: string;
  sha256?: string;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** True when a real run would first migrate the legacy corpus layout into place. */
function migrationNeeded(options: PortableSkillOptions): boolean {
  if (options.rootDir) return false;
  const appDir = options.homeDir ? join(options.homeDir, ".hasna", "skills") : getDataDir();
  return !(isOwnerLayoutMigrated(appDir) && isDirectory(join(appDir, SKILLS_CACHE_DIRNAME)));
}

interface Baseline {
  contentHash?: string;
  version?: string;
}

function readBaseline(skillDir: string): Baseline | undefined {
  const markerPath = join(skillDir, PULL_MARKER_FILE);
  if (!existsSync(markerPath)) return undefined;
  try {
    const marker: unknown = JSON.parse(readFileSync(markerPath, "utf-8"));
    if (!isSkillsOwnershipMarker(marker)) return undefined;
    return {
      ...(typeof marker.contentHash === "string" && marker.contentHash ? { contentHash: marker.contentHash } : {}),
      ...(typeof marker.version === "string" && marker.version ? { version: marker.version } : {}),
    };
  } catch {
    return undefined;
  }
}

function readCursor(root: string): Pick<ReconcileCursor, "runCount"> {
  const path = join(root, SYNC_CURSOR_FILE);
  if (!existsSync(path)) return { runCount: 0 };
  try {
    const cursor = JSON.parse(readFileSync(path, "utf-8")) as { runCount?: number };
    return { runCount: typeof cursor.runCount === "number" ? cursor.runCount : 0 };
  } catch {
    return { runCount: 0 };
  }
}

/**
 * Write-free corpus resolution for the dry-run path.
 *
 * getPortableSkillsRoot() migrates the legacy layout by copying and renaming skill
 * directories when no migration record exists — a write. A dry run must not write, so
 * this mirrors the resolution without the migration step, and the caller reports
 * `migrationPending` so the plan reader knows a real run would first change the corpus.
 * The app data dir itself is resolved write-free via config.getDataDirReadOnly().
 */
function resolveCorpusRootReadOnly(options: PortableSkillOptions): { root: string; migrationPending: boolean } {
  if (options.rootDir) return { root: options.rootDir, migrationPending: false };
  const appDir = options.homeDir ? join(options.homeDir, ".hasna", "skills") : getDataDirReadOnly();
  const cache = join(appDir, SKILLS_CACHE_DIRNAME);
  if (isOwnerLayoutMigrated(appDir) && isDirectory(cache)) {
    return { root: cache, migrationPending: false };
  }
  return { root: join(appDir, INSTALLED_SKILLS_DIRNAME), migrationPending: true };
}

function remoteRowToSkill(record: Record<string, unknown>): RemoteSkill | undefined {
  const slug = typeof record.slug === "string" ? record.slug : typeof record.name === "string" ? record.name : undefined;
  if (!slug) return undefined;
  return {
    slug,
    version: typeof record.version === "string" ? record.version : undefined,
    sha256: typeof record.bundleSha256 === "string" && record.bundleSha256 ? record.bundleSha256 : undefined,
  };
}

/**
 * Re-check the local side of one pull candidate, immediately before the pull batch.
 *
 * Packs FIRST, then samples existence: a directory that appeared between the plan and
 * the pack is provably on disk when the sample runs. Sampling before the pack let a
 * concurrent editor's partial tree read as "still absent" — the pack then threw on it
 * while the stale sample stayed false, so localMoved was false and the pull replaced
 * the newly created directory (review P1). The ops seam exists so a test can pin that
 * ordering deterministically: pack throws on the partial tree, the post-pack sample
 * sees it, and the candidate counts as moved.
 *
 * Returns true when the local side moved since the plan: a digest different from the
 * planned one, or a directory present where the plan saw none (a concurrent editor).
 */
export function recheckLocalSide(
  plannedLocal: string | undefined,
  localDir: string,
  ops: { pack: (dir: string) => string; exists: (dir: string) => boolean } = {
    pack: (dir) => packSkillBundle(dir).sha256,
    exists: existsSync,
  },
): boolean {
  let localNow: string | undefined;
  try {
    localNow = ops.pack(localDir);
  } catch {
    // An unpackable directory is PRESENT, not absent: a partial or temporary local
    // tree mid-run counts as changed, never as "still missing".
    localNow = undefined;
  }
  const dirExists = ops.exists(localDir);
  return plannedLocal !== undefined ? localNow !== plannedLocal : localNow !== undefined || dirExists;
}

function classifySkill(
  local: LocalSkill | undefined,
  remote: RemoteSkill | undefined,
  baseline: Baseline | undefined,
): { state: ReconcileSkillState; reason?: string } {
  if (!remote) return { state: "local-only" };
  if (!local) return { state: "remote-only" };
  const baselineHash = baseline?.contentHash;
  const baselineVersion = baseline?.version;
  if (remote.sha256) {
    if (remote.sha256 === local.sha256) {
      // Identical content address. The version axis is still compared: the registry row's
      // stored version can be overridden independently of the bundle (`push --version`),
      // so a version-only divergence is real and must not read as synchronized. The
      // baseline marker's version is the version last synced (a pull writes the remote
      // version into the marker), so it is the effective local version once a sync
      // happened — that is what makes a conflict resolved by pull converge.
      const effectiveLocalVersion = baselineVersion ?? local.version ?? undefined;
      const remoteVersion = remote.version ?? undefined;
      if (effectiveLocalVersion !== undefined && remoteVersion !== undefined && effectiveLocalVersion !== remoteVersion) {
        return { state: "conflict", reason: "version divergence with identical digest" };
      }
      return { state: "in-sync" };
    }
    // Digests differ; direction is proven by the baseline marker when one exists.
    if (!baselineHash) {
      return { state: "conflict", reason: "no baseline marker: cannot prove which side changed" };
    }
    if (baselineHash === local.sha256) return { state: "changed-remotely" };
    if (baselineHash === remote.sha256) return { state: "changed-locally" };
    return { state: "conflict", reason: "both sides changed since the baseline marker" };
  }
  // A registry row without a bundle digest (the bundled corpus) cannot be diffed by
  // digest. Use the remaining evidence: a baseline that no longer matches the local
  // pack, or a version that diverged from the bundled row, means the local side moved.
  if (baselineHash && baselineHash !== local.sha256) {
    return { state: "changed-locally", reason: "local digest moved since the baseline marker" };
  }
  if (local.version !== undefined && remote.version !== undefined && local.version !== remote.version) {
    return { state: "changed-locally", reason: "version diverged from the bundled row" };
  }
  return { state: "in-sync", reason: "no remote digest; no version or baseline evidence of local divergence" };
}

/** True when the row is the bundled corpus: listed, but served without a bundle digest. */
function isDigestless(remote: RemoteSkill | undefined): boolean {
  return remote !== undefined && !remote.sha256;
}

function resolveAction(
  state: ReconcileSkillState,
  direction: "push" | "pull" | "all",
  conflict: ReconcileConflictPolicy,
): { action: ReconcileAction; reason?: string } {
  switch (state) {
    case "local-only":
    case "changed-locally":
      return direction === "push" || direction === "all" ? { action: "push" } : { action: "skip", reason: "push not requested" };
    case "remote-only":
    case "changed-remotely":
      return direction === "pull" || direction === "all" ? { action: "pull" } : { action: "skip", reason: "pull not requested" };
    case "conflict":
      if (conflict === "local" && (direction === "push" || direction === "all")) return { action: "push" };
      if (conflict === "remote" && (direction === "pull" || direction === "all")) return { action: "pull" };
      return { action: "skip", reason: `conflict policy '${conflict}' does not resolve in this direction` };
    case "in-sync":
      return { action: "none" };
  }
}

/**
 * Current published digest for a slug, read with the HTTP status surfaced so a read
 * failure can never masquerade as "the skill is absent":
 *  - 404 means the registry serves no published row for the slug (undefined);
 *  - any other non-success status, or a network failure, throws — the re-check is
 *    fail-closed and the caller records an error instead of proceeding or skipping
 *    silently.
 */
async function currentRemoteDigest(client: RemoteSkillsClient, slug: string): Promise<string | undefined> {
  const { status, body } = await client.getSkillStatus(slug);
  if (status === 404) return undefined;
  if (status !== 200) {
    throw new ReconcileRegistryError(`Registry re-check for '${slug}' failed: HTTP ${status}.`);
  }
  if (!body || typeof body !== "object") return undefined;
  const digest = (body as Record<string, unknown>).bundleSha256;
  return typeof digest === "string" && digest ? digest : undefined;
}

/**
 * Run one sync pass.
 *
 * The plan (classification + per-skill action) is computed in full before anything is
 * executed, and a dry run stops at the plan: no publish, no pull, no marker, no cursor —
 * proven by readback in the tests. Every executed mutation re-checks both sides first
 * (see the module header); a side that moved since the plan skips that skill and reports
 * it rather than overwriting state the plan did not see.
 */
export async function reconcileRegistry(options: ReconcileRegistryOptions = {}): Promise<ReconcileRegistryResult> {
  const conflict = options.conflict ?? "skip";
  if (!CONFLICT_POLICIES.includes(conflict)) {
    throw new ReconcileRegistryError(
      `Unknown conflict policy '${String(conflict)}'. Use one of: ${CONFLICT_POLICIES.join(", ")}.`,
    );
  }

  const direction = options.pull && !options.push && !options.all ? "pull" : options.push && !options.pull && !options.all ? "push" : "all";
  const dryRun = options.dryRun ?? false;

  // A dry run resolves the client write-free: the normal resolver's stored-auth path
  // (getAuthFilePath -> getDataDir) and stored-origin path (loadConfig -> getDataDir)
  // WRITE — getDataDir() mkdirs the app dir, merges legacy ~/.skills content and
  // copies the legacy config. The read-only resolver reads the same files at the same
  // computed paths without creating or migrating anything, so `--dry-run` with stored
  // auth/config writes nothing (review P1). An injected client is used as-is either way.
  const client = options.client !== undefined
    ? options.client
    : dryRun
      ? await createRemoteSkillsClientReadOnly()
      : await createRemoteSkillsClient();
  if (!client) {
    throw new ReconcileRegistryError(
      "No API key configured, so there is nowhere to sync to.",
      ["Run `skills auth login`, or set HASNA_SKILLS_API_KEY (and HASNA_SKILLS_API_URL for your own instance)."],
    );
  }

  // A dry run resolves the corpus write-free; a real run resolves through the canonical
  // resolver (which may migrate the legacy layout as part of the work). migrationPending
  // is true whenever a real run would first change the corpus layout — that is part of
  // what the report tells the reader.
  const { root, migrationPending } = dryRun
    ? resolveCorpusRootReadOnly(options)
    : { root: resolveCorpusRoot(options), migrationPending: migrationNeeded(options) };

  const localSkills = listPortableSkillMetas({ rootDir: root });
  const locals = new Map<string, LocalSkill>();
  for (const meta of localSkills) {
    try {
      const path = getPortableSkillPath(meta.name, { rootDir: root });
      const packed = packSkillBundle(path);
      locals.set(meta.name, { slug: meta.name, version: meta.version, sha256: packed.sha256 });
    } catch {
      // An un-packable corpus entry is reported as an error rather than silently ignored.
      locals.set(meta.name, { slug: meta.name, version: meta.version, sha256: "" });
    }
  }

  // Fail-closed listing: a non-array response is an authentication failure, a proxy
  // page, or a truncated body — never "the registry is empty". An empty registry read as
  // real would plan every local skill as a push into the void and make a dead credential
  // look like convergence.
  const remoteRowsPayload = await client.listSkills().catch(() => {
    throw new Error("Registry listing failed: the server refused or could not return the catalog.");
  });
  if (!Array.isArray(remoteRowsPayload)) {
    const shape = remoteRowsPayload && typeof remoteRowsPayload === "object"
      ? `object with keys [${Object.keys(remoteRowsPayload as object).join(", ")}]`
      : typeof remoteRowsPayload;
    throw new ReconcileRegistryError(
      `Registry listing failed: expected an array of skills, got ${shape}.`,
      ["Check HASNA_SKILLS_API_URL and the resolved credential; a failed listing must not be read as an empty registry."],
    );
  }
  const remotes = new Map<string, RemoteSkill>();
  for (const row of remoteRowsPayload) {
    if (!row || typeof row !== "object") continue;
    const skill = remoteRowToSkill(row as Record<string, unknown>);
    if (skill) remotes.set(skill.slug, skill);
  }

  const allSlugs = [...new Set([...locals.keys(), ...remotes.keys()])].sort();
  const skills: ReconcileSkillEntry[] = [];

  for (const slug of allSlugs) {
    const local = locals.get(slug);
    const remote = remotes.get(slug);
    const baseline = local ? readBaseline(join(root, slug)) : undefined;
    const { state, reason } = classifySkill(local, remote, baseline);
    let { action, reason: actionReason } = resolveAction(state, direction, conflict);
    // Verified pulls only: a remote-only row without a bundle digest cannot be pulled
    // through the verified path, so it is skipped with a reason instead of falling into
    // the unverifiable metadata fallback.
    if (state === "remote-only" && isDigestless(remote)) {
      action = "skip";
      actionReason = "no bundle digest; verified pulls only (use `skills pull --all` for metadata-only)";
    }
    skills.push({
      slug,
      state,
      action,
      ...(local?.version ? { localVersion: local.version } : {}),
      ...(remote?.version ? { remoteVersion: remote.version } : {}),
      ...(local?.sha256 ? { localSha256: local.sha256 } : {}),
      ...(remote?.sha256 ? { remoteSha256: remote.sha256 } : {}),
      ...(reason ?? actionReason ? { reason: reason ?? actionReason } : {}),
    });
  }

  const summary: ReconcileSummary = {
    local: locals.size,
    remote: remotes.size,
    inSync: 0,
    pushed: 0,
    pulled: 0,
    conflicts: 0,
    skipped: 0,
    errors: 0,
  };

  for (const entry of skills) {
    if (entry.state === "in-sync") summary.inSync += 1;
    if (entry.state === "conflict") summary.conflicts += 1;
    if (entry.action === "skip") summary.skipped += 1;
  }

  const pushSlugs = skills.filter((entry) => entry.action === "push").map((entry) => entry.slug);
  const pullSlugs = skills.filter((entry) => entry.action === "pull").map((entry) => entry.slug);

  if (!dryRun) {
    for (const slug of pushSlugs) {
      const entry = skills.find((item) => item.slug === slug)!;
      // Re-check the remote side before mutating: a concurrent publisher that moved the
      // digest after the plan must not be overwritten under a skip policy. A re-check
      // that FAILS (network, non-success status) is an error, never a silent skip.
      const plannedRemote = remotes.get(slug)?.sha256;
      let currentRemote: string | undefined;
      try {
        currentRemote = await currentRemoteDigest(client, slug);
      } catch (error) {
        entry.result = { ok: false, detail: (error as Error).message };
        summary.errors += 1;
        continue;
      }
      if (plannedRemote === undefined ? currentRemote !== undefined : currentRemote !== plannedRemote) {
        entry.result = { ok: false, detail: "remote changed during sync; push skipped" };
        entry.reason = (entry.reason ? `${entry.reason}; ` : "") + "remote changed during sync";
        summary.skipped += 1;
        continue;
      }
      try {
        await pushSkill(slug, { rootDir: root, client });
        // Record the pushed state as the new baseline so the next sync can prove
        // direction. The marker is the canonical pull.ts shape; `source: "sync"`
        // distinguishes a push-written marker from a pull-written one.
        const pushed = locals.get(slug);
        writePullMarker(join(root, slug), {
          skill: slug,
          ...(pushed?.version ? { version: pushed.version } : {}),
          ...(pushed?.sha256 ? { contentHash: pushed.sha256 } : {}),
          source: "sync",
        });
        entry.result = { ok: true };
        summary.pushed += 1;
      } catch (error) {
        entry.result = { ok: false, detail: (error as Error).message };
        summary.errors += 1;
      }
    }

    // Re-check each pull candidate immediately before the batch: a remote digest that
    // moved, or a local directory that changed since the plan, drops the skill from the
    // batch and reports it instead of pulling over state the plan did not see.
    const verifiedPullSlugs: string[] = [];
    for (const slug of pullSlugs) {
      const entry = skills.find((item) => item.slug === slug)!;
      const plannedRemote = remotes.get(slug)?.sha256;
      let currentRemote: string | undefined;
      try {
        currentRemote = await currentRemoteDigest(client, slug);
      } catch (error) {
        entry.result = { ok: false, detail: (error as Error).message };
        summary.errors += 1;
        continue;
      }
      if (plannedRemote === undefined ? currentRemote !== undefined : currentRemote !== plannedRemote) {
        entry.result = { ok: false, detail: "remote changed during sync; pull skipped" };
        entry.reason = (entry.reason ? `${entry.reason}; ` : "") + "remote changed during sync";
        summary.skipped += 1;
        continue;
      }
      const plannedLocal = locals.get(slug)?.sha256;
      const localDir = getPortableSkillPath(slug, { rootDir: root });
      // Pack-first, existence-sample-after (see recheckLocalSide): a directory that
      // appeared between the plan and the pack is provably on disk when sampled.
      const localMoved = recheckLocalSide(plannedLocal, localDir);
      if (localMoved) {
        entry.result = { ok: false, detail: "local changed during sync; pull skipped" };
        entry.reason = (entry.reason ? `${entry.reason}; ` : "") + "local changed during sync";
        summary.skipped += 1;
        continue;
      }
      verifiedPullSlugs.push(slug);
    }

    if (verifiedPullSlugs.length > 0) {
      try {
        const pulled = await pullSkills({ names: verifiedPullSlugs, rootDir: root, client, signingKey: options.signingKey });
        for (const result of pulled.results) {
          const entry = skills.find((item) => item.slug === result.name);
          if (entry) {
            entry.result = { ok: result.success, ...(result.error ? { detail: result.error } : {}) };
            if (result.success) summary.pulled += 1;
            else summary.errors += 1;
          }
        }
      } catch (error) {
        // A wholesale pull failure is one error line, not one per skill.
        for (const slug of verifiedPullSlugs) {
          const entry = skills.find((item) => item.slug === slug);
          if (entry) entry.result = { ok: false, detail: (error as Error).message };
        }
        summary.errors += verifiedPullSlugs.length;
      }
    }

    // The cursor records a successful sync. A run with errors must not advance it: a
    // later reader would mistake the failed run for convergence.
    if (summary.errors === 0) {
      const cursor: ReconcileCursor = {
        schemaVersion: SYNC_CURSOR_SCHEMA_VERSION,
        managedBy: "@hasna/skills",
        lastSyncedAt: new Date().toISOString(),
        runCount: readCursor(root).runCount + 1,
        summary,
      };
      writeFileSync(join(root, SYNC_CURSOR_FILE), `${JSON.stringify(cursor, null, 2)}\n`);
      return {
        corpusRoot: root,
        migrationPending,
        direction,
        dryRun: false,
        conflictPolicy: conflict,
        conflictPolicyDescription: conflict === "skip" ? DEFAULT_CONFLICT_POLICY : conflict,
        summary,
        skills,
        cursor: { lastSyncedAt: cursor.lastSyncedAt, runCount: cursor.runCount },
      };
    }
  }

  // Dry run: the plan is reported with every action that would execute counted as
  // planned, and nothing was written anywhere.
  if (dryRun) {
    summary.pushed = pushSlugs.length;
    summary.pulled = pullSlugs.length;
  }
  return {
    corpusRoot: root,
    migrationPending,
    direction,
    dryRun,
    conflictPolicy: conflict,
    conflictPolicyDescription: conflict === "skip" ? DEFAULT_CONFLICT_POLICY : conflict,
    summary,
    skills,
  };
}
