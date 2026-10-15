import { writeCliOutput } from "../output.js";
import type { Command } from "commander";
import { hostname } from "node:os";
import { readSelectionProvenance, type SelectionProvenanceConsumer, type SelectionProvenanceReceipt } from "../../lib/selection-provenance.js";
import { selectedProfileId } from "./context.js";

export interface ProvenanceCommandOptions {
  selectionProfile?: string;
  station?: string;
  session?: string;
  cached?: boolean;
  json?: boolean;
}

/**
 * One read-only receipt for the selection chain: selected, activated, applied,
 * pinned and consumed are named separately, and every consumer carries its
 * status and reason. An exit code here only reports a bad request: a read that
 * could not be answered is recorded as `unverified`, because that is the fact
 * the caller came for.
 */
export function provenanceLines(receipt: SelectionProvenanceReceipt): string[] {
  const selected = receipt.selected;
  const lines = [
    `Selection profile ${receipt.selectionProfile}`,
    `Selected: ${selected.profileRevision ?? "unavailable"} (${selected.selectionCount ?? 0} selections, ${selected.source})`,
  ];
  for (const consumer of receipt.consumers) lines.push(...consumerLines(consumer));
  if (receipt.drift.length > 0) {
    lines.push(`Drift (${receipt.drift.length}${receipt.driftTruncated ? ", truncated" : ""}):`);
    for (const row of receipt.drift) lines.push(`- ${row.source} ${row.id}: ${row.slug} ${row.selectedVersion} -> ${row.observedVersion}`);
  }
  return lines;
}
function consumerLines(consumer: SelectionProvenanceConsumer): string[] {
  const label = consumer.kind === "session" ? "Pinned" : consumer.source === "local-receipt" ? "Activated" : "Applied";
  const identity = consumer.kind === "session" ? `session ${consumer.id}` : consumer.source === "local-receipt" ? "this machine" : `station ${consumer.id}`;
  const lines = [`${label}: ${identity} ${consumer.profileRevision ?? "no receipt"} [${consumer.status}]`, `  ${consumer.reason}`];
  if (consumer.kind === "session" && consumer.consumed) {
    lines.push(`Consumed: ${consumer.loadedCount ?? 0} of ${consumer.selectionCount ?? 0} selections loaded`);
    for (const selection of consumer.consumed) lines.push(`- ${selection.slug}@${selection.version} ${selection.bundleDigest}`);
  }
  return lines;
}

export function registerProvenance(parent: Command): void {
  parent.command("provenance")
    .description("Read-only receipt of the selected, activated, applied, pinned and actually loaded skill versions")
    .option("--selection-profile <id>", "Selection profile to read (default: the managed profile)")
    .option("--station <id>", "Station whose sync receipt to read (default: HASNA_STATION, then this host)")
    .option("--session <id>", "Also report one session's pin and the versions it actually loaded")
    .option("--cached", "Read the reference from the locally synced snapshot and never ask the authority", false)
    .option("--json", "Return the receipt as JSON", false)
    .action(async (options: ProvenanceCommandOptions) => {
      try {
        const receipt = await readSelectionProvenance({
          profileId: selectedProfileId(options.selectionProfile),
          stationId: options.station ?? process.env.HASNA_STATION ?? hostname(),
          ...(options.session === undefined ? {} : { sessionId: options.session }),
          ...(options.cached ? { cached: true } : {}),
        });
        await writeCliOutput(options.json ? JSON.stringify(receipt) : provenanceLines(receipt).join("\n"));
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });
}
