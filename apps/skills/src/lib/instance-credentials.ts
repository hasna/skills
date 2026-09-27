import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, type Stats } from "node:fs";
import { credentialDiskSourceList } from "@hasna/contracts/client";
import { selectedCliSkillsCredentialProfile } from "./cli-credential-profile.js";

export const SKILLS_BOUND_API_URL = "HASNA_SKILLS_BOUND_API_URL";
type Env = Record<string, string | undefined>;

/** Match the shared resolver's profile syntax before using its path helper. */
export function selectedSkillsProfile(env: Env, explicit?: string): string | null {
  const selected = explicit ?? selectedCliSkillsCredentialProfile() ?? env.HASNA_PROFILE;
  if (selected === undefined) return null;
  const profile = selected.trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(profile)) throw new Error("Invalid Skills credential profile");
  return profile;
}

export function skillsProfileCredentialFiles(env: Env, explicit?: string): string[] {
  return credentialDiskSourceList("skills", env, selectedSkillsProfile(env, explicit)).map(source => source.path);
}

function fileIdentity(file: string): Stats | null {
  try { return lstatSync(file); } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return null;
    throw new Error("Cannot inspect Skills instance configuration");
  }
}
function unchanged(before: Stats | null, after: Stats | null): boolean {
  return before === null || after === null ? before === after
    : ["dev", "ino", "size", "mtimeMs", "ctimeMs", "mode", "uid"].every(key => before[key as keyof Stats] === after[key as keyof Stats]);
}
/** Fence the released credential reader and this package's routing reads together. */
export function captureSkillsCredentialFiles(files: string[]): () => void {
  const identities = files.map(file => [file, fileIdentity(file)] as const);
  return () => {
    if (identities.some(([file, before]) => !unchanged(before, fileIdentity(file)))) {
      throw new Error("Skills instance configuration changed while resolving credentials; retry without sending a credential");
    }
  };
}

/**
 * contracts 1.0.1 does not expose its secure per-file/profile metadata reader.
 * Keep this routing-only adapter bounded and descriptor-based; shared
 * resolveCredential still owns parsing, validating and selecting API keys.
 */
function readMetadataText(file: string): string | null {
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return null;
    throw new Error("Cannot safely read Skills instance configuration");
  }
  try {
    const before = fstatSync(fd);
    const uid = process.getuid?.() ?? process.geteuid?.();
    if (!before.isFile() || ![0o400, 0o600].includes(before.mode & 0o7777)
      || (uid !== undefined && before.uid !== uid) || before.size > 64 * 1024) {
      throw new Error("Unsafe Skills instance configuration; expected a bounded owner-only regular file");
    }
    const bytes = Buffer.alloc(64 * 1024 + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > 64 * 1024 || !unchanged(before, fstatSync(fd)) || !unchanged(before, fileIdentity(file))) {
      throw new Error("Skills instance configuration changed while reading");
    }
    return bytes.subarray(0, length).toString("utf8");
  } finally { closeSync(fd); }
}

/** Read only known non-secret routing fields, never export an API key or an arbitrary field. */
export function readSkillsInstanceMetadata(file: string): { apiUrl?: string; binding?: string } {
  const text = readMetadataText(file);
  if (text === null) return {};
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?(HASNA_SKILLS_API_URL|SKILLS_API_URL|HASNA_SKILLS_BOUND_API_URL)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!value || /[\x00-\x20\x7f]/.test(value) || values.has(match[1]!)) throw new Error("Invalid Skills instance configuration");
    values.set(match[1]!, value);
  }
  const urls = [values.get("HASNA_SKILLS_API_URL"), values.get("SKILLS_API_URL")].filter(Boolean);
  if (new Set(urls).size > 1) throw new Error("Skills API URL aliases disagree");
  return { apiUrl: urls[0], binding: values.get(SKILLS_BOUND_API_URL) };
}

/**
 * Whether a credentials file names a key or a vault pointer. Reads key NAMES
 * only, never a value; a missing file has none. Used to tell a brand-new named
 * profile (nothing stored yet, so it may sign in) from a broken selection.
 */
export function skillsFileHasCredential(file: string): boolean {
  const text = readMetadataText(file);
  if (text === null) return false;
  return /^\s*(?:export\s+)?(?:HASNA_SKILLS_API_KEY|SKILLS_API_KEY|HASNA_SKILLS_API_KEY_REF)\s*=\s*\S/m.test(text);
}
