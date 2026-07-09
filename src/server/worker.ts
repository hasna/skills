#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { ArtifactStorage } from "./artifact-storage.js";
import { resolveServerConfig } from "./config.js";
import { executeRun } from "./handlers.js";
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
  const storage = new ArtifactStorage({ bucket: config.artifactBucket, prefix: config.artifactPrefix });
  const workerId = process.env.HASNA_SKILLS_WORKER_ID || `worker_${randomUUID().slice(0, 8)}`;
  const once = process.argv.includes("--once");
  const idleMs = Number.parseInt(process.env.HASNA_SKILLS_WORKER_IDLE_MS || "1000", 10);

  do {
    const processed = await runWorkerOnce(store, workerId, storage);
    if (once) process.exit(processed ? 0 : 2);
    if (!processed) await new Promise((resolve) => setTimeout(resolve, Number.isFinite(idleMs) ? idleMs : 1000));
  } while (true);
}
