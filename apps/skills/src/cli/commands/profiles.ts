import { writeCliOutput } from "../output.js";
import type { Command } from "commander";
import { closeSync, constants, fstatSync, openSync, readSync, writeFileSync } from "node:fs";
import { readSkillProfile, saveSkillProfile, readStationSkillState } from "../../lib/profile-admin.js";
import { MAX_PROFILE_DOCUMENT_BYTES } from "../../lib/profile-limits.js";
import { RemoteSkillsPermissionError } from "../../lib/remote-permissions.js";

function readProfileInput(path: string): string {
  // Open without waiting for a FIFO writer so fstat can reject nonregular input.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_PROFILE_DOCUMENT_BYTES) throw new Error("Profile input exceeds the size limit or is not a regular file");
    const bytes = Buffer.alloc(MAX_PROFILE_DOCUMENT_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = readSync(fd, bytes, size, bytes.length - size, null);
      if (!read) break;
      size += read;
    }
    if (size > MAX_PROFILE_DOCUMENT_BYTES) throw new Error("Profile input exceeds the size limit");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
  } finally { closeSync(fd); }
}

export function registerProfiles(parent: Command): void {
  const profiles = parent.command("profiles").description("Manage exact, shared skill selections through the API");
  profiles.command("show <id>").option("--json", "Output the profile as JSON", false)
    .option("--save <path>", "Save a private snapshot for review or rollback")
    .action(async (id: string, options) => {
      try {
        const profile = await readSkillProfile(id), text = JSON.stringify(profile, null, 2);
        if (options.save) writeFileSync(options.save, JSON.stringify(profile), { mode: 0o600, flag: "wx" });
        await writeCliOutput(options.json ? text : `${profile.id} at ${profile.revision}: ${profile.selections.map(skill => `${skill.slug}@${skill.version}`).join(", ")}`);
      } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
    });
  profiles.command("set <id>").requiredOption("--file <path>", "JSON snapshot with a selections array")
    .option("--if-match <revision>", "Replace only this existing revision; omission creates a new profile")
    .option("--json", "Output the saved profile as JSON", false)
    .description("Create or update a profile; use a saved snapshot with --if-match to roll back")
    .action(async (id: string, options) => {
      try {
        const text = readProfileInput(options.file);
        const input = JSON.parse(text);
        const profile = await saveSkillProfile(id, input.selections, options.ifMatch);
        await writeCliOutput(options.json ? JSON.stringify(profile) : `Saved ${profile.id} at ${profile.revision}`);
      } catch (error) {
        if (options.json && error instanceof RemoteSkillsPermissionError)
          await writeCliOutput(JSON.stringify({ error: error.message, code: error.code, status: error.status, permission: error.permission }));
        else console.error((error as Error).message);
        process.exitCode = 1;
      }
    });
  parent.command("station-state <id>").description("Read this actor's last applied skill selection on a station")
    .option("--json", "Output the station receipt as JSON", false)
    .action(async (id: string) => {
      try { await writeCliOutput(JSON.stringify(await readStationSkillState(id), null, 2)); }
      catch (error) { console.error((error as Error).message); process.exitCode = 1; }
    });
}
