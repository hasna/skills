import { writeCliOutput } from "../output.js";
import { syncSelectionProfile, type SyncSelectionProfileOptions } from "../../lib/selection-resolver.js";
import { selectedProfileId, reportContextError } from "./context.js";
import { hostname } from "node:os";

/** Command adapter for the top-level sync registrar; does not install native agent folders. */
export async function handleProfileSync(options: {
  selectionProfile?: string; profile?: string; project?: boolean; station?: string; stationReport?: boolean; check?: boolean; json?: boolean;
}, dependencies: SyncSelectionProfileOptions = {}): Promise<void> {
  try {
    const result = await syncSelectionProfile(selectedProfileId(options.selectionProfile ?? options.profile), {
      ...dependencies, projectDir: options.project ? process.cwd() : dependencies.projectDir,
      stationId: options.stationReport === false ? undefined : options.station ?? dependencies.stationId ?? process.env.HASNA_STATION ?? hostname(), check: options.check ?? dependencies.check,
    });
    if (options.json) await writeCliOutput(JSON.stringify(result));
    else await writeCliOutput(options.check
      ? result.changed ? "Skills profile or cached bundles need syncing." : "Skills profile and cached bundles are current."
      : `Synced Skills profile ${result.profile.profileId} at ${result.profile.profileRevision}; ${result.downloaded} bundle(s) downloaded.`);
    if (options.check && result.changed) process.exitCode = 1;
  } catch (error) { reportContextError(error, options.json); }
}
