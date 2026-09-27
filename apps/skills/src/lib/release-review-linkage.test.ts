import { describe, expect, test } from "bun:test";
import {
  RELEASE_REVIEW_LINKAGE_FIELDS,
  parseReleaseReviewLinkage,
  parseSkillsReleaseTagVersion,
  validateReleaseReviewLinkage,
} from "./release-review-linkage.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const PACKED_SHA256 = "3f1c0d9b7a54e2f6b8d0194c5e7a2b3d4c5e6f708192a3b4c5d6e7f8091a2b3c";
const RELEASE_COMMIT = "a".repeat(40);

function message(fields: Partial<Record<keyof typeof RELEASE_REVIEW_LINKAGE_FIELDS, string>> = {}): string {
  const resolved = {
    reviewerAgent: "review-agent-skills",
    goThreadId: "799711",
    goMessageId: "800744",
    packedSha256: PACKED_SHA256,
    ...fields,
  };
  return [
    "@hasna/skills 0.10.7",
    "",
    "Release notes for the candidate.",
    "",
    `${RELEASE_REVIEW_LINKAGE_FIELDS.reviewerAgent}: ${resolved.reviewerAgent}`,
    `${RELEASE_REVIEW_LINKAGE_FIELDS.goThreadId}: ${resolved.goThreadId}`,
    `${RELEASE_REVIEW_LINKAGE_FIELDS.goMessageId}: ${resolved.goMessageId}`,
    `${RELEASE_REVIEW_LINKAGE_FIELDS.packedSha256}: ${resolved.packedSha256}`,
    "",
  ].join("\n");
}

function validate(overrides: Partial<Parameters<typeof validateReleaseReviewLinkage>[0]> = {}) {
  return validateReleaseReviewLinkage({
    tagMessage: message(),
    tag: "npm/skills/v0.10.7",
    tagType: "tag",
    tagCommit: RELEASE_COMMIT,
    releaseCommit: RELEASE_COMMIT,
    packageName: "@hasna/skills",
    packageVersion: "0.10.7",
    repositoryUrl: "https://github.com/hasna/skills.git",
    repositoryDirectory: "apps/skills",
    registry: "https://registry.npmjs.org",
    access: "public",
    packedSha256: PACKED_SHA256,
    ...overrides,
  });
}

const checks = (problems: Array<{ check: string }>) => problems.map((problem) => problem.check);

describe("skills release tag linkage fields", () => {
  test("a complete annotated tag message yields all four linkage values and may carry prose", () => {
    const parsed = parseReleaseReviewLinkage(message());
    expect(parsed.failures).toEqual([]);
    expect(parsed.linkage).toEqual({
      reviewerAgent: "review-agent-skills",
      goThreadId: "799711",
      goMessageId: "800744",
      packedSha256: PACKED_SHA256,
    });
  });

  const linkageKeyByField: Record<string, keyof ReturnType<typeof parseReleaseReviewLinkage>["linkage"]> = {
    [RELEASE_REVIEW_LINKAGE_FIELDS.reviewerAgent]: "reviewerAgent",
    [RELEASE_REVIEW_LINKAGE_FIELDS.goThreadId]: "goThreadId",
    [RELEASE_REVIEW_LINKAGE_FIELDS.goMessageId]: "goMessageId",
    [RELEASE_REVIEW_LINKAGE_FIELDS.packedSha256]: "packedSha256",
  };

  for (const [field, check] of [
    [RELEASE_REVIEW_LINKAGE_FIELDS.reviewerAgent, "release-review-linkage-reviewer"],
    [RELEASE_REVIEW_LINKAGE_FIELDS.goThreadId, "release-review-linkage-thread"],
    [RELEASE_REVIEW_LINKAGE_FIELDS.goMessageId, "release-review-linkage-go"],
    [RELEASE_REVIEW_LINKAGE_FIELDS.packedSha256, "release-review-linkage-packed-sha256"],
  ] as const) {
    test(`a missing ${field} field fails closed`, () => {
      const withoutField = message()
        .split("\n")
        .filter((line) => !line.startsWith(`${field}:`))
        .join("\n");
      const parsed = parseReleaseReviewLinkage(withoutField);
      expect(checks(parsed.failures)).toEqual([check]);
      expect(parsed.linkage[linkageKeyByField[field]!]).toBeUndefined();
    });
  }

  test("a duplicated linkage field fails closed instead of taking one of the two values", () => {
    const parsed = parseReleaseReviewLinkage(`${message()}Git-Prs-GO: 999999\n`);
    expect(checks(parsed.failures)).toContain("release-review-linkage-duplicate");
  });

  test("an unrecognised fifth linkage field fails closed", () => {
    const parsed = parseReleaseReviewLinkage(`${message()}Release-Review-Verdict: GO\n`);
    expect(checks(parsed.failures)).toEqual(["release-review-linkage-unknown"]);
  });

  test("the retired publishing-channel GO field cannot stand in for the git-prs verdict", () => {
    const parsed = parseReleaseReviewLinkage(message().replace("Git-Prs-GO:", "Git-Publishing-GO:"));
    expect(checks(parsed.failures)).toContain("release-review-linkage-unknown");
    expect(checks(parsed.failures)).toContain("release-review-linkage-go");
  });

  test("Pack-SHA256 look-alikes and malformed digests are refused", () => {
    for (const malformed of [PACKED_SHA256.toUpperCase(), PACKED_SHA256.slice(0, 63), ` ${PACKED_SHA256}`, `${PACKED_SHA256}0`]) {
      const parsed = parseReleaseReviewLinkage(message({ packedSha256: malformed }));
      expect(checks(parsed.failures)).toContain("release-review-linkage-packed-sha256");
      expect(parsed.linkage.packedSha256).toBeUndefined();
    }
    const lookAlike = parseReleaseReviewLinkage(message().replace("Packed-SHA256:", "Packed-Sha256:"));
    expect(checks(lookAlike.failures)).toContain("release-review-linkage-packed-sha256");
  });

  test("malformed reviewer and GO references are refused", () => {
    for (const reviewerAgent of [" two-words", "-leading-dash", "has space", "a".repeat(129), ""]) {
      expect(checks(parseReleaseReviewLinkage(message({ reviewerAgent })).failures)).toEqual(["release-review-linkage-reviewer"]);
    }
    for (const goThreadId of ["https://example.test/thread", "has space", ""]) {
      expect(checks(parseReleaseReviewLinkage(message({ goThreadId })).failures)).toEqual(["release-review-linkage-thread"]);
    }
    for (const goMessageId of ["", "two words"]) {
      expect(checks(parseReleaseReviewLinkage(message({ goMessageId })).failures)).toEqual(["release-review-linkage-go"]);
    }
  });
});

describe("skills release tag version binding", () => {
  test("only the npm/skills/v<semver> form resolves a version", () => {
    expect(parseSkillsReleaseTagVersion("npm/skills/v0.10.7")).toBe("0.10.7");
    expect(parseSkillsReleaseTagVersion("npm/skills/v0.11.0-rc.1")).toBe("0.11.0-rc.1");
    expect(parseSkillsReleaseTagVersion("npm/skills/0.10.7")).toBeUndefined();
    expect(parseSkillsReleaseTagVersion("npm/todos/v0.17.2")).toBeUndefined();
    expect(parseSkillsReleaseTagVersion("npm/skills/vnext")).toBeUndefined();
    expect(parseSkillsReleaseTagVersion("v0.10.7")).toBeUndefined();
  });
});

describe("skills release review preflight", () => {
  test("the linked candidate passes with no failures", () => {
    expect(validate()).toEqual([]);
  });

  test("a digest that does not match the packed tarball is refused", () => {
    const problems = validate({
      tagMessage: message({ packedSha256: "b".repeat(64) }),
    });
    expect(checks(problems)).toEqual(["release-review-packed-sha256-mismatch"]);
  });

  test("a tag version that does not match the manifest is refused", () => {
    expect(checks(validate({ tag: "npm/skills/v0.10.8" }))).toEqual(["release-review-version"]);
    expect(checks(validate({ packageVersion: "0.10.6" }))).toEqual(["release-review-version"]);
  });

  test("an unannotated tag is refused even when its message would have been correct", () => {
    expect(checks(validate({ tagType: "commit" }))).toEqual(["release-review-tag-type"]);
  });

  test("a tag that targets another commit is refused", () => {
    expect(checks(validate({ tagCommit: "b".repeat(40) }))).toEqual(["release-review-tag-commit"]);
  });

  test("a non-skills package, repository, registry or access mode is refused", () => {
    expect(checks(validate({ packageName: "@hasna/other" }))).toEqual(["release-review-package"]);
    expect(checks(validate({ repositoryUrl: "https://github.com/hasna/other.git" }))).toEqual(["release-review-repository"]);
    expect(checks(validate({ repositoryDirectory: "apps/other" }))).toEqual(["release-review-repository"]);
    expect(checks(validate({ registry: "https://example.test" }))).toEqual(["release-review-registry"]);
    expect(checks(validate({ access: "restricted" }))).toEqual(["release-review-access"]);
  });

  test("a foreign tag form or an unpacked checkout is refused", () => {
    expect(checks(validate({ tag: "npm/todos/v0.10.7" }))).toEqual(["release-review-tag"]);
    expect(checks(validate({ packedSha256: undefined }))).toEqual(["release-review-pack"]);
    expect(checks(validate({ packedSha256: "not-a-digest" }))).toEqual(["release-review-pack"]);
  });
});
