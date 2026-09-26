#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import pkg from "../../package.json" with { type: "json" };
import { assertDurableStore, resolveServerConfig } from "../sdk/server.js";
import { executeRun } from "../sdk/executor.js";
import { ArtifactStorage, createStore, resolveDatabaseTarget } from "../sdk/storage.js";
import type { SkillsProductStore } from "../sdk/storage.js";

export async function runWorkerOnce(
  store: SkillsProductStore,
  workerId = `worker_${randomUUID().slice(0, 8)}`,
  storage = new ArtifactStorage(),
): Promise<boolean> {
  const run = await store.claimNextRun({ workerId });
  if (!run) return false;
  if (run.status === "cancel_requested") {
    await store.updateRun(run.id, { status: "cancelled", completedAt: new Date().toISOString() });
    return true;
  }
  await executeRun(store, run, storage);
  return true;
}

if (import.meta.main) {
  // Binds-before-version class (todos row 19140ea1 / O15-00621): --version/
  // --help must answer BEFORE resolveServerConfig()/createStore() opens the
  // database. They previously fell through and entered the run loop with no
  // output — measured hanging until killed, storage line printed, no version
  // on stdout. Mirrors the server guard (row 7e5f8f3d).
  const EARLY_ARGV = process.argv.slice(2);
  if (EARLY_ARGV.includes("--version") || EARLY_ARGV.includes("-V")) {
    console.log(pkg.version);
    process.exit(0);
  }
  if (EARLY_ARGV.includes("--help") || EARLY_ARGV.includes("-h")) {
    console.log(`Usage: skills-worker [options]

Marks queued legacy unversioned runs as retired. Published executable bundles
run through the managed runtime.

Options:
  -V, --version  output the version number
  -h, --help     display help for command
      --once     process exactly one run, then exit

Environment:
  HASNA_SKILLS_WORKER_ID       Worker identity (default: worker_<random>)
  HASNA_SKILLS_WORKER_IDLE_MS  Idle pause between polls (default: 1000)`);
    process.exit(0);
  }

  const config = resolveServerConfig();
  const store = await createStore({ databaseUrl: config.databaseUrl, bootstrapApiKey: config.bootstrapApiKey });
  // The same guard the API applies. A worker on a non-durable store is worse than a
  // server on one: it claims runs out of a queue nobody else can see, so the API's runs
  // stay queued forever with nothing logged anywhere.
  assertDurableStore(store, config);
  const storage = new ArtifactStorage({ bucket: config.artifactBucket, prefix: config.artifactPrefix, runPrefix: config.runArtifactPrefix });
  // Name the database for the same reason the server does. An API container and a
  // worker container that each defaulted to their own local SQLite file would otherwise
  // present as a queue that never drains, with no error on either side; two different
  // paths on this line is the fastest way to see it.
  console.log(`skills worker ${process.env.HASNA_SKILLS_WORKER_ID || ""} storage: ${resolveDatabaseTarget(config.databaseUrl).label}`);
  const workerId = process.env.HASNA_SKILLS_WORKER_ID || `worker_${randomUUID().slice(0, 8)}`;
  const once = process.argv.includes("--once");
  const idleMs = Number.parseInt(process.env.HASNA_SKILLS_WORKER_IDLE_MS || "1000", 10);

  const pause = Number.isFinite(idleMs) ? idleMs : 1000;
  let consecutiveErrors = 0;

  do {
    let processed = false;
    try {
      processed = await runWorkerOnce(store, workerId, storage);
      consecutiveErrors = 0;
    } catch (error) {
      // A long-lived worker must survive a transient store error.
      //
      // Without this, one SQLITE_BUSY - reachable, because busy_timeout is finite and a
      // journal checkpoint can return BUSY even with a handler installed - escaped as an
      // unhandled rejection and killed the process. Nothing restarts it, so the queue
      // stopped draining with no error anywhere except the dead worker's exit, while the
      // API kept happily accepting runs.
      consecutiveErrors += 1;
      console.error(`worker ${workerId}: claim/execute failed (${consecutiveErrors} in a row):`, (error as Error).message);
      if (once) process.exit(1);
      // Back off so a persistent failure (bad credentials, deleted database file) does
      // not become a hot loop filling the log.
      await new Promise((resolve) => setTimeout(resolve, Math.min(pause * consecutiveErrors, 30_000)));
      continue;
    }
    if (once) process.exit(processed ? 0 : 2);
    if (!processed) await new Promise((resolve) => setTimeout(resolve, pause));
  } while (true);
}
