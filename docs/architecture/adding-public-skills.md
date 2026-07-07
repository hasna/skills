# Adding a Public (Shipped) Skill

This document describes the **real** workflow for adding a skill that ships in the
published `@hasna/skills` package — the bundled corpus that `skills list`,
`list_skills`, and the MCP registry expose by default.

> [!IMPORTANT]
> `skills scaffold` and `skills port` do **not** add shipped skills. They write to
> the user-level custom directory `~/.hasna/skills/`, which is a private overlay on
> the current machine. Those skills are never published, never enter the bundled
> registry, and are not what agents discover through the package. To add a skill to
> the product you must edit this repository as described below.

## What "shipped" means

A shipped skill has **two coupled parts** that must stay in lockstep:

1. A **skill directory** at `skills/<name>/` (the on-disk corpus, published via the
   `files` list in `package.json`).
2. A **registry entry** — a `SkillMeta` object in one of the
   `src/lib/registry-data/<category>.ts` arrays, aggregated by
   `src/lib/registry-data/index.ts` into the exported `SKILLS` list.

The bundled `SKILLS` list is the default local source of truth
(`src/lib/registry.ts`; see `docs/architecture/reusable-skills-engine.md`). If the
directory and the registry entry disagree, the drift guard fails (see below).

## Step 1 — Create the skill directory

Create `skills/<name>/`. The directory name is the canonical slug. The drift guard
normalizes directory names by stripping a leading `skill-` and ignoring names that
start with `_` (`scripts/check_skill_corpus_drift.sh:52-55`), so:

- `skills/<name>/` registers as `<name>`.
- `skills/skill-<name>/` also registers as `<name>`.
- `skills/_scratch/` is ignored by the corpus (use `_`-prefixed names for
  non-shipped helper folders).

Every shipped skill needs a `SKILL.md` with YAML frontmatter (`name` + `description`
at minimum) plus `README.md` and `LICENSE`. The remaining required files depend on
the skill's runtime, which `validateSkillDirectory()` enforces
(`src/lib/skill-validation.ts:285-374`):

### Hosted-metadata skill (no local implementation)

Used for skills executed by the hosted Skills runtime. Declare hosting in
`package.json`:

```jsonc
// skills/<name>/package.json
{
  "name": "<name>",            // MUST equal the directory slug
  "version": "1.0.0",
  "private": true,
  "description": "Short public description",
  "type": "module",
  "skills": { "runtime": "hosted", "source": "remote" }
}
```

Hosted-metadata skills **must not** contain a `bin` entry and **must not** contain a
`src/` directory (`skill-validation.ts:329-331,362-365`). Files: `SKILL.md`,
`README.md`, `LICENSE`, `package.json`.

### Executable (local) skill

Runs locally from a compiled `bin`. Requires:

- `package.json` with `name` equal to the slug and a **non-empty `bin`** object
  (`skill-validation.ts:303-352`).
- A `src/` directory containing `src/index.ts` or `src/index.js`
  (`skill-validation.ts:361-369`).
- `tsconfig.json` (as the existing corpus skills carry).

> Prose-only "instruction" skills (a `SKILL.md` with no `package.json`/`bin`/`src`)
> are **not** yet a supported shipped kind — the validator still hard-requires
> `package.json`. Adding an `instruction` kind is tracked separately (fix-list C1/A2);
> until it lands, ship prose behavior as a hosted-metadata skill or keep it in the
> user-level custom dir.

## Step 2 — Add the registry entry

Add a `SkillMeta` object to the array in the matching category file under
`src/lib/registry-data/`. The `category` field must be one of the values in
`CATEGORIES` (`src/lib/registry-types.ts:34-52`). Category → file mapping:

| `category`                    | file                                        |
| ----------------------------- | ------------------------------------------- |
| Development Tools             | `development-tools.ts`                      |
| Business & Marketing          | `business-marketing.ts`                     |
| Productivity & Organization   | `productivity-organization.ts`              |
| Project Management            | `project-management.ts`                     |
| Content Generation            | `content-generation.ts`                     |
| Finance & Compliance          | `finance-compliance.ts`                     |
| Data & Analysis               | `data-analysis.ts`                          |
| Media Processing              | `media-processing.ts`                       |
| Design & Branding             | `design-branding.ts`                        |
| Web & Browser                 | `web-browser.ts`                            |
| Research & Writing            | `research-writing.ts`                       |
| Science & Academic            | `science-academic.ts`                       |
| Education & Learning          | `education-learning.ts`                     |
| Communication                 | `communication.ts`                          |
| Health & Wellness             | `health-wellness.ts`                        |
| Travel & Lifestyle            | `travel-lifestyle.ts`                       |
| Event Management              | `event-management.ts`                       |

```ts
{
  name: "<name>",            // MUST equal the skill directory slug
  displayName: "Human Name",
  description: "One-line description shown by list_skills / search_skills.",
  category: "Media Processing",
  tags: ["tag-a", "tag-b"],
  // Optional: version, pricing, availability, source.
}
```

Notes:

- `name` must be unique across the whole corpus — duplicates fail the drift guard.
- `description` is surfaced directly in the compact MCP `list_skills` output (after
  public sanitization), so keep it accurate and vendor-neutral.
- If the skill is premium/hosted, add pricing metadata so discovery quotes correctly.

## Step 3 — Keep the drift guard green

Directory set and registry-name set must match exactly. Verify with the self-check:

```bash
scripts/check_skill_corpus_drift.sh --base HEAD
```

It fails on (`check_skill_corpus_drift.sh:104-123`):

- **Registry entries missing local directories** — you added a `SkillMeta` but no
  `skills/<name>/` directory (or the names differ).
- **Local skill directories missing registry entries** — you added a directory but
  no `SkillMeta`.
- **Duplicate registry names** — two entries share a `name`.

The upstream drift variant (`--base upstream/main`) is used to detect divergence
from the upstream corpus; see `docs/architecture/skill-corpus-migration.md`.

## Step 4 — Respect the public/private boundary

`package.json`'s `files` list publishes **all** of `skills/` to public npm (with a
few `src`-exclusions for premium skills). Anything you put in a shipped skill
directory becomes public. Before adding a skill:

- Never include secrets, tokens, internal hostnames, private CLI names, or PII in
  any file under `skills/<name>/`.
- For premium/hosted skills, keep proprietary implementation out of the published
  tree (the `files` list already excludes `src` for the premium set; hosted-metadata
  skills carry no `src` at all).

## Step 5 — Pass the release guard

`bun run verify:release` (`scripts/release-guard.ts`) scans package-visible files —
including everything under `skills/` — for retired-cloud markers and secret
patterns, and fails the release if any are found. Run it before committing:

```bash
bun run verify:release
```

## Step 6 — Run the gates

```bash
bun run typecheck
bun test
bun run build
```

`prepack`/`prepublishOnly` also run the build, release guard, typecheck, and tests,
so a skill that passes the four commands above is ready to ship.

## Summary checklist

- [ ] `skills/<name>/` created with `SKILL.md` (+ `README.md`, `LICENSE`, and the
      runtime-appropriate `package.json`/`src`/`bin`).
- [ ] `SkillMeta` added to the correct `src/lib/registry-data/<category>.ts`, with
      `name` equal to the directory slug and a valid `category`.
- [ ] `scripts/check_skill_corpus_drift.sh --base HEAD` passes.
- [ ] No secrets/PII/internal identifiers in the published skill files.
- [ ] `bun run verify:release`, `bun run typecheck`, `bun test`, `bun run build` all pass.
