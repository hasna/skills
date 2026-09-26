import type { Command } from "commander";
import {
  constants,
  closeSync,
  fstatSync,
  openSync,
  readSync,
  writeFileSync,
} from "node:fs";
import {
  readExecutionGrantPolicy,
  saveExecutionGrantPolicy,
} from "../../lib/execution-grant-client.js";
import { MAX_EXECUTION_GRANT_BYTES } from "../../lib/execution-grants.js";
import { writeCliOutput } from "../output.js";

function readInput(path: string): unknown {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_EXECUTION_GRANT_BYTES)
      throw new Error(
        "Grant input must be a regular file within the policy size limit."
      );
    const bytes = Buffer.alloc(MAX_EXECUTION_GRANT_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > MAX_EXECUTION_GRANT_BYTES)
      throw new Error("Grant input exceeds the policy size limit.");
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(0, size)
        )
      );
    } catch {
      throw new Error(
        "Grant input must be a JSON document containing a grants array."
      );
    }
  } finally {
    closeSync(fd);
  }
}
export function registerGrants(parent: Command): void {
  const grants = parent
    .command("grants")
    .description(
      "Manage shared execution grants containing vault references through the Skills API"
    );
  grants
    .command("show <profile>")
    .option("--revision <revision>", "Read an immutable policy revision")
    .option(
      "--save <path>",
      "Save a private policy snapshot for review or rollback"
    )
    .option("--json", "Output the full policy as JSON", false)
    .action(async (profile: string, options) => {
      try {
        const policy = await readExecutionGrantPolicy(
          profile,
          options.revision
        );
        if (options.save)
          writeFileSync(options.save, JSON.stringify(policy, null, 2), {
            mode: 0o600,
            flag: "wx",
          });
        await writeCliOutput(
          options.json
            ? JSON.stringify(policy)
            : `${policy.profileId} at ${policy.revision}: ${policy.grants.length} execution grants`
        );
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });
  grants
    .command("set <profile>")
    .requiredOption(
      "--file <path>",
      "Reviewed JSON policy with a grants array; empty revokes all shared grants"
    )
    .option(
      "--if-match <revision>",
      "Replace exactly this revision; omission creates the initial policy"
    )
    .option("--json", "Output the saved policy as JSON", false)
    .action(async (profile: string, options) => {
      try {
        const input = readInput(options.file) as { grants?: unknown };
        const policy = await saveExecutionGrantPolicy(
          profile,
          input?.grants as Parameters<typeof saveExecutionGrantPolicy>[1],
          options.ifMatch
        );
        await writeCliOutput(
          options.json
            ? JSON.stringify(policy)
            : `Saved execution grants for ${policy.profileId} at ${policy.revision}`
        );
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });
}
