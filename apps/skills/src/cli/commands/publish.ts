/**
 * `skills push` - send a skill from this machine's corpus to the configured instance.
 *
 * The corpus is the canonical local root — <app folder>/installed/<name>/ before
 * the owner-layout migration, <app folder>/skills/<name>/ after it
 * (getPortableSkillsRoot()). Nothing here writes into an agent's directory or
 * otherwise decides how a skill reaches an agent once it is on a machine: this
 * command's job ends when the server has the bytes.
 */
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { hostname } from "os";
import { join } from "path";

import chalk from "chalk";
import type { Command } from "commander";

import {
  findPortableSkill,
  readDeclaredSkillVersion,
  readPortableSkillManifest,
  validatePortableSkillDirectory,
} from "../../lib/portable-skills.js";
import { RemoteSkillsClient, createRemoteSkillsClient } from "../../lib/remote-client.js";
import { RemoteSkillsPermissionError } from "../../lib/remote-permissions.js";
import pkg from "../../../package.json" with { type: "json" };
import { collectSkillBundleEntries, packSkillBundle, sha256Hex, type PackedSkillBundle, unpackSkillBundle } from "../../lib/skill-bundle.js";
import { verifyContentHashFromEntries } from "../../lib/skill-hash.js";

/**
 * Client-side ceiling on the *unpacked* sources.
 *
 * Checked before compressing, and expressed in unpacked bytes rather than in the size of
 * the upload, because a 200 MB node_modules that gzips to 20 MB is a mistake the author
 * wants to hear about now and not a legitimate skill that happens to compress well. The
 * server has its own limit on the compressed body (config.skillBundleLimitBytes); this one
 * exists to fail on the machine where the problem can actually be fixed.
 */
const MAX_UNPACKED_BYTES = 50_000_000;

export interface PushSkillOptions {
  dryRun?: boolean;
  json?: boolean;
  version?: string;
  /**
   * When the instance already holds this name@version with different content, publish under
   * the next patch version instead of failing (hasna/apps#1630).
   */
  forceNewVersion?: boolean;
  client?: RemoteSkillsClient | null;
  /** Overrides the corpus location. Tests only. */
  rootDir?: string;
}

export interface PushSkillResult {
  slug: string;
  path: string;
  sha256: string;
  /** Canonical content hash — identical to sha256; named for parity with the bundle manifests. */
  contentHash: string;
  fileCount: number;
  bundleByteSize: number;
  unpackedByteSize: number;
  paths: string[];
  published: boolean;
  status?: number;
  response?: unknown;
  /** The version the instance recorded (after any --force-new-version bump). */
  version?: string;
  /**
   * True when the publish was idempotent: the version this push ended on already
   * existed on the instance with these exact bytes, so nothing new was recorded
   * (hasna/apps#1671). Distinct from a fresh "published as X".
   */
  alreadyPublished?: boolean;
  /** Per-file digests and provenance sent alongside the bundle. */
  manifest?: SkillVersionManifest;
}

export class PushSkillError extends Error {
  constructor(message: string, readonly detail?: string[]) {
    super(message);
  }
}

export function registerPublish(parent: Command) {
  parent
    .command("push")
    .argument("<name>", "Name of a skill in the local corpus (~/.hasna/skills/installed or the migrated ~/.hasna/skills/skills)")
    .option("--version <version>", "Override the version recorded on the instance")
    .option("--force-new-version", "If name@version already exists with different content, publish as the next patch version", false)
    .option("--dry-run", "Pack and validate without uploading", false)
    .option("--json", "Output result as JSON", false)
    .description("Publish a local skill to the configured skills instance")
    .action(async (name: string, options: { version?: string; forceNewVersion: boolean; dryRun: boolean; json: boolean }) => {
      try {
        const result = await pushSkill(name, {
          dryRun: options.dryRun,
          json: options.json,
          forceNewVersion: options.forceNewVersion,
          ...(options.version ? { version: options.version } : {}),
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        printHuman(result);
      } catch (error) {
        if (options.json) {
          console.log(JSON.stringify({
            error: (error as Error).message,
            ...(error instanceof RemoteSkillsPermissionError ? { code: error.code, status: error.status, permission: error.permission } : {}),
            ...(error instanceof PushSkillError && error.detail ? { detail: error.detail } : {}),
          }, null, 2));
        } else {
          console.error(chalk.red((error as Error).message));
          if (error instanceof PushSkillError) for (const line of error.detail ?? []) console.error(chalk.dim(`  - ${line}`));
        }
        process.exitCode = 1;
      }
    });
}

export async function pushSkill(name: string, options: PushSkillOptions = {}): Promise<PushSkillResult> {
  const skill = findPortableSkill(name, options.rootDir ? { rootDir: options.rootDir } : {});
  if (!skill) {
    throw new PushSkillError(
      `Skill '${name}' not found in the local corpus.`,
      ["Create one with `skills new <name>`, or import an existing folder with `skills port <path>`."],
    );
  }

  // Validate before packing, not after uploading. A skill that fails validation is one
  // the server would happily store and every machine would then pull: the cheapest place
  // to stop it is the machine that wrote it.
  const validation = validatePortableSkillDirectory(skill.name, skill.path);
  if (!validation.valid) {
    throw new PushSkillError(
      `Skill '${skill.name}' is not valid and was not published.`,
      [
        ...validation.issues.map((issue) => `${issue.code}: ${issue.message}`),
        ...(validation.issues.some(issue => issue.code === "contract.content_hash_mismatch")
          ? [`Review the edited draft, then run skills prepare ${skill.name} --version <new-semver> (add --kind for a legacy kind-less manifest). Push never rewrites your source.`]
          : []),
      ],
    );
  }

  const manifest = readPortableSkillManifest(skill.path, skill.name);
  // A version is the identity of an immutable artefact (hasna/apps#1630): inventing
  // '0.1.0' for a skill that declares none would silently misversion every future pull
  // and every --force-new-version bump off that wrong base. Refuse instead, naming the
  // three places a version can be declared (skill.json, SKILL.md frontmatter,
  // package.json) and the --version flag that overrides all of them.
  const declaredVersion = options.version ?? readDeclaredSkillVersion(skill.path);
  if (!declaredVersion) {
    throw new PushSkillError(
      `Skill '${skill.name}' declares no version, so it was not published as an invented '0.1.0'.`,
      ["Declare a version in skill.json (or the SKILL.md frontmatter / package.json), or pass --version <version> to this push."],
    );
  }
  const packed = packSkillBundle(skill.path, { maxUnpackedBytes: MAX_UNPACKED_BYTES });
  await verifyPackedCanonicalHash(skill.name, packed);
  const versionManifest = buildVersionManifest(skill.path, packed);
  const skillMdPath = join(skill.path, "SKILL.md");
  const skillMd = existsSync(skillMdPath) ? readFileSync(skillMdPath, "utf-8") : undefined;

  const base: PushSkillResult = {
    slug: skill.name,
    path: skill.path,
    sha256: packed.sha256,
    contentHash: packed.sha256,
    fileCount: packed.fileCount,
    bundleByteSize: packed.bytes.byteLength,
    unpackedByteSize: packed.unpackedByteSize,
    paths: packed.paths,
    published: false,
    manifest: versionManifest,
  };

  if (options.dryRun) return base;

  const client = options.client !== undefined ? options.client : await createRemoteSkillsClient();
  if (!client) {
    throw new PushSkillError(
      "No API key configured, so there is nowhere to publish to.",
      ["Run `skills auth login`, or set HASNA_SKILLS_API_KEY (and HASNA_SKILLS_API_URL for your own instance)."],
    );
  }

  // Optimistic concurrency (todos d061fcda): read the revision this instance currently
  // serves for the slug, and name it in If-Match. A first publish (no remote row) needs
  // no guard; a re-push that races a newer remote revision is refused with 409 instead
  // of silently overwriting it.
  const ifMatch = await readPublishRevision(client, skill.name);
  let version = options.version ?? manifest.version;
  let response = await publishOnce(client, skill, manifest, packed, skillMd, versionManifest, version, ifMatch);
  let payload = await readBody(response);
  // Immutable versions (hasna/apps#1630): the instance refuses to overwrite name@version with
  // different content. With --force-new-version we retry once under the next patch version;
  // without it we say what to do instead of guessing.
  if (response.status === 409 && codeOf(payload) === "SKILL_VERSION_EXISTS") {
    if (!options.forceNewVersion) {
      throw new PushSkillError(
        `Publishing '${skill.name}@${version}' failed: that version already exists on the instance with different content.`,
        [
          "code: SKILL_VERSION_EXISTS",
          `Bump the version in skill.json, pass --version <new>, or use --force-new-version to publish as ${bumpPatch(version)}.`,
        ],
      );
    }
    version = bumpPatch(version);
    response = await publishOnce(client, skill, manifest, packed, skillMd, versionManifest, version, ifMatch);
    payload = await readBody(response);
    // Even the bumped version can be taken (a concurrent push won the race): say so
    // instead of falling into the generic revision-conflict message.
    if (response.status === 409 && codeOf(payload) === "SKILL_VERSION_EXISTS") {
      throw new PushSkillError(
        `Publishing '${skill.name}@${version}' failed: even the bumped version already exists on the instance with different content.`,
        ["code: SKILL_VERSION_EXISTS", "Pick an explicit --version <new> that is free, and push again."],
      );
    }
  }
  if (!response.ok) {
    const code = codeOf(payload);
    if (response.status === 409 || code === "REVISION_CONFLICT") {
      throw new PushSkillError(
        `Publishing '${skill.name}' failed: the instance serves a NEWER revision of this skill. ` +
          "Your push would silently overwrite it, so it was refused.",
        [
          `code: REVISION_CONFLICT`,
          "Reconcile first: pull the current revision (skills pull <name>), merge your changes, then push again.",
        ],
      );
    }
    throw new PushSkillError(
      `Publishing '${skill.name}' failed: ${response.status} ${describeError(payload)}`,
      code ? [`code: ${code}`] : undefined,
    );
  }

  // The server answers every accepted publish 201; `alreadyPublished` inside the
  // payload is the server's word that the version already existed with these exact
  // bytes (idempotent re-push or an earlier --force-new-version run) — never report a
  // fresh publish that did not happen (hasna/apps#1671).
  const alreadyPublished = isAlreadyPublishedPayload(payload);
  return {
    ...base,
    published: true,
    status: response.status,
    response: payload,
    version,
    ...(alreadyPublished ? { alreadyPublished: true } : {}),
  };
}

/** Verify the hash declared by a portable manifest against the entries in the exact archive. */
async function verifyPackedCanonicalHash(name: string, packed: PackedSkillBundle): Promise<void> {
  const verification = await verifyContentHashFromEntries(unpackSkillBundle(packed.bytes));
  // SKILL.md-only legacy skills have no packed skill.json and therefore no canonical hash
  // declaration. Preserve their established push behavior while enforcing declared hashes.
  if (!verification.declared || verification.valid) return;
  throw new PushSkillError(
    `Skill '${name}' was not published because its packed archive does not match the declared canonical content hash.`,
    [
      `Declared canonical hash: ${verification.declaredHash ?? "missing"}`,
      `Packed archive entry hash: ${verification.computedHash ?? "unavailable"}`,
      "Repair the source and run skills prepare <name> --version <new-semver> before pushing again.",
    ],
  );
}

/** Absence or an exact usable revision is required before any upload, including a bump. */
async function readPublishRevision(client: RemoteSkillsClient, slug: string): Promise<string | undefined> {
  let lookup: Awaited<ReturnType<RemoteSkillsClient["getSkillStatus"]>>;
  try {
    lookup = await client.getSkillStatus(slug);
  } catch {
    throw new PushSkillError(
      "Publishing was refused because the current skill revision could not be verified.",
      ["Check the configured instance and connection, then retry the push. No upload was attempted."],
    );
  }
  const body = lookup.body;
  const record = body !== null && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown> : undefined;
  const nestedError = record?.error;
  const code = typeof record?.code === "string" ? record.code
    : nestedError !== null && typeof nestedError === "object" && !Array.isArray(nestedError)
      ? (nestedError as Record<string, unknown>).code : undefined;
  if (lookup.status === 404 && code === "SKILL_NOT_FOUND") return undefined;
  if (lookup.status < 200 || lookup.status >= 300) {
    throw new PushSkillError(
      `Publishing was refused because the current skill lookup failed: HTTP ${lookup.status}.`,
      ["Only an explicit SKILL_NOT_FOUND response establishes an initial publish. Check access and server compatibility before retrying."],
    );
  }
  const revision = record?.revisionId;
  if (record?.publicationState === "catalogue-only") {
    if (record.name === slug && (record.slug === undefined || record.slug === slug) && revision === null) return undefined;
    throw new PushSkillError(
      "Publishing was refused because the catalogue-only response had contradictory identity or revision state.",
      ["Check the configured instance and server compatibility. No upload was attempted."],
    );
  }
  // Do not trim, coerce or silently omit an unusable precondition. HTTP field
  // values must be safe bytes; this opaque revision is sent exactly as observed.
  if (record?.slug !== slug || typeof revision !== "string" || revision.length === 0
    || revision !== revision.trim() || !/^[\x21-\x7e]+$/.test(revision)) {
    throw new PushSkillError(
      "Publishing was refused because the current skill response did not contain a matching slug and valid revision.",
      ["Check the configured instance and server compatibility. No upload was attempted."],
    );
  }
  return revision;
}

async function publishOnce(
  client: RemoteSkillsClient,
  skill: { name: string; displayName: string },
  manifest: ReturnType<typeof readPortableSkillManifest>,
  packed: PackedSkillBundle,
  skillMd: string | undefined,
  versionManifest: SkillVersionManifest,
  version: string,
  ifMatch: string | undefined,
): Promise<Response> {
  return client.publishSkill(
    {
      slug: skill.name,
      displayName: manifest.displayName ?? skill.displayName,
      description: manifest.description,
      category: manifest.category ?? "Development Tools",
      tags: manifest.tags ?? [],
      kind: manifest.kind ?? "instruction",
      version,
      source: "custom",
      bundleSha256: packed.sha256,
      contentHash: packed.sha256,
      versionManifest: { ...versionManifest, version },
      ...(skillMd ? { skillMd } : {}),
    },
    packed.bytes,
    ifMatch,
  );
}

function codeOf(payload: unknown): string | undefined {
  return typeof payload === "object" && payload && "code" in payload ? String((payload as { code: unknown }).code) : undefined;
}

/** The server's word that the version already existed with the same digest. */
function isAlreadyPublishedPayload(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && (payload as { alreadyPublished?: unknown }).alreadyPublished === true;
}

/** 1.2.3 -> 1.2.4; anything non-semver gets a numeric suffix so the bump is still unique. */
export function bumpPatch(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(version);
  if (!match) return `${version}.1`;
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

export interface SkillVersionManifest {
  files: Array<{ path: string; sha256: string; byteSize: number }>;
  fileCount: number;
  unpackedByteSize: number;
  bundleSha256: string;
  provenance: {
    machine: string;
    agent: string | null;
    cliVersion: string;
    gitRemote: string | null;
    gitSha: string | null;
    packedAt: string;
  };
}

/**
 * What travels beside the bundle as manifest.json (hasna/apps#1630): a digest per file so a
 * pull can be checked file by file, and where the bytes came from. No secrets, no absolute
 * paths beyond the machine name.
 */
export function buildVersionManifest(skillDir: string, packed: PackedSkillBundle): SkillVersionManifest {
  // Already in the bundle's own (codepoint) order, so manifest and archive list files identically.
  const entries = collectSkillBundleEntries(skillDir);
  return {
    files: entries.map((entry) => ({ path: entry.path, sha256: sha256Hex(entry.bytes), byteSize: entry.bytes.byteLength })),
    fileCount: packed.fileCount,
    unpackedByteSize: packed.unpackedByteSize,
    bundleSha256: packed.sha256,
    provenance: {
      machine: hostname(),
      agent: process.env.SKILLS_AGENT_ID ?? process.env.HASNA_AGENT_ID ?? process.env.AGENT_ID ?? null,
      cliVersion: pkg.version,
      // A remote configured with embedded credentials (https://user:token@host/...) must
      // never carry them into manifest.json in the bucket (hasna/apps#1671): strip
      // userinfo before recording. The scp-style `git@host:path` user is the transport
      // user, not a credential, and is left alone.
      gitRemote: sanitizeGitRemote(gitValue(skillDir, ["remote", "get-url", "origin"])),
      gitSha: gitValue(skillDir, ["rev-parse", "HEAD"]),
      packedAt: new Date().toISOString(),
    },
  };
}

/**
 * Strip userinfo (username/password) from a git remote URL before it is recorded in a
 * version manifest. Only URL schemes where userinfo is HTTP-style credentials are
 * stripped: an ssh login user (`ssh://git@host/...`, or scp-style `git@host:path`,
 * which never parses as a URL) is the transport user, not an embedded credential, and
 * passes through unchanged.
 */
export function sanitizeGitRemote(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password) return url;
    if (parsed.protocol === "ssh:") return url;
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function gitValue(dir: string, args: string[]): string | null {
  try {
    const out = execFileSync("git", ["-C", dir, ...args], { stdio: ["ignore", "pipe", "ignore"], encoding: "utf-8" }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function printHuman(result: PushSkillResult): void {
  if (!result.published) {
    console.log(chalk.bold(`\nDry run: '${result.slug}' would be published\n`));
  } else if (result.alreadyPublished) {
    // An idempotent publish: the version already existed with these exact bytes, so no
    // new artefact was recorded — report the no-op as a no-op, never as a fresh
    // publish (a second --force-new-version run bumps to a version that already exists).
    console.log(chalk.green(`\n✓ '${result.slug}@${result.version}' was already published — no new version created\n`));
  } else {
    console.log(chalk.green(`\n✓ Published '${result.slug}'${result.version ? ` as ${result.version}` : ""}\n`));
  }
  console.log(`  ${chalk.dim("source")}    ${result.path}`);
  console.log(`  ${chalk.dim("files")}     ${result.fileCount}`);
  console.log(`  ${chalk.dim("bundle")}    ${formatBytes(result.bundleByteSize)} (${formatBytes(result.unpackedByteSize)} unpacked)`);
  console.log(`  ${chalk.dim("sha256")}    ${result.sha256}`);
  if (!result.published) {
    console.log(chalk.dim(`\n  ${result.paths.length} file(s):`));
    for (const path of result.paths.slice(0, 40)) console.log(chalk.dim(`    ${path}`));
    if (result.paths.length > 40) console.log(chalk.dim(`    ... and ${result.paths.length - 40} more`));
  }
  console.log("");
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function describeError(payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload) return String((payload as { error: unknown }).error);
  if (typeof payload === "string") return payload.slice(0, 200);
  return "no detail returned";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type { PackedSkillBundle };
