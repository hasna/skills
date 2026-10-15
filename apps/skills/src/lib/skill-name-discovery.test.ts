import { describe, expect, test } from "bun:test";
import { findCloseSkillNames } from "./search.js";
import { exactProfileSelection } from "./selection-resolver.js";
import type { ResolvedSkillProfile, ResolvedSkillSelection } from "../types/skill-selection.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

/**
 * Canonical name discovery (Agents Audit A27).
 *
 * A caller who names a procedure by the words at the end of its canonical slug
 * was told it did not exist. Suggestions came only from edit distance, and
 * `instructions-fleet-refresh` is 13 edits from `fleet-refresh`, so nothing was
 * offered; `skills load fleet-refresh` then blamed "this profile or project
 * lock" for a name that is in no profile at all, which sends the reader to look
 * for a selection that was never there.
 */
const AUTHORITY = "https://skills.example.com/api/v1";
const SHA = "a".repeat(64);

function selection(slug: string, version: string, aliases?: string[]): ResolvedSkillSelection {
  return {
    slug, version, bundleDigest: `sha256:${SHA}`, authority: AUTHORITY,
    workspaceId: "org-test", profileRevision: "current", ...(aliases ? { aliases } : {}),
  };
}

function profile(selections: ResolvedSkillSelection[]): ResolvedSkillProfile {
  return { authority: AUTHORITY, workspaceId: "org-test", profileId: "fleet", profileRevision: "current", selections };
}

const CATALOGUE = ["instructions-fleet-refresh", "fleet-package-rollout", "brand-kit", "image", "deploy", "todos-plan"];

describe("findCloseSkillNames", () => {
  test("finds the canonical name that owns the query as a trailing segment", () => {
    expect(findCloseSkillNames("fleet-refresh", CATALOGUE)).toEqual(["instructions-fleet-refresh"]);
  });

  test("finds the canonical name that owns the query as a leading segment", () => {
    expect(findCloseSkillNames("fleet-package", CATALOGUE)).toEqual(["fleet-package-rollout"]);
  });

  test("a multi-word reversal still resolves through the token subset", () => {
    expect(findCloseSkillNames("refresh-fleet", CATALOGUE)).toEqual(["instructions-fleet-refresh"]);
  });

  test("containment is preferred over a nearer edit distance", () => {
    expect(findCloseSkillNames("deploy", ["deploys", "deploy-tool"])).toEqual(["deploy-tool", "deploys"]);
  });

  test("an unrelated name matches nothing", () => {
    expect(findCloseSkillNames("zzzzq", CATALOGUE)).toEqual([]);
    expect(findCloseSkillNames("nonexistent-xyz-000", CATALOGUE)).toEqual([]);
  });

  test("respects maxResults and stays deterministic", () => {
    expect(findCloseSkillNames("image", ["image-read", "image-enhancer", "image"], 2)).toEqual(["image", "image-read"]);
    expect(findCloseSkillNames("fleet-refresh", CATALOGUE, 0)).toEqual([]);
    expect(findCloseSkillNames("", CATALOGUE)).toEqual([]);
  });

  test("a distance-only miss keeps the answer it always had", () => {
    // No containment and no token subset here, so the edit-distance rule answers.
    expect(findCloseSkillNames("imge", ["image", "video"])).toEqual(["image"]);
  });

  test("queries under three characters keep their distance answers", () => {
    // Containment is skipped below three characters; the distance pass must not
    // be, or a short query silently loses the matches the base rule returned.
    expect(findCloseSkillNames("im", ["image", "video"])).toEqual(["image"]);
    expect(findCloseSkillNames("vd", ["image", "video"])).toEqual(["video"]);
    // Positive control: an unrelated short query still finds nothing.
    expect(findCloseSkillNames("zz", ["image", "video"])).toEqual([]);
  });
});

describe("exactProfileSelection refusal precision", () => {
  const fleet = selection("instructions-fleet-refresh", "0.1.1");
  const rollout = selection("fleet-package-rollout", "0.1.9");
  const brand = selection("brand-kit", "1.0.0");
  const snapshot = profile([fleet, rollout, brand]);

  test("a name that is in no profile names the accepted form and the close canonical name", () => {
    const error = (() => { try { exactProfileSelection("fleet-refresh", snapshot); } catch (e) { return e as Error & { code?: string }; } })();
    expect(error?.code).toBe("SKILL_NOT_SELECTED");
    expect(error?.message).toContain("'fleet-refresh'");
    expect(error?.message).toContain("Did you mean: instructions-fleet-refresh?");
    expect(error?.message).toContain("Accepted form:");
  });

  test("a wrong version names the selected version instead of the profile lock", () => {
    const error = (() => { try { exactProfileSelection("instructions-fleet-refresh@9.9.9", snapshot); } catch (e) { return e as Error & { code?: string }; } })();
    expect(error?.code).toBe("SKILL_NOT_SELECTED");
    expect(error?.message).toContain("selected at version '0.1.1', but '9.9.9' was requested");
    expect(error?.message).toContain("'instructions-fleet-refresh@0.1.1'");
    // A name that resolves must not be offered back as a suggestion for itself.
    expect(error?.message).not.toContain("Did you mean");
  });

  test("an empty version is its own refusal", () => {
    const error = (() => { try { exactProfileSelection("instructions-fleet-refresh@", snapshot); } catch (e) { return e as Error & { code?: string }; } })();
    expect(error?.code).toBe("SKILL_NOT_SELECTED");
    expect(error?.message).toContain("has an empty version");
  });

  test("an exact name resolves to its selection", () => {
    expect(exactProfileSelection("brand-kit", snapshot).slug).toBe("brand-kit");
    expect(exactProfileSelection("brand-kit@1.0.0", snapshot).version).toBe("1.0.0");
  });

  test("a declared alias resolves for the short name, and still wins over a suggestion", () => {
    const aliased = profile([selection("instructions-fleet-refresh", "0.1.1", ["fleet-refresh"])]);
    expect(exactProfileSelection("fleet-refresh", aliased).slug).toBe("instructions-fleet-refresh");
    expect(exactProfileSelection("fleet-refresh@0.1.1", aliased).version).toBe("0.1.1");
  });
});
