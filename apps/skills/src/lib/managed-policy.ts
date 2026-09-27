import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { getDataDirReadOnly } from "./config.js";
import { SkillSelectionError } from "./selection-cache.js";
import { AGENT_POLICY_LIMITS, assertAgentPolicyCollections } from "./agent-policy-limits.js";
function refusal(reason = "is unreadable"): SkillSelectionError { return new SkillSelectionError("INVALID_AGENT_POLICY", `The Skills agent loading policy ${reason}; refusing legacy fallback.`); }

/** Validate the actual wire representation shared by readers and activation. */
export function parseManagedSkillPolicy(text: string): Record<string, any> {
  if (Buffer.byteLength(text) > AGENT_POLICY_LIMITS.bytes) throw refusal("exceeds its size limit");
  let value: any; try { value = JSON.parse(text); } catch { throw refusal(); }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.loading !== "cli" || (value.version !== undefined && value.version !== 1)) throw refusal();
  if (value.profileId !== undefined && (typeof value.profileId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.profileId) || value.profileId.includes(".."))) throw refusal();
  try { assertAgentPolicyCollections(value); } catch { throw refusal("has invalid collection bounds"); }
  return value;
}
export function serializeManagedSkillPolicy(value: Record<string, any>): string {
  const text = `${JSON.stringify(value, null, 2)}\n`; parseManagedSkillPolicy(text); return text;
}

/** Read at most the shared byte bound, including a concurrent file growth. */
export function readManagedSkillPolicySnapshot(dataDir = getDataDirReadOnly()): { text: string; value: Record<string, any> } | null {
  const path = join(dataDir, "agent-policy.json"); let descriptor: number | undefined, observed = false;
  try {
    const stat = lstatSync(path); observed = true;
    if (!stat.isFile() || stat.isSymbolicLink()) throw refusal();
    if (stat.size > AGENT_POLICY_LIMITS.bytes) throw refusal("exceeds its size limit");
    // A regular path may become a FIFO after lstat. Never block before fstat
    // can reject its replacement; O_NONBLOCK has no effect on regular files.
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK);
    const opened = fstatSync(descriptor);
    if (!opened.isFile()) throw refusal();
    if (opened.size > AGENT_POLICY_LIMITS.bytes) throw refusal("exceeds its size limit");
    const bytes = Buffer.allocUnsafe(AGENT_POLICY_LIMITS.bytes + 1); let length = 0;
    while (length < bytes.length) { const count = readSync(descriptor, bytes, length, bytes.length - length, null); if (count === 0) break; length += count; }
    if (length > AGENT_POLICY_LIMITS.bytes) throw refusal("exceeds its size limit");
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length));
    return { text, value: parseManagedSkillPolicy(text) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !observed) {
      // A dangling link is not an absent unmanaged policy.
      if (lstatSync(path, { throwIfNoEntry: false }) === undefined) return null;
    }
    if (error instanceof SkillSelectionError) throw error;
    throw refusal();
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}
/** Lightweight policy check; importing agent integration would create a cycle. */
export function readManagedSkillPolicy(dataDir = getDataDirReadOnly()): { loading?: string; profileId?: string } | null { return readManagedSkillPolicySnapshot(dataDir)?.value ?? null; }
export function requiresCliSkillLoading(dataDir = getDataDirReadOnly()): boolean { return readManagedSkillPolicy(dataDir)?.loading === "cli"; }
