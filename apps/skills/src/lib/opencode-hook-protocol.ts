import { createHash } from "node:crypto";
import { CLI_BRIDGE_FILES } from "./agent-bridge.js";

// OpenCode v2's ConfigMarkdown/SkillFile parser removes frontmatter, retaining
// the body bytes. Hash the canonical bridge's parsed body, never native payloads.
export const OPENCODE_BRIDGE_BODY_SHA256 = createHash("sha256")
  .update(CLI_BRIDGE_FILES["SKILL.md"]!.replace(/^---\n[\s\S]*?\n---\n/, ""))
  .digest("hex");
export const OPENCODE_BRIDGE_DESCRIPTION_SHA256 = createHash("sha256")
  .update(/^description: (.+)$/m.exec(CLI_BRIDGE_FILES["SKILL.md"]!)![1]!)
  .digest("hex");

export function isVerifiedOpenCodeSkillDescriptor(value: unknown, expectedPath: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const skill = value as Record<string, unknown>;
  return skill.id === "skills-cli" && skill.name === "skills-cli" && skill.path === expectedPath
    && skill.contentSha256 === OPENCODE_BRIDGE_BODY_SHA256
    && skill.descriptionSha256 === OPENCODE_BRIDGE_DESCRIPTION_SHA256;
}

/** Explicit adapter phase, including empty attachment-only prompt admission. */
export function openCodeContextDelivery(input: unknown): boolean {
  return !!input && typeof input === "object" && !Array.isArray(input)
    && (input as Record<string, unknown>).delivery_phase === "context";
}
