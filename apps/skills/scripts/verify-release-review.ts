#!/usr/bin/env bun
/**
 * Fail-closed preflight for an @hasna/skills npm release.
 *
 * The release workflow runs this BEFORE it is allowed to publish:
 *
 *   bun run verify:release-review
 *
 * It refuses unless the annotated release tag names the independent reviewer,
 * the git-publishing release intent thread, the git-prs GO for this candidate,
 * and the SHA-256 of the tarball
 * this checkout packs equals the `Packed-SHA256` recorded in that tag. There is
 * no fallback and no environment switch: a missing, duplicated, malformed or
 * mismatched field exits non-zero, and the workflow's publish step is gated on
 * this step succeeding.
 *
 * Usage (from apps/skills, inside the exact release checkout):
 *   bun run scripts/verify-release-review.ts [--tag <npm/skills/vX.Y.Z>]
 *                                            [--release-commit <sha>]
 *                                            [--pack-destination <dir>]
 *
 * The tag defaults to GITHUB_REF_NAME and the release commit to HEAD. The
 * `--pack-destination` override only selects where the audit tarball is written;
 * it can never change the digest that is compared.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  SKILLS_RELEASE_MANIFEST_PATH,
  SKILLS_RELEASE_PACKAGE_PATH,
  parseReleaseReviewLinkage,
  validateReleaseReviewLinkage,
  type ReleaseReviewLinkageFailure,
} from "../src/lib/release-review-linkage.js";

type ReleaseManifest = {
  name?: string;
  version?: string;
  publishConfig?: { registry?: string; access?: string };
  repository?: { url?: string; directory?: string };
};

const PACK_TARBALL_BASENAME = "hasna-skills";

main();

function main(): void {
  const options = parseArguments(process.argv.slice(2));
  const root = repositoryRoot();
  const tag = options.tag ?? process.env["GITHUB_REF_NAME"] ?? "";
  if (!tag) {
    fail([{ check: "release-review-tag", message: "the release tag must be supplied with --tag or GITHUB_REF_NAME" }]);
  }
  const releaseCommit = options.releaseCommit ?? runGit(root, ["rev-parse", "HEAD"], "release-review-release-commit");
  if (runGit(root, ["rev-parse", "HEAD"], "release-review-checkout") !== releaseCommit) {
    fail([{ check: "release-review-checkout", message: "the current checkout must equal the exact release commit" }]);
  }

  const tagRef = `refs/tags/${tag}`;
  const tagType = runGit(root, ["cat-file", "-t", tagRef], "release-review-tag-type");
  const tagCommit = runGit(root, ["rev-parse", `${tagRef}^{commit}`], "release-review-tag-commit");
  const tagMessage = runGit(root, ["for-each-ref", "--format=%(contents)", tagRef], "release-review-tag-message", false);
  const ancestry = spawnSync("git", ["merge-base", "--is-ancestor", releaseCommit, "refs/remotes/origin/main"], {
    cwd: root,
    encoding: "utf8",
  });
  if (ancestry.status !== 0) {
    fail([{ check: "release-review-protected-main", message: "the release commit must be contained in protected main" }]);
  }

  const manifest = readManifest(root, releaseCommit);
  const linkage = {
    tagMessage,
    tag,
    tagType,
    tagCommit,
    releaseCommit,
    packageName: manifest.name ?? "",
    packageVersion: manifest.version ?? "",
    repositoryUrl: manifest.repository?.url,
    repositoryDirectory: manifest.repository?.directory,
    registry: manifest.publishConfig?.registry,
    access: manifest.publishConfig?.access,
  };

  // Candidate identity first, so a lightweight or mis-targeted tag is named
  // plainly instead of being reported as a tag message with no linkage fields.
  const identity: ReleaseReviewLinkageFailure[] = [];
  if (tagType !== "tag") {
    identity.push({ check: "release-review-tag-type", message: "the release tag must be an annotated tag object" });
  }
  if (tagCommit !== releaseCommit) {
    identity.push({ check: "release-review-tag-commit", message: "the annotated release tag must target the exact release commit" });
  }
  if (identity.length > 0) fail(identity);

  // The tag fields are read and validated BEFORE any npm operation: a missing or
  // malformed linkage field never reaches a pack.
  const structural = parseReleaseReviewLinkage(tagMessage);
  if (structural.failures.length > 0) fail(structural.failures);

  const packed = packRelease(join(root, SKILLS_RELEASE_PACKAGE_PATH), options.packDestination, manifest.version ?? "");
  if (packed.failures.length > 0) fail(packed.failures);

  const complete = validateReleaseReviewLinkage({ ...linkage, packedSha256: packed.sha256 });
  if (complete.length > 0) fail(complete);

  console.log(JSON.stringify({
    schema: "hasna.skills.release-review-linkage.v1",
    tag,
    release_commit: releaseCommit,
    package: `${manifest.name}@${manifest.version}`,
    package_path: SKILLS_RELEASE_PACKAGE_PATH,
    reviewer_agent: structural.linkage.reviewerAgent,
    git_publishing_thread: structural.linkage.goThreadId,
    git_prs_go: structural.linkage.goMessageId,
    packed_filename: packed.filename,
    packed_sha256: packed.sha256,
    packed_integrity: packed.integrity,
  }));
  console.log("Independent release review linkage gate passed.");
}

function readManifest(root: string, releaseCommit: string): ReleaseManifest {
  const result = spawnSync("git", ["show", `${releaseCommit}:${SKILLS_RELEASE_MANIFEST_PATH}`], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    fail([{ check: "release-review-manifest", message: `${SKILLS_RELEASE_MANIFEST_PATH} must exist at the release commit` }]);
  }
  try {
    return JSON.parse(result.stdout) as ReleaseManifest;
  } catch {
    fail([{ check: "release-review-manifest", message: `${SKILLS_RELEASE_MANIFEST_PATH} at the release commit must be valid JSON` }]);
  }
}

function packRelease(
  packageDirectory: string,
  requestedDestination: string | undefined,
  version: string,
): { sha256?: string; integrity?: string; filename?: string; failures: ReleaseReviewLinkageFailure[] } {
  let destination = requestedDestination;
  let createdDestination: string | undefined;
  if (!destination) {
    createdDestination = mkdtempSync(join(tmpdir(), "skills-release-review-"));
    destination = createdDestination;
  }
  try {
    const result = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination], {
      cwd: packageDirectory,
      encoding: "utf8",
      env: process.env,
    });
    if (result.error) {
      return { failures: [{ check: "release-review-pack", message: `npm pack could not run: ${result.error.message}` }] };
    }
    if (result.status !== 0) {
      return { failures: [{ check: "release-review-pack", message: "npm pack failed in the release checkout" }] };
    }
    let entries: Array<{ filename?: string }>;
    try {
      entries = JSON.parse(result.stdout.trim()) as Array<{ filename?: string }>;
    } catch {
      return { failures: [{ check: "release-review-pack", message: "npm pack did not emit a parsable JSON manifest" }] };
    }
    if (!Array.isArray(entries) || entries.length !== 1 || typeof entries[0]?.filename !== "string") {
      return { failures: [{ check: "release-review-pack", message: "npm pack must report exactly one release tarball" }] };
    }
    const filename = entries[0]!.filename!;
    if (version && filename !== `${PACK_TARBALL_BASENAME}-${version}.tgz`) {
      return { failures: [{ check: "release-review-pack", message: `npm pack must produce ${PACK_TARBALL_BASENAME}-${version}.tgz` }] };
    }
    const archive = readFileSync(join(destination, filename));
    const sha256 = createHash("sha256").update(archive).digest("hex");
    const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
    return { sha256, integrity, filename, failures: [] };
  } finally {
    if (createdDestination) rmSync(createdDestination, { recursive: true, force: true });
  }
}

function parseArguments(argv: string[]): { tag?: string; releaseCommit?: string; packDestination?: string } {
  const options: { tag?: string; releaseCommit?: string; packDestination?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--help" || argument === "-h") {
      console.log("usage: bun run scripts/verify-release-review.ts [--tag <tag>] [--release-commit <sha>] [--pack-destination <dir>]");
      process.exit(0);
    }
    const separator = argument.indexOf("=");
    const name = separator === -1 ? argument : argument.slice(0, separator);
    const value = separator === -1 ? argv[index + 1] : argument.slice(separator + 1);
    if (value === undefined || value.startsWith("--")) {
      fail([{ check: "release-review-arguments", message: `${name} requires a value` }]);
    }
    if (separator === -1) index += 1;
    if (name === "--tag") options.tag = value;
    else if (name === "--release-commit") options.releaseCommit = value;
    else if (name === "--pack-destination") options.packDestination = value;
    else fail([{ check: "release-review-arguments", message: `unrecognised argument ${name}` }]);
  }
  return options;
}

function runGit(root: string, args: string[], check: string, trim = true): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    fail([{ check, message: result.stderr.trim() || `git ${args[0]} failed` }]);
  }
  return trim ? result.stdout.trim() : result.stdout;
}

function repositoryRoot(): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd(), encoding: "utf8" });
  if (result.status !== 0) {
    fail([{ check: "release-review-repository-root", message: "the preflight must run inside the release git checkout" }]);
  }
  const root = result.stdout.trim();
  let manifest: ReleaseManifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, SKILLS_RELEASE_MANIFEST_PATH), "utf8")) as ReleaseManifest;
  } catch {
    fail([{ check: "release-review-repository-root", message: `the checkout root has no readable ${SKILLS_RELEASE_MANIFEST_PATH}` }]);
  }
  if (manifest.name !== "@hasna/skills") {
    fail([{ check: "release-review-repository-root", message: `the checkout root does not contain ${SKILLS_RELEASE_PACKAGE_PATH}` }]);
  }
  return root;
}

function fail(problems: ReleaseReviewLinkageFailure[]): never {
  console.error("Independent release review linkage gate failed:");
  for (const problem of problems) console.error(`- ${problem.check}: ${problem.message}`);
  process.exit(1);
}
