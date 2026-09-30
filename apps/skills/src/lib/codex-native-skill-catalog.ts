import { realpathSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";
import { connectCodexHookRpc, type CodexHookRpc } from "./codex-hook-rpc.js";

export interface CodexNativeSkill {
  /** Native qualified name, not a directory name or plugin identifier. */
  name: string;
  path: string;
  enabled: boolean;
  pluginId: string | null;
}

export interface CodexNativeSkillCatalog {
  version: string;
  cwd: string;
  skills: CodexNativeSkill[];
}

const MAX_SKILLS = 4096;
const MAX_NAME_BYTES = 1024;
const MAX_PATH_BYTES = 16384;
const SUPPORTED_NAME_CONTROL_VERSIONS = new Set(["codex-cli 0.159.2"]);
function refuse(): never { throw new Error("CODEX_NATIVE_SKILL_CATALOG_INVALID"); }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const scalar = (value: unknown, max: number): value is string => typeof value === "string"
  && value.length > 0 && value.trim() === value && Buffer.byteLength(value, "utf8") <= max
  && !/[\u0000-\u001f\u007f]/u.test(value);
const absolutePath = (value: unknown): value is string => scalar(value, MAX_PATH_BYTES) && isAbsolute(value);

/** Project the measured native skills/list contract without retaining descriptions,
 * links, interfaces, errors, or any other untrusted native text. */
export function projectCodexNativeSkillCatalog(response: unknown, cwd: string): CodexNativeSkill[] {
  if (!absolutePath(cwd) || !object(response) || !Array.isArray(response.data) || response.data.length !== 1) refuse();
  const entry = response.data[0];
  if (!object(entry) || entry.cwd !== cwd || !Array.isArray(entry.errors) || entry.errors.length !== 0
    || !Array.isArray(entry.skills) || entry.skills.length > MAX_SKILLS) refuse();
  const paths = new Set<string>();
  return entry.skills.map((value: unknown) => {
    if (!object(value) || !scalar(value.name, MAX_NAME_BYTES) || !absolutePath(value.path)
      || typeof value.enabled !== "boolean"
      || (value.pluginId !== undefined && value.pluginId !== null && !scalar(value.pluginId, MAX_NAME_BYTES))) refuse();
    if (paths.has(value.path)) refuse();
    paths.add(value.path);
    return { name: value.name, path: value.path, enabled: value.enabled, pluginId: value.pluginId ?? null };
  });
}

/** Read one consumer's catalog through an owned, bounded native client. The RPC
 * transport owns request deadlines and child shutdown. Native discovery can
 * maintain its own caches; callers must constrain writes when requiring isolation. */
export async function captureCodexNativeSkillCatalog(
  options: { command: string; home: string; codexHome?: string; cwd: string; timeoutMs?: number },
  connect: (options: { command: string; home: string; codexHome?: string; timeoutMs?: number }) => Promise<CodexHookRpc> = connectCodexHookRpc,
): Promise<CodexNativeSkillCatalog> {
  if (!absolutePath(options.cwd) || !absolutePath(options.home)) refuse();
  const rpc = await connect({ command: options.command, home: options.home,
    ...(options.codexHome === undefined ? {} : { codexHome: options.codexHome }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
  try {
    if (!SUPPORTED_NAME_CONTROL_VERSIONS.has(rpc.version)) throw new Error("CODEX_NATIVE_SKILL_CATALOG_UNSUPPORTED_VERSION");
    const response: unknown = await rpc.request("skills/list", { cwds: [options.cwd], forceReload: true });
    return { version: rpc.version, cwd: options.cwd, skills: projectCodexNativeSkillCatalog(response, options.cwd) };
  } finally {
    await rpc.close();
  }
}

function canonicalPath(path: string): string {
  try { return realpathSync(path); } catch { return normalize(path); }
}

/** Evaluate already-selected user/session rules in native order. This is a rule
 * projection, not proof that an existing live consumer adopted the rules. Names
 * use exact equality; paths use native canonicalization with lexical fallback.
 * Unknown fields remain the caller's property and are not rewritten here. */
export function isCodexNativeSkillDisabled(skill: CodexNativeSkill, rules: unknown): boolean {
  if (!scalar(skill.name, MAX_NAME_BYTES) || !absolutePath(skill.path)) refuse();
  if (rules === undefined) return false;
  if (!Array.isArray(rules) || rules.length > MAX_SKILLS) refuse();
  let disabled = false;
  for (const rule of rules) {
    if (!object(rule) || typeof rule.enabled !== "boolean") refuse();
    const hasName = rule.name !== undefined && rule.name !== null;
    const hasPath = rule.path !== undefined && rule.path !== null;
    if (hasName === hasPath) refuse();
    let matches: boolean;
    if (hasName) {
      if (typeof rule.name !== "string" || !scalar(rule.name.trim(), MAX_NAME_BYTES)) refuse();
      matches = rule.name.trim() === skill.name;
    } else {
      if (!absolutePath(rule.path)) refuse();
      matches = canonicalPath(rule.path) === canonicalPath(skill.path);
    }
    if (matches) disabled = !rule.enabled;
  }
  return disabled;
}
