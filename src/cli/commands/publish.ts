/**
 * `skills push` - send a skill from this machine's corpus to the configured instance.
 *
 * The corpus is ~/.hasna/skills/installed/<name>/ (getPortableSkillsRoot()). Nothing here
 * writes into an agent's directory or otherwise decides how a skill reaches an agent once
 * it is on a machine: this command's job ends when the server has the bytes.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";

import chalk from "chalk";
import type { Command } from "commander";

import {
  findPortableSkill,
  readPortableSkillManifest,
  validatePortableSkillDirectory,
} from "../../lib/portable-skills.js";
import { RemoteSkillsClient, createRemoteSkillsClient } from "../../lib/remote-client.js";
import { packSkillBundle, type PackedSkillBundle } from "../../lib/skill-bundle.js";

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
  client?: RemoteSkillsClient | null;
  /** Overrides the corpus location. Tests only. */
  rootDir?: string;
}

export interface PushSkillResult {
  slug: string;
  path: string;
  sha256: string;
  fileCount: number;
  bundleByteSize: number;
  unpackedByteSize: number;
  paths: string[];
  published: boolean;
  status?: number;
  response?: unknown;
}

export class PushSkillError extends Error {
  constructor(message: string, readonly detail?: string[]) {
    super(message);
  }
}

export function registerPublish(parent: Command) {
  parent
    .command("push")
    .argument("<name>", "Name of a skill in ~/.hasna/skills/installed")
    .option("--version <version>", "Override the version recorded on the instance")
    .option("--dry-run", "Pack and validate without uploading", false)
    .option("--json", "Output result as JSON", false)
    .description("Publish a local skill to the configured skills instance")
    .action(async (name: string, options: { version?: string; dryRun: boolean; json: boolean }) => {
      try {
        const result = await pushSkill(name, {
          dryRun: options.dryRun,
          json: options.json,
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
      validation.issues.map((issue) => `${issue.code}: ${issue.message}`),
    );
  }

  const manifest = readPortableSkillManifest(skill.path, skill.name);
  const packed = packSkillBundle(skill.path, { maxUnpackedBytes: MAX_UNPACKED_BYTES });
  const skillMdPath = join(skill.path, "SKILL.md");
  const skillMd = existsSync(skillMdPath) ? readFileSync(skillMdPath, "utf-8") : undefined;

  const base: PushSkillResult = {
    slug: skill.name,
    path: skill.path,
    sha256: packed.sha256,
    fileCount: packed.fileCount,
    bundleByteSize: packed.bytes.byteLength,
    unpackedByteSize: packed.unpackedByteSize,
    paths: packed.paths,
    published: false,
  };

  if (options.dryRun) return base;

  const client = options.client !== undefined ? options.client : createRemoteSkillsClient();
  if (!client) {
    throw new PushSkillError(
      "No API key configured, so there is nowhere to publish to.",
      ["Run `skills login`, or set SKILLS_API_KEY and SKILLS_API_URL for this instance."],
    );
  }

  const response = await client.publishSkill(
    {
      slug: skill.name,
      displayName: manifest.displayName ?? skill.displayName,
      description: manifest.description,
      category: manifest.category ?? "Development Tools",
      tags: manifest.tags ?? [],
      kind: manifest.kind ?? "executable",
      version: options.version ?? manifest.version,
      source: "custom",
      // Declared so the server can reject a body that did not arrive intact, rather than
      // storing a truncated tarball under a digest computed from the truncation.
      bundleSha256: packed.sha256,
      ...(skillMd ? { skillMd } : {}),
    },
    packed.bytes,
  );

  const payload = await readBody(response);
  if (!response.ok) {
    throw new PushSkillError(
      `Publishing '${skill.name}' failed: ${response.status} ${describeError(payload)}`,
      typeof payload === "object" && payload && "code" in payload ? [`code: ${String((payload as { code: unknown }).code)}`] : undefined,
    );
  }

  return { ...base, published: true, status: response.status, response: payload };
}

function printHuman(result: PushSkillResult): void {
  if (!result.published) {
    console.log(chalk.bold(`\nDry run: '${result.slug}' would be published\n`));
  } else {
    console.log(chalk.green(`\n✓ Published '${result.slug}'\n`));
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
