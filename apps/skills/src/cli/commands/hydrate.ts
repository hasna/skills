/**
 * `skills hydrate` — hydrate the canonical dedup corpus cache from a reviewed
 * per-station skills snapshot. The CLI surface of
 * src/lib/station-hydrate.ts, itself a port of
 * hasna-internal/fleet-resources scripts/hydrate-cache.mjs (todos FLE-00037,
 * package-abstractions rule).
 *
 * Fail-closed contract carried over from the source script: an invalid
 * station id, a missing sync-manifest, a symlink in the snapshot, or an
 * existing cache file with different content all exit 2 (terminal
 * non-acceptance); unexpected errors exit 1.
 */
import chalk from "chalk";
import type { Command } from "commander";

import {
  StationSnapshotError
} from "../../lib/station-snapshot.js";
import {
  writeStationHydration,
  type StationHydrationResult
} from "../../lib/station-hydrate.js";

export function registerHydrate(parent: Command) {
  parent
    .command("hydrate")
    .description("Hydrate the canonical dedup corpus cache from a reviewed per-station skills snapshot")
    .requiredOption("--station <id>", "Station id (slug) naming the snapshot under resources/<id>/skills")
    .option("--apply", "Write into the corpus cache (the default is dry-run)", false)
    .option("--dry-run", "Report without writing anything (the default)", false)
    .option("--cache-root <dir>", "Override the destination corpus cache (used to stage another station's cache before rsync)")
    .option("--repo-root <path>", "Repo root holding resources/<station>/skills (default: cwd)")
    .action((options: {
      station: string;
      apply: boolean;
      dryRun: boolean;
      cacheRoot?: string;
      repoRoot?: string;
    }) => {
      handleHydrate(options);
    });
}

function handleHydrate(options: {
  station: string;
  apply: boolean;
  dryRun: boolean;
  cacheRoot?: string;
  repoRoot?: string;
}): void {
  if (options.apply && options.dryRun) {
    console.error(chalk.red("--apply and --dry-run are mutually exclusive"));
    process.exitCode = 2;
    return;
  }

  let result: StationHydrationResult;
  try {
    result = writeStationHydration({
      stationId: options.station,
      repoRoot: options.repoRoot,
      cacheRoot: options.cacheRoot,
      dryRun: !options.apply
    });
  } catch (error) {
    if (error instanceof StationSnapshotError) {
      for (const line of error.detail) console.error(`CONFLICT ${line}`);
      console.error(`FAIL ${error.message}`);
      process.exitCode = 2;
    } else {
      console.error(`FAIL ${(error as Error).stack ?? (error as Error).message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (result.mode === "dry-run") {
    console.log(
      `DRY-RUN station=${result.stationId} idents=${result.stats.idents} files=${result.stats.files} bytes=${result.stats.bytes}`
    );
    console.log(
      `  cache-root=${result.cacheRoot} snapshot-sha=${result.sourceSnapshotSha.slice(0, 12)}`
    );
    for (const skill of result.winners) {
      const merged = skill.files.length > 1
        ? ` (${skill.files.length} files, alternates: ${skill.files.map(
            (file) => file.alternates.length > 0
              ? `${file.withinIdent}<-${file.alternates.join(",")}`
              : null
          ).filter(Boolean).join("; ") || "none"})`
        : "";
      console.log(`  ${skill.ident}${merged}`);
    }
    return;
  }

  console.log(
    `HYDRATE station=${result.stationId} idents=${result.stats.idents} written=${result.stats.written} unchanged=${result.stats.unchanged} files=${result.stats.files} bytes=${result.stats.bytes}`
  );
  console.log(`  manifest=${result.manifestPath} snapshot-sha=${result.sourceSnapshotSha}`);
}
