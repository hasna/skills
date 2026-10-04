import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

/**
 * The release workflow's only publish gate is the real script, so this test runs
 * the real script — not a reimplementation of its rules — against a synthetic
 * release repository. Every case here is a refusal the gate must produce:
 * a missing linkage field, a digest that does not match the packed tarball, a tag
 * whose version is not the manifest's version, and a lightweight (unannotated)
 * tag. The positive case proves the same script accepts a fully linked candidate,
 * so the negatives cannot be passing for the wrong reason.
 */

const fixture = mkdtempSync(join(tmpdir(), "skills-release-review-"));
const repository = join(fixture, "repo");
const packageDirectory = join(repository, "apps/skills");
const home = join(fixture, "home");
const tag = "npm/skills/v0.10.7";
const reviewer = "review-agent-skills";
const goThread = "799711";
const goMessage = "800744";

afterAll(() => rmSync(fixture, { recursive: true, force: true }));

const source = resolve(import.meta.dir, "../..");
mkdirSync(join(packageDirectory, "scripts"), { recursive: true });
mkdirSync(join(packageDirectory, "src/lib"), { recursive: true });
mkdirSync(join(packageDirectory, "dist"), { recursive: true });
mkdirSync(join(home, "tmp"), { recursive: true });
cpSync(join(source, "scripts/verify-release-review.ts"), join(packageDirectory, "scripts/verify-release-review.ts"));
cpSync(join(source, "src/lib/release-review-linkage.ts"), join(packageDirectory, "src/lib/release-review-linkage.ts"));
writeFileSync(join(packageDirectory, "dist/index.js"), "export const packed = true;\n");
writeFileSync(join(packageDirectory, "package.json"), `${JSON.stringify({
  name: "@hasna/skills",
  version: "0.10.7",
  files: ["dist/", "src/", "scripts/"],
  publishConfig: { registry: "https://registry.npmjs.org", access: "public" },
  repository: { type: "git", url: "https://github.com/hasna/skills.git", directory: "apps/skills" },
}, null, 2)}\n`);

const gitEnvironment = {
  ...process.env,
  GIT_AUTHOR_NAME: "Synthetic fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.test",
  GIT_COMMITTER_NAME: "Synthetic fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.test",
};
function git(...args: string[]): string {
  const result = spawnSync("git", args, { cwd: repository, env: gitEnvironment, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`synthetic git ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}
git("init", "--quiet");
git("add", ".");
git("commit", "--quiet", "--no-gpg-sign", "-m", "Synthetic @hasna/skills release candidate");
const releaseCommit = git("rev-parse", "HEAD");
git("update-ref", "refs/remotes/origin/main", releaseCommit);

/** Keep the fixture hermetic: no ambient npm config, cache or credentials. */
function spawnEnvironment(): NodeJS.ProcessEnv {
  const { GITHUB_REF_NAME: _refName, ...parent } = process.env;
  return {
    ...parent,
    HOME: home,
    TMPDIR: join(home, "tmp"),
    npm_config_cache: join(home, ".npm"),
    npm_config_ignore_scripts: "true",
    npm_config_dry_run: "false",
  };
}

/** The digest the release toolchain produces for this candidate. */
function packedDigests(): { sha256: string; integrity: string } {
  const destination = mkdtempSync(join(home, "tmp/pack-"));
  const result = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination], {
    cwd: packageDirectory,
    env: spawnEnvironment(),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`synthetic npm pack failed: ${result.stderr}`);
  const [entry] = JSON.parse(result.stdout.trim()) as Array<{ filename: string }>;
  const archive = readFileSync(join(destination, entry!.filename));
  return {
    sha256: createHash("sha256").update(archive).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
  };
}

function releaseTagMessage(sha256: string, options: { withDigest?: boolean; reviewerAgent?: string } = {}): string {
  return [
    "@hasna/skills 0.10.7",
    "",
    `Release-Review-Agent: ${options.reviewerAgent ?? reviewer}`,
    `Git-Publishing-Thread: ${goThread}`,
    `Git-Prs-GO: ${goMessage}`,
    ...(options.withDigest === false ? [] : [`Packed-SHA256: ${sha256}`]),
    "",
  ].join("\n");
}

function annotate(name: string, message: string): void {
  git("tag", "--force", "--annotate", name, "--message", message, releaseCommit);
}

function verify(name = tag, destination?: string) {
  return spawnSync(process.execPath, [join(packageDirectory, "scripts/verify-release-review.ts"), "--tag", name,
    ...(destination ? ["--pack-destination", destination] : [])], {
    cwd: packageDirectory,
    env: spawnEnvironment(),
    encoding: "utf8",
  });
}

const { sha256: expectedSha256, integrity: expectedIntegrity } = packedDigests();

describe("skills release review preflight against a real checkout", () => {
  test("an explicit destination retains the exact reviewed archive for the installed consumer and publisher", () => {
    annotate(tag, releaseTagMessage(expectedSha256));
    const destination = mkdtempSync(join(home, "tmp/retained-"));
    const result = verify(tag, destination);
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    const summary = JSON.parse(result.stdout.trim().split("\n")[0]!);
    const retained = readFileSync(join(destination, summary.packed_filename));
    expect(createHash("sha256").update(retained).digest("hex")).toBe(summary.packed_sha256);
    expect(`sha512-${createHash("sha512").update(retained).digest("base64")}`).toBe(summary.packed_integrity);
  });
  test("a fully linked annotated tag is accepted and reports the bound digest", () => {
    annotate(tag, releaseTagMessage(expectedSha256));
    const result = verify();
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    const summary = JSON.parse(result.stdout.trim().split("\n")[0]!) as Record<string, string>;
    expect(summary["packed_sha256"]).toBe(expectedSha256);
    expect(summary["packed_integrity"]).toBe(expectedIntegrity);
    expect(summary["reviewer_agent"]).toBe(reviewer);
    expect(summary["git_publishing_thread"]).toBe(goThread);
    expect(summary["git_prs_go"]).toBe(goMessage);
    expect(summary["package"]).toBe("@hasna/skills@0.10.7");
  });

  test("a missing linkage field refuses the release before any pack runs", () => {
    annotate(tag, releaseTagMessage(expectedSha256, { withDigest: false }));
    const result = verify();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("release-review-linkage-packed-sha256");
    expect(result.stdout).toBe("");
  });

  test("a digest that does not match the packed tarball refuses the release", () => {
    annotate(tag, releaseTagMessage("c".repeat(64)));
    const result = verify();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("release-review-packed-sha256-mismatch");
  });

  test("a tag version that is not the manifest version refuses the release", () => {
    const wrongVersionTag = "npm/skills/v0.10.8";
    annotate(wrongVersionTag, releaseTagMessage(expectedSha256));
    const result = verify(wrongVersionTag);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("release-review-version");
  });

  test("a tag that is not an annotated tag is refused", () => {
    git("tag", "--delete", tag);
    git("tag", "--force", tag, releaseCommit);
    const result = verify();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("release-review-tag-type");
  });
});
