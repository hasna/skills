/**
 * Compatibility seam for historical unversioned run records.
 *
 * Embedders may supply their own implementation of the interface. The legacy
 * implementation only drains old records to a fenced refusal; versioned bundle
 * execution uses the managed runtime and never resolves an embedded skill name.
 */
import { ArtifactStorage } from "../server/artifact-storage.js";
import { executeRun } from "../server/handlers.js";
import type { ServerRunRecord, SkillsProductStore } from "../server/types.js";

/** Executes one claimed run to a terminal state. */
export interface RunExecutor {
  execute(
    store: SkillsProductStore,
    run: ServerRunRecord,
    storage?: ArtifactStorage,
  ): Promise<ServerRunRecord>;
}

/** @deprecated Drains legacy records with LEGACY_EXECUTION_RETIRED; executes no skill. */
export const localRunExecutor: RunExecutor = {
  execute: (store, run, storage) => executeRun(store, run, storage),
};

export { executeRun };
