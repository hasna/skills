/**
 * `skills pull` — fetch skills from the configured Skills instance into this machine's
 * corpus (~/.hasna/skills/installed/<name>/).
 *
 * This is the read half of the dogfooding loop. `skills push` sends a corpus skill up to
 * an instance; `skills pull` brings instance skills back down. Because loadRegistry()
 * already merges the corpus (listPortableSkillMetas), a pulled skill is visible to both
 * the CLI (`skills list --all`) and the MCP (`list_skills`) with no other step and no
 * product change.
 *
 * Fail-closed: with no instance origin configured, client construction throws
 * MissingApiUrlError (via getApiUrl() -> requireApiUrl()) rather than inventing a host.
 * There is deliberately no vendor default and no localhost fallback.
 */
import { createRemoteSkillsClient } from "./remote-client.js";
import {
  normalizePortableSkillName,
  writeCorpusSkill,
  type CorpusSkillMeta,
  type PortableSkillOptions,
} from "./portable-skills.js";
import type { SkillKind } from "./registry-types.js";

/**
 * The slice of RemoteSkillsClient that `pullSkills` needs. Narrowed to an interface so a
 * test can inject a fake and the real HTTP client (which satisfies it structurally) is
 * only constructed on the production path.
 */
export interface SkillPullClient {
  listSkills(): Promise<unknown[]>;
  getSkill(slug: string): Promise<unknown>;
  getSkillMd(slug: string): Promise<string | null>;
}

export interface PullSkillsOptions extends PortableSkillOptions {
  /** Explicit skill names to pull. Ignored when `all` is set. */
  names?: string[];
  /** Pull every skill the instance serves. */
  all?: boolean;
  /**
   * Client override. `undefined` (the default) resolves one from configuration;
   * `null` models "no credential available" so the null-handling path stays testable.
   */
  client?: SkillPullClient | null;
}

export interface PulledSkillResult {
  name: string;
  success: boolean;
  path?: string;
  kind?: SkillKind;
  version?: string;
  /** True when the pull created the corpus entry, false when it updated an existing one. */
  created?: boolean;
  error?: string;
}

export interface PullSkillsResult {
  results: PulledSkillResult[];
}

export class PullSkillError extends Error {
  constructor(message: string, readonly detail?: string[]) {
    super(message);
    this.name = "PullSkillError";
  }
}

export async function pullSkills(options: PullSkillsOptions = {}): Promise<PullSkillsResult> {
  // createRemoteSkillsClient() returns null when no API key is present, and throws
  // MissingApiUrlError when a key exists but no origin does — so the fail-closed
  // behaviour is inherited here rather than re-implemented.
  const client = options.client !== undefined ? options.client : createRemoteSkillsClient();
  if (!client) {
    throw new PullSkillError(
      "No API key configured, so there is no instance to pull from.",
      ["Run `skills login`, or set SKILLS_API_KEY and SKILLS_API_URL for this instance."],
    );
  }

  const targets = await resolveTargetSlugs(client, options);
  const corpusOptions = pickCorpusOptions(options);
  const results: PulledSkillResult[] = [];
  for (const name of targets) {
    results.push(await pullOne(client, name, corpusOptions));
  }
  return { results };
}

async function resolveTargetSlugs(client: SkillPullClient, options: PullSkillsOptions): Promise<string[]> {
  if (options.all) {
    const listed = await client.listSkills();
    return dedupe(listed.map(extractSlug).filter((slug): slug is string => Boolean(slug)));
  }
  const explicit = dedupe((options.names ?? []).map((name) => name.trim()).filter(Boolean));
  if (!explicit.length) {
    throw new PullSkillError(
      "Nothing to pull: name at least one skill, or pass --all to pull every skill the instance serves.",
    );
  }
  return explicit;
}

async function pullOne(
  client: SkillPullClient,
  rawName: string,
  corpusOptions: PortableSkillOptions,
): Promise<PulledSkillResult> {
  let slug: string;
  try {
    slug = normalizePortableSkillName(rawName);
  } catch (error) {
    return { name: rawName, success: false, error: (error as Error).message };
  }

  let skillMd: string | null;
  try {
    skillMd = await client.getSkillMd(slug);
  } catch (error) {
    return { name: slug, success: false, error: `Failed to fetch '${slug}': ${(error as Error).message}` };
  }
  if (skillMd === null) {
    return { name: slug, success: false, error: `Skill '${slug}' was not found on the configured Skills instance.` };
  }

  const meta = await safeMeta(client, slug);
  const written = writeCorpusSkill({ name: slug, skillMd, meta }, corpusOptions);
  return {
    name: slug,
    success: true,
    path: written.path,
    kind: written.manifest.kind,
    version: written.manifest.version,
    created: written.created,
  };
}

/**
 * Best-effort metadata. The SKILL.md carries its own frontmatter, so a missing or
 * malformed detail payload degrades to "use the frontmatter" rather than failing the pull.
 */
async function safeMeta(client: SkillPullClient, slug: string): Promise<CorpusSkillMeta | null> {
  let raw: unknown;
  try {
    raw = await client.getSkill(slug);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const kind = record.kind === "instruction" || record.kind === "executable" ? record.kind : undefined;
  const tags = Array.isArray(record.tags)
    ? record.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : undefined;
  return {
    ...(str(record.displayName) ? { displayName: str(record.displayName) } : {}),
    ...(str(record.description) ? { description: str(record.description) } : {}),
    ...(str(record.category) ? { category: str(record.category) } : {}),
    ...(tags && tags.length ? { tags } : {}),
    ...(str(record.version) ? { version: str(record.version) } : {}),
    ...(kind ? { kind } : {}),
  };
}

function pickCorpusOptions(options: PullSkillsOptions): PortableSkillOptions {
  const out: PortableSkillOptions = {};
  if (options.rootDir) out.rootDir = options.rootDir;
  if (options.homeDir) out.homeDir = options.homeDir;
  return out;
}

function extractSlug(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const record = entry as Record<string, unknown>;
  return str(record.slug) ?? str(record.name);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
