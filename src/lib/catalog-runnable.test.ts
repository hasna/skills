/**
 * catalog-runnable.test.ts — the successor to the hosted-metadata packaging guards.
 *
 * ## What this replaces, and why the replacement is not weaker
 *
 * Until the hosted set was emptied, five guards were derived from
 * `requireHostedMetadataSlugs()`. Every one of them protected the same shape of
 * property: *a skill whose implementation lives off-repo must ship its metadata
 * and NOT its source.* With zero hosted skills that sentence has no subject, so
 * those guards could only pass vacuously. They are retired in the same change
 * that empties the set, exactly as `HOSTED_METADATA_SET_EMPTY_ERROR` demands.
 *
 * The risk did not disappear; it INVERTED. The old danger was shipping source
 * that was supposed to stay private. The new danger is failing to ship source
 * that a skill needs in order to work — a `bin` pointing into a `src/` that
 * `npm pack` stripped produces a package that installs cleanly and then cannot
 * run anything. That failure is silent, which is precisely why it needs a guard.
 *
 * | retired guard | protected | now protected by |
 * |---|---|---|
 * | `hosted-skill-set.test.ts` "set is non-empty" | the other four are not vacuous | this file's own anti-vacuity assertions |
 * | `hosted-skill-set.test.ts` "src excluded by packlist globs" | hosted src stripped | "no skill source is excluded from the package" (inverted) |
 * | `hosted-skill-set.test.ts` "premium catalog == hosted declarations" | pricing/declaration drift | nothing to drift: both sets are empty and the price table is gone |
 * | `hosted-skill-set.test.ts` "no hosted src in packed package" | tarball outcome | "every executable skill ships a runnable entry point" |
 * | `public-package-boundary.test.ts` "hosted src out of repo/package" | same, repo + tarball | same as above |
 * | `public-package-boundary.test.ts` "no provider credential instructions" | hosted docs never named a provider key | "a skill that reads a provider key documents it" (inverted) |
 *
 * That last inversion is the substantive one. The old guard BANNED the strings
 * `OPENAI_API_KEY`, `GEMINI_API_KEY`, `EXA_API_KEY` … from hosted skill
 * directories, which is what made these skills unconvertible: a BYO-key skill
 * must name the variable it reads. Banning the mention was only ever a proxy for
 * the real rule, which is that the OSS must not ship a *credential*. So the guard
 * is turned around: naming a provider variable is now REQUIRED rather than
 * forbidden, and what is checked instead is that no key VALUE ships.
 *
 * The other half of that rule — never routing a credential through a vendor
 * endpoint — is R1, enforced by its own PR. It is deliberately not duplicated
 * here.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { getPackedFiles } from "./packlist.js";
import { listHostedMetadataSlugs, parseHostedSourceExclusionSlugs } from "./hosted-skill-set.js";
import { parseSkillFrontmatter } from "./skill-validation.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const REPO_ROOT = process.cwd();
const SKILLS_ROOT = join(REPO_ROOT, "skills");

const skillDirs = readdirSync(SKILLS_ROOT).filter(
  (entry) =>
    entry !== "_common" && !entry.startsWith(".") && statSync(join(SKILLS_ROOT, entry)).isDirectory(),
);

function skillKind(slug: string): "instruction" | "executable" {
  const skillMd = join(SKILLS_ROOT, slug, "SKILL.md");
  if (!existsSync(skillMd)) return "executable";
  return parseSkillFrontmatter(readFileSync(skillMd, "utf8"))?.kind === "instruction"
    ? "instruction"
    : "executable";
}

const instructionSkills = skillDirs.filter((slug) => skillKind(slug) === "instruction");
const executableSkills = skillDirs.filter((slug) => skillKind(slug) === "executable");

/** Provider credential variables a BYO-key skill may legitimately read. */
const PROVIDER_KEY_PATTERN = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:API_KEY|TOKEN|SECRET))\b/g;

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...collectFiles(path));
    else out.push(path);
  }
  return out;
}

describe("every catalog entry is runnable without a vendor service (R2)", () => {
  // Anti-vacuity for the whole file. Every assertion below iterates one of these
  // sets; an empty catalog would turn all of them green while proving nothing.
  test("the catalog is non-empty and every entry is classified", () => {
    expect(skillDirs.length).toBeGreaterThan(200);
    expect(instructionSkills.length).toBeGreaterThan(0);
    expect(executableSkills.length).toBeGreaterThan(0);
    expect(instructionSkills.length + executableSkills.length).toBe(skillDirs.length);
  });

  // The property the whole PR series exists to establish.
  test("no skill declares an off-repo runtime", () => {
    expect(listHostedMetadataSlugs(SKILLS_ROOT)).toEqual([]);
  });

  test("every executable skill ships a runnable entry point in the repo", () => {
    const broken = executableSkills.filter((slug) => {
      const dir = join(SKILLS_ROOT, slug);
      return !existsSync(join(dir, "src", "index.ts")) && !existsSync(join(dir, "src", "index.js"));
    });
    expect(broken).toEqual([]);
  });

  test("every instruction skill ships prose and no implementation", () => {
    const broken = instructionSkills.filter((slug) => {
      const dir = join(SKILLS_ROOT, slug);
      return !existsSync(join(dir, "SKILL.md")) || existsSync(join(dir, "src"));
    });
    expect(broken).toEqual([]);
  });
});

describe("the published package carries what the catalog promises", () => {
  const packed = getPackedFiles(REPO_ROOT);
  const packedSet = new Set(packed);

  test("packs a non-trivial file list", () => {
    expect(packed.length).toBeGreaterThan(500);
  });

  // Inverts the retired "hosted src is excluded" guard. `files` is
  // ORDER-SENSITIVE and negations are easy to leave behind; a stale
  // `!skills/{...}/src` entry would silently strip the implementation of a skill
  // that now needs it, while `package.json` still advertises a `bin` into it.
  test("no skill source is excluded from the package", () => {
    const files: string[] = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).files;
    expect(parseHostedSourceExclusionSlugs(files)).toEqual([]);
    expect(files.filter((entry) => /^!skills\/.*\/src$/.test(entry))).toEqual([]);
  });

  test("every executable skill's entry point actually ships", () => {
    const missing = executableSkills.filter(
      (slug) =>
        !packedSet.has(`skills/${slug}/src/index.ts`) && !packedSet.has(`skills/${slug}/src/index.js`),
    );
    expect(missing).toEqual([]);
  });

  test("every instruction skill's SKILL.md actually ships", () => {
    const missing = instructionSkills.filter((slug) => !packedSet.has(`skills/${slug}/SKILL.md`));
    expect(missing).toEqual([]);
  });
});

describe("BYO-key skills declare their credentials and ship none", () => {
  // Which skills read a provider credential from the environment, and which
  // variables each one names in its own docs.
  const byoKeySkills = new Map<string, { read: Set<string>; documented: Set<string> }>();

  for (const slug of skillDirs) {
    const dir = join(SKILLS_ROOT, slug);
    const read = new Set<string>();
    const documented = new Set<string>();
    for (const file of collectFiles(dir)) {
      const content = readFileSync(file, "utf8");
      if (file.endsWith(".ts") || file.endsWith(".js")) {
        for (const m of content.matchAll(/process\.env(?:\.([A-Z0-9_]+)|\[["']([A-Z0-9_]+)["']\])/g)) {
          const name = m[1] ?? m[2];
          if (name && /_(API_KEY|TOKEN|SECRET)$/.test(name)) read.add(name);
        }
      }
      if (file.endsWith(".md")) {
        for (const m of content.matchAll(PROVIDER_KEY_PATTERN)) documented.add(m[1]);
      }
    }
    if (read.size > 0) byoKeySkills.set(slug, { read, documented });
  }

  // Replaces the retired banned-strings guard, turned around: mentioning a
  // provider variable is now REQUIRED rather than forbidden. Without this
  // assertion the guard family would have no subject at all.
  test("at least one skill is BYO-key, so this guard is not vacuous", () => {
    expect([...byoKeySkills.keys()].length).toBeGreaterThan(0);
  });

  // Skills converted from hosted metadata by the R2 series. These are held to
  // the rule strictly: a BYO-key skill that does not name its variable is
  // unusable, and these are the ones this change is responsible for.
  const CONVERTED_SKILLS = new Set([
    "api-docs-portal", "audio-transcript-pack", "brand-assets", "invoice-reconciliation",
    "logo-design", "one-page-website", "pdf-to-dataset", "pdf-to-markdown",
    "product-mockup", "sdk-generator", "slide-deck-generator",
  ]);

  function undocumentedPairs(): string[] {
    const out: string[] = [];
    for (const [slug, { read, documented }] of byoKeySkills) {
      for (const name of read) {
        if (name.startsWith("SKILLS_")) continue; // per-skill knob, not a credential
        if (!documented.has(name)) out.push(`${slug}: reads ${name}, never documents it`);
      }
    }
    return out.sort();
  }

  test("every skill this series converted documents the credential it reads", () => {
    const offenders = undocumentedPairs().filter((entry) => CONVERTED_SKILLS.has(entry.split(":")[0]));
    expect(offenders).toEqual([]);
  });

  // Pre-existing gap, deliberately frozen rather than silently tolerated. These
  // skills predate this change and read a provider credential without naming it
  // in their own docs. The count may only go DOWN; a new undocumented BYO-key
  // skill fails this immediately.
  const PREEXISTING_UNDOCUMENTED_LIMIT = 131;

  test("the pre-existing undocumented-credential backlog does not grow", () => {
    expect(undocumentedPairs().length).toBeLessThanOrEqual(PREEXISTING_UNDOCUMENTED_LIMIT);
  });

  // The other half of the bracket, and what makes the ceiling tamper-evident.
  // The test above only stops the backlog GROWING; on its own it would let the
  // constant be quietly raised, or let real progress go unrecorded. Pinning the
  // constant to the true count closes both:
  //
  //   - Raising 131 to a larger number does not pass. It fails with
  //     `expected <constant> to be <actual>` until the constant equals reality,
  //     so any loosening is an explicit, reviewable edit rather than a silent one.
  //   - Fixing skills is not enough either. Dropping BELOW the ceiling fails and
  //     names the new number, so the constant must be lowered in the same diff —
  //     which makes the improvement visible and permanently locks it in.
  //
  // Anti-vacuity: an equality against a count derived at test time from actual
  // source and docs cannot pass vacuously, and the guard above asserts the
  // derived set has a subject at all.
  test("the frozen backlog constant matches reality", () => {
    const actual = undocumentedPairs().length;
    expect(PREEXISTING_UNDOCUMENTED_LIMIT).toBe(actual);
  });

  // The rule the banned-strings guard was a proxy for: the OSS must ship no
  // credential VALUE. Asserted against the packed tarball, not the repo.
  test("the packed package ships no credential value", () => {
    const secretShaped = [
      /\bsk-[A-Za-z0-9]{24,}/,
      /\bghp_[A-Za-z0-9]{30,}/,
      /\bAKIA[A-Z0-9]{16}\b/,
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    ];
    const allowlist = new Set([
      // Detection regex literal inside the security-audit scanner skill, not a
      // real private key. Mirrors the audited exception in release-guard.ts.
      "skills/security-audit/src/index.ts",
    ]);
    const leaks: string[] = [];
    for (const path of getPackedFiles(REPO_ROOT)) {
      if (path.startsWith("dist/") || path.startsWith("bin/")) continue;
      if (allowlist.has(path)) continue;
      const abs = join(REPO_ROOT, path);
      if (!existsSync(abs) || statSync(abs).isDirectory()) continue;
      const content = readFileSync(abs, "utf8");
      for (const pattern of secretShaped) {
        if (pattern.test(content)) leaks.push(`${path}: ${pattern}`);
      }
    }
    expect(leaks).toEqual([]);
  });

});
