import type { Command } from "commander";
import { closeSync, constants, fstatSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { createRemoteSkillsClient, RemoteRequestError } from "../../lib/remote-client.js";
import { metadataPlan, metadataPlanSummary, SkillMetadataUpdateError } from "../../lib/skill-metadata-update.js";
import { RemoteSkillsPermissionError } from "../../lib/remote-permissions.js";
import { writeCliOutput } from "../output.js";

function readPlan(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new SkillMetadataUpdateError("INVALID_METADATA_PLAN");
    const bytes = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size !== stat.size) throw new SkillMetadataUpdateError("INVALID_METADATA_PLAN");
    return metadataPlan(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))));
  } finally { closeSync(fd); }
}
function failure(error: unknown): void {
  console.error(error instanceof SkillMetadataUpdateError || error instanceof RemoteRequestError || error instanceof RemoteSkillsPermissionError ? error.message : "Skill metadata operation failed; no confirmed update is available.");
  process.exitCode = 1;
}
export function registerMetadata(parent: Command): void {
  const metadata = parent.command("metadata").description("Preview and apply guarded category/tags corrections without publishing a bundle");
  metadata.command("preview <slug>")
    .option("--category <category>", "Replacement category")
    .option("--tags <json>", "Replacement tags as a JSON array (use [] to clear)")
    .requiredOption("--save <path>", "Create a private preservation plan; original instruction text is included")
    .action(async (slug: string, options) => {
      try {
        const client = await createRemoteSkillsClient();
        if (!client) throw new SkillMetadataUpdateError("METADATA_AUTH_REQUIRED");
        const plan = await client.prepareSkillMetadataUpdate(slug, {
          ...(options.category === undefined ? {} : { category: options.category }),
          ...(options.tags === undefined ? {} : { tags: JSON.parse(options.tags) }),
        });
        const bytes = `${JSON.stringify(plan)}\n`;
        writeFileSync(options.save, bytes, { mode: 0o600, flag: "wx" });
        if (readFileSync(options.save, "utf8") !== bytes) throw new SkillMetadataUpdateError("INVALID_METADATA_PLAN");
        await writeCliOutput(JSON.stringify(metadataPlanSummary(plan), null, 2));
      } catch (error) { failure(error); }
    });
  metadata.command("apply")
    .requiredOption("--file <path>", "Exact private plan saved by metadata preview")
    .action(async (options) => {
      try {
        const plan = readPlan(options.file);
        const client = await createRemoteSkillsClient();
        if (!client) throw new SkillMetadataUpdateError("METADATA_AUTH_REQUIRED");
        const result = await client.applySkillMetadataUpdate(plan);
        await writeCliOutput(JSON.stringify(result));
      } catch (error) { failure(error); }
    });
}
