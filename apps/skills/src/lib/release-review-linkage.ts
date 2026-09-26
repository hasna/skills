/**
 * Release review linkage for @hasna/skills npm releases.
 *
 * WHY THIS EXISTS
 *
 * @hasna/skills 0.10.5 and 0.10.6 reached npm without the release authority's
 * required pre-upload linkage: an independent reviewer's GO in git-prs and the
 * git-publishing intent thread, bound to the exact candidate AND to the packed
 * tarball that was uploaded. A published version cannot be unpublished, so the only
 * place a release can refuse is BEFORE the upload.
 *
 * The binding lives in the annotated release tag message, which is created
 * before the tag is pushed and is covered by the same protected-main ancestry
 * the release workflow already requires:
 *
 *   @hasna/skills 0.10.7
 *
 *   <release notes>
 *
 *   Release-Review-Agent: <registered reviewer coding-agent identity>
 *   Git-Publishing-Thread: <release intent thread id>
 *   Git-Prs-GO: <message id of the independent GO in git-prs for this candidate>
 *   Packed-SHA256: <64 lowercase hex>
 *
 * "EXACTLY" is enforced, not implied: each of the four linkage keys must appear
 * exactly once, the linkage namespace is closed (a fifth Release-Review-* /
 * Git-Publishing-* / Git-Prs-* / Packed-* key is a failure, so a field can never be silently
 * swapped for a look-alike), values are strictly shaped, and the recorded
 * Packed-SHA256 must equal the SHA-256 of the tarball this checkout actually
 * packs. There is no fallback: a missing, duplicated, malformed or mismatched
 * field refuses the release.
 *
 * The reviewer's digest must be produced with the release toolchain at the exact
 * commit (see scripts/RELEASE.md): `npm pack --ignore-scripts` in apps/skills
 * after `bun run build`, hashed with SHA-256. A digest taken from a different
 * toolchain, a different commit or a differently-built tree does not match by
 * design, and the mismatch is the gate doing its job.
 *
 * This module is pure: git and npm I/O stay in scripts/verify-release-review.ts,
 * and the release workflow runs `bun run verify:release-review` before it is
 * allowed to publish.
 */

export const SKILLS_RELEASE_REPOSITORY = "hasna/skills";
export const SKILLS_RELEASE_REPOSITORY_URL = "https://github.com/hasna/skills.git";
export const SKILLS_RELEASE_PACKAGE_PATH = "apps/skills";
export const SKILLS_RELEASE_MANIFEST_PATH = "apps/skills/package.json";
export const SKILLS_RELEASE_PACKAGE_NAME = "@hasna/skills";
export const SKILLS_RELEASE_REGISTRY = "https://registry.npmjs.org";
export const SKILLS_RELEASE_TAG_PREFIX = "npm/skills/v";

/** Field names carried by the annotated release tag message, in required order. */
export const RELEASE_REVIEW_LINKAGE_FIELDS = {
  reviewerAgent: "Release-Review-Agent",
  goThreadId: "Git-Publishing-Thread",
  goMessageId: "Git-Prs-GO",
  packedSha256: "Packed-SHA256",
} as const;

export type ReleaseReviewLinkageFailure = {
  check: string;
  message: string;
};

export type ReleaseReviewLinkage = {
  /** The registered coding-agent identity that performed the independent review. */
  reviewerAgent: string;
  /** Release intent thread in the git-publishing lane. */
  goThreadId: string;
  /** Message id of the independent GO in git-prs bound to this exact candidate. */
  goMessageId: string;
  /** SHA-256 of the packed release tarball, lowercase hex. */
  packedSha256: string;
};

export type ReleaseReviewLinkageInput = {
  tagMessage: string;
  tag: string;
  /** `git cat-file -t refs/tags/<tag>`; must be `tag` for an annotated tag. */
  tagType: string;
  /** `git rev-parse refs/tags/<tag>^{commit}`. */
  tagCommit: string;
  /** The exact checkout being released. */
  releaseCommit: string;
  packageName: string;
  packageVersion: string;
  repositoryUrl: string | undefined;
  repositoryDirectory: string | undefined;
  registry: string | undefined;
  access: string | undefined;
  /** SHA-256 computed from the tarball this checkout packs, when packing ran. */
  packedSha256: string | undefined;
};

const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REFERENCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const LINKAGE_KEY = /^(?:Release-Review-[A-Za-z0-9-]+|Git-Publishing-[A-Za-z0-9-]+|Git-Prs-[A-Za-z0-9-]+|Packed-[A-Za-z0-9-]+):/;

const KNOWN_KEYS = new Set<string>(Object.values(RELEASE_REVIEW_LINKAGE_FIELDS));

/** Resolve the semver a release tag carries, or undefined for any other tag. */
export function parseSkillsReleaseTagVersion(tag: string): string | undefined {
  if (!tag.startsWith(SKILLS_RELEASE_TAG_PREFIX)) return undefined;
  const version = tag.slice(SKILLS_RELEASE_TAG_PREFIX.length);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) return undefined;
  return version;
}

/**
 * Parse the four linkage fields out of the annotated release tag message.
 * Prose (subject and release notes) is allowed; the linkage namespace is not.
 */
export function parseReleaseReviewLinkage(tagMessage: string): {
  linkage: Partial<ReleaseReviewLinkage>;
  failures: ReleaseReviewLinkageFailure[];
} {
  const failures: ReleaseReviewLinkageFailure[] = [];
  const linkage: Partial<ReleaseReviewLinkage> = {};
  const values = new Map<string, string[]>();

  for (const rawLine of tagMessage.replace(/\r\n?/g, "\n").split("\n")) {
    if (!LINKAGE_KEY.test(rawLine)) continue;
    const separator = rawLine.indexOf(":");
    const key = rawLine.slice(0, separator);
    const value = rawLine.slice(separator + 1).replace(/^ /, "");
    const existing = values.get(key);
    if (existing) existing.push(value);
    else values.set(key, [value]);
  }

  for (const [key, entries] of values) {
    if (!KNOWN_KEYS.has(key)) {
      failures.push({
        check: "release-review-linkage-unknown",
        message: `the annotated release tag message carries the unrecognised linkage field ${key}`,
      });
      continue;
    }
    if (entries.length > 1) {
      failures.push({
        check: "release-review-linkage-duplicate",
        message: `the annotated release tag message must carry ${key} exactly once`,
      });
    }
  }

  const readField = (key: string, check: string, pattern: RegExp, requirement: string): string | undefined => {
    const entries = values.get(key);
    if (!entries || entries.length !== 1) {
      failures.push({ check, message: `the annotated release tag message must carry exactly one ${key} field: ${requirement}` });
      return undefined;
    }
    const value = entries[0]!;
    if (!pattern.test(value)) {
      failures.push({ check, message: `${key} is malformed: ${requirement}` });
      return undefined;
    }
    return value;
  };

  linkage.reviewerAgent = readField(
    RELEASE_REVIEW_LINKAGE_FIELDS.reviewerAgent,
    "release-review-linkage-reviewer",
    AGENT_ID,
    "the registered coding-agent identity that performed the independent review",
  );
  linkage.goThreadId = readField(
    RELEASE_REVIEW_LINKAGE_FIELDS.goThreadId,
    "release-review-linkage-thread",
    REFERENCE_ID,
    "the git-publishing release intent thread id",
  );
  linkage.goMessageId = readField(
    RELEASE_REVIEW_LINKAGE_FIELDS.goMessageId,
    "release-review-linkage-go",
    REFERENCE_ID,
    "the message id of the independent git-prs GO for this exact candidate",
  );
  linkage.packedSha256 = readField(
    RELEASE_REVIEW_LINKAGE_FIELDS.packedSha256,
    "release-review-linkage-packed-sha256",
    SHA256_HEX,
    "the packed release tarball SHA-256 as 64 lowercase hex characters",
  );

  return { linkage, failures };
}

/**
 * The complete preflight: tagged candidate identity, package binding and the
 * packed digest recorded in the tag. Returns every failure it finds so one run
 * names all of them; any failure refuses the release.
 */
export function validateReleaseReviewLinkage(input: ReleaseReviewLinkageInput): ReleaseReviewLinkageFailure[] {
  const failures: ReleaseReviewLinkageFailure[] = [];
  const parsed = parseReleaseReviewLinkage(input.tagMessage);
  failures.push(...parsed.failures);
  const linkage = parsed.linkage;

  const tagVersion = parseSkillsReleaseTagVersion(input.tag);
  if (!tagVersion) {
    failures.push({
      check: "release-review-tag",
      message: `the release tag must use the ${SKILLS_RELEASE_TAG_PREFIX}<semver> form`,
    });
  }
  if (input.tagType !== "tag") {
    failures.push({
      check: "release-review-tag-type",
      message: "the release tag must be an annotated tag object",
    });
  }
  if (input.tagCommit !== input.releaseCommit) {
    failures.push({
      check: "release-review-tag-commit",
      message: "the annotated release tag must target the exact release commit",
    });
  }
  if (input.packageName !== SKILLS_RELEASE_PACKAGE_NAME) {
    failures.push({
      check: "release-review-package",
      message: `${SKILLS_RELEASE_MANIFEST_PATH} must declare ${SKILLS_RELEASE_PACKAGE_NAME}`,
    });
  }
  if (tagVersion !== undefined && input.packageVersion !== tagVersion) {
    failures.push({
      check: "release-review-version",
      message: `the release tag must carry ${SKILLS_RELEASE_MANIFEST_PATH} version ${input.packageVersion}`,
    });
  }
  if (input.releaseCommit !== (input.releaseCommit ?? "").trim() || !/^[0-9a-f]{40}$/.test(input.releaseCommit)) {
    failures.push({
      check: "release-review-release-commit",
      message: "the release commit must be the full 40-character commit SHA of this checkout",
    });
  }
  if (input.repositoryUrl !== SKILLS_RELEASE_REPOSITORY_URL || input.repositoryDirectory !== SKILLS_RELEASE_PACKAGE_PATH) {
    failures.push({
      check: "release-review-repository",
      message: `${SKILLS_RELEASE_MANIFEST_PATH} must declare the ${SKILLS_RELEASE_REPOSITORY} repository and the ${SKILLS_RELEASE_PACKAGE_PATH} directory`,
    });
  }
  if (input.registry !== SKILLS_RELEASE_REGISTRY) {
    failures.push({
      check: "release-review-registry",
      message: `${SKILLS_RELEASE_MANIFEST_PATH} must target the public npm registry`,
    });
  }
  if (input.access !== "public") {
    failures.push({
      check: "release-review-access",
      message: `${SKILLS_RELEASE_MANIFEST_PATH} must publish with public access`,
    });
  }
  if (!input.packedSha256) {
    failures.push({
      check: "release-review-pack",
      message: "this checkout must pack exactly one @hasna/skills release tarball to bind its digest",
    });
  } else if (!SHA256_HEX.test(input.packedSha256)) {
    failures.push({
      check: "release-review-pack",
      message: "the packed tarball SHA-256 must be 64 lowercase hex characters",
    });
  } else if (linkage.packedSha256 !== input.packedSha256) {
    failures.push({
      check: "release-review-packed-sha256-mismatch",
      message:
        "the Packed-SHA256 recorded in the annotated release tag does not match the SHA-256 of the tarball this checkout packs",
    });
  }

  return failures;
}
