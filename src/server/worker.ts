#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { assertDurableStore } from "./app.js";
import { ArtifactStorage } from "./artifact-storage.js";
import { resolveServerConfig } from "./config.js";
import { executeRun } from "./handlers.js";
import { resolveDatabaseTarget } from "./database-url.js";
import { createStore } from "./store.js";
import type { SkillsProductStore } from "./types.js";

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
  const config = resolveServerConfig();
  const store = await createStore({ databaseUrl: config.databaseUrl, bootstrapApiKey: config.bootstrapApiKey });
  // The same guard the API applies. A worker on a non-durable store is worse than a
  // server on one: it claims runs out of a queue nobody else can see, so the API's runs
  // stay queued forever with nothing logged anywhere.
  assertDurableStore(store, config);
  const storage = new ArtifactStorage({ bucket: config.artifactBucket, prefix: config.artifactPrefix });
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
