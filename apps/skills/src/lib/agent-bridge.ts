import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const CLI_BRIDGE_NAME = "skills-cli";
export const CLI_BRIDGE_VERSION = 1;
const markdown = `---
name: skills-cli
description: Discover, load, author, and run versioned skills through the Skills CLI when a task needs reusable instructions or an executable skill.
---

Use the Skills CLI as the skill authority for this station.

- Discover available skills with \`skills list --json\` or \`skills search <query> --json\`.
- Read selected instructions with \`skills load <slug>\`. Use \`skills sync\` to refresh the station's shared selection profile.
- Create local drafts with \`skills new <name> --kind instruction\` or \`--kind executable\` in the Skills-owned source directory. Validate with \`skills validate <name>\`; use \`skills push --help\` for explicit versioned publication.
- Run a skill only when the user's task calls for execution. Use \`skills run --help\` and select the intended local or cloud target explicitly.

This bridge contains no skill payloads. Do not copy skill content into agent-native skill directories or load other native skill copies. If a Skills command refuses authority, selection, integrity, or native drift, report that refusal and use its repair guidance; do not substitute bundled or stale local content. Explicit local draft authoring remains available.
`;
export const CLI_BRIDGE_DIGEST = createHash("sha256").update(markdown).digest("hex");
export const CLI_BRIDGE_FILES: Readonly<Record<string, string>> = Object.freeze({
  "SKILL.md": markdown,
  ".hasna-skills.json": `${JSON.stringify({ managedBy: "@hasna/skills", kind: "cli-bridge", version: CLI_BRIDGE_VERSION, protocol: "selection-v1", contentSha256: CLI_BRIDGE_DIGEST }, null, 2)}\n`,
});

/** Ownership is exact bytes at an expected location, never a marker's claim alone. */
export function isOwnedCliBridge(path: string, expectedPaths: readonly string[]): boolean {
  if (!expectedPaths.includes(path)) return false;
  try {
    if (!lstatSync(path).isDirectory()) return false;
    if (JSON.stringify(readdirSync(path).sort()) !== JSON.stringify(Object.keys(CLI_BRIDGE_FILES).sort())) return false;
    return Object.entries(CLI_BRIDGE_FILES).every(([name, content]) => {
      const file = join(path, name), stat = lstatSync(file);
      return stat.isFile() && !stat.isSymbolicLink() && stat.size === Buffer.byteLength(content) && readFileSync(file, "utf8") === content;
    });
  } catch { return false; }
}
