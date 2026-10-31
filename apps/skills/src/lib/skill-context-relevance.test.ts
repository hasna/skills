/**
 * Prompt relevance and re-delivered history, measured through the real
 * buildSkillContext on a verified cache. The fixture reproduces the fleet
 * profile's trigger shapes that injected unrelated skills: selections without
 * triggers (matched by single slug words), one-word and duplicated keywords,
 * multi-word keywords matched as a bag of words, and one-word slugs ranked as
 * "named" from anywhere in a prompt.
 */
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { packSkillBundle } from "./skill-bundle.js";
import { activateSelectionProfile, cacheSelectionBundle, readSkillSessionSnapshot, selectionKey, sessionReceiptPath, writeSelectionJson } from "./selection-cache.js";
import { buildSkillContext } from "./skill-context.js";
import type { ResolvedSkillProfile, ResolvedSkillSelection } from "../types/skill-selection.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const AUTHORITY = "https://skills.example.com/api/v1";
type Spec = [slug: string, triggers?: ResolvedSkillSelection["triggers"] | null, aliases?: string[]];
const SPECS: Spec[] = [
  // No triggers: previously matched by any slug word of four or more letters.
  ["event-seating-plan", null], ["exam-study-plan", null], ["meal-plan", null], ["field-trip-plan", null],
  ["grant-compliance-check", null], ["book-cover-production-brief", null], ["live-event-run-of-show", null],
  // One-word slugs and duplicated keywords, as in the fleet profile.
  ["hook", { keywords: ["hook", "hook"] }, ["skill-hook"]], ["reconcile", { keywords: ["reconcile", "reconcile"] }, ["skill-reconcile"]],
  ["login", { keywords: ["login", "login"] }],
  // The one that actually answers the pasted hook output.
  ["session-reconciliation-repair", { keywords: ["SESSION_RECONCILIATION_REQUIRED", "Skills context is unavailable", "session reconciliation", "Skills hook repair", "Skills session pin"] }],
  ["fleet-sync", { keywords: ["fleet-sync"] }, ["machine-sync", "sync"]],
  // Other users of the same common words.
  ["hook-drift-repair", { keywords: ["hook drift"] }], ["hooks-install", { keywords: ["install hooks", "hook install"] }], ["claude-hooks", { keywords: ["claude hook"] }],
  ["bank-reconcile", { keywords: ["bank reconcile"] }], ["ledger-reconcile", { keywords: ["reconcile ledger"] }], ["sessions-reconcile", { keywords: ["reconcile session"] }],
  ["hasna-hooks", { keywords: ["Hasna hooks"] }], ["station-network", { keywords: ["station networking", "station network"] }],
  ["review-code", { keywords: ["review"] }], ["weak-one", { keywords: ["quartz lamp"] }], ["weak-two", { keywords: ["quartz lamp"] }],
  ["weak-three", { keywords: ["quartz lamp"] }], ["weak-four", { keywords: ["quartz lamp"] }],
];

async function fixture(specs: Spec[] = SPECS) {
  const root = mkdtempSync(join(tmpdir(), "skills-relevance-")); roots.push(root);
  const cacheDir = join(root, "cache"), source = join(root, "source"); mkdirSync(source);
  writeFileSync(join(source, "SKILL.md"), "---\nname: fixture\ndescription: Fixture\nkind: instruction\n---\nFixture body.\n");
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", skills: { kind: "instruction" } }));
  const bundle = packSkillBundle(source);
  const profile: ResolvedSkillProfile = { authority: AUTHORITY, workspaceId: "org-test", profileId: "fleet", profileRevision: "r1", selections: specs.map(([slug, triggers, aliases]) => ({
    authority: AUTHORITY, workspaceId: "org-test", profileRevision: "r1", slug, version: "1.0.0", bundleDigest: `sha256:${bundle.sha256}`,
    ...(triggers === null ? {} : { triggers: triggers ?? { keywords: [slug] } }), ...(aliases ? { aliases } : {}),
  })) };
  activateSelectionProfile(profile, { cacheDir });
  await cacheSelectionBundle(profile.selections[0]!, new Response(bundle.bytes), { cacheDir });
  const options = { cacheDir, cached: true, authority: AUTHORITY };
  const select = async (prompt: string, extra: Record<string, unknown> = {}) => buildSkillContext({ profileId: "fleet", prompt, ...extra }, options);
  const slugs = async (prompt: string) => (await select(prompt)).selections.map(selection => selection.slug);
  return { cacheDir, profile, options, select, slugs };
}

const ENGINEERING = "every time i change something i get this hook drift and agents stop working. check the station networking on the build host and make sure the agents pull latest from the apps monorepo, then show me the plan";
const PASTED_HOOK = "Hook · Skills context is unavailable [SESSION_RENEWAL_TIMEOUT] (profile=fleet, stage=context). Renewing this session's expired authorization did not finish within the hook's renewal window; no request was refused. Sync and diagnosis do not change this window. The existing pin is unchanged and the next prompt retries the renewal. If it keeps recurring, inspect the session with skills sessions show <session-id> --json and review skills sessions reconcile. - see this issue also, is the wf fixing this issue as well?";
const UNRELATED = ["event-seating-plan", "exam-study-plan", "meal-plan", "field-trip-plan", "grant-compliance-check", "book-cover-production-brief", "live-event-run-of-show"];

test("an engineering prompt injects no domain skill through single slug words or generic one-word keywords", async () => {
  const f = await fixture();
  const selected = await f.slugs(ENGINEERING);
  for (const slug of UNRELATED) expect(selected).not.toContain(slug);
  // The two specific phrases in the prompt are what select.
  expect(selected.sort()).toEqual(["hook-drift-repair", "station-network"]);
});

test("pasted hook output selects the repair skill by its phrase, not one-word slugs named anywhere", async () => {
  const f = await fixture();
  const selected = await f.slugs(PASTED_HOOK);
  expect(selected[0]).toBe("session-reconciliation-repair");
  for (const slug of ["hook", "reconcile", "fleet-sync", "login"]) expect(selected).not.toContain(slug);
});

test("positive controls: a slug phrase, an explicit name, a cued one-word name and a discriminating keyword still select", async () => {
  const f = await fixture();
  expect(await f.slugs("make a seating plan for the wedding event")).toEqual(["event-seating-plan"]);
  expect(await f.slugs("draft the grant compliance check for the foundation")).toEqual(["grant-compliance-check"]);
  expect(await f.slugs("please run $book-cover-production-brief on the new title")).toEqual(["book-cover-production-brief"]);
  expect(await f.slugs("use the hook skill to explain this")).toEqual(["hook"]);
  expect(await f.slugs("use `hook` skill here")).toEqual(["hook"]);
  expect(await f.slugs("review this patch")).toEqual(["review-code"]);
  expect(await f.slugs("use fleet-sync to update the station")).toEqual(["fleet-sync"]);
});

test("multi-word keywords match only as adjacent phrases", async () => {
  const f = await fixture();
  expect(await f.slugs("the hasna hooks lane is down")).toEqual(["hasna-hooks"]);
  expect(await f.slugs("hooks for hasna")).toEqual([]);
});

test("prompt matches tied at the last free slot are offered as load commands, never picked by slug order", async () => {
  const f = await fixture();
  const result = await f.select("the quartz lamp");
  expect(result.selections).toEqual([]);
  expect(result.omitted.map(entry => [entry.slug, entry.reason])).toEqual(["weak-four", "weak-one", "weak-three", "weak-two"].map(slug => [slug, "ambiguous-match"]));
  // A stronger match still wins its slot; the weaker tie after it is not picked alphabetically.
  const mixed = await f.select("the quartz lamp and the grant compliance check");
  expect(mixed.selections.map(selection => selection.slug)).toEqual(["grant-compliance-check"]);
  expect(mixed.omitted.map(entry => entry.reason)).toEqual(Array(4).fill("ambiguous-match"));
});

function sessionWithHistory(f: Awaited<ReturnType<typeof fixture>>, loaded: string[], extra: Record<string, unknown> = {}) {
  const keys = loaded.map(slug => selectionKey(f.profile.selections.find(selection => selection.slug === slug)!));
  writeSelectionJson(sessionReceiptPath("parent", f.options), { schemaVersion: 1, verifiedAt: new Date().toISOString(), profile: f.profile, sessionId: "parent", generation: 1, loaded: keys, ...extra });
}
// Loaded in this order: the last one is the most recent.
const HISTORY = ["book-cover-production-brief", "event-seating-plan", "grant-compliance-check", "exam-study-plan", "meal-plan", "field-trip-plan", "login", "reconcile", "hook", "review-code", "station-network", "fleet-sync", "session-reconciliation-repair", "hook-drift-repair"];

test("a subagent inherits the parent's most recent skill as one body and the next ones as load commands", async () => {
  const f = await fixture();
  sessionWithHistory(f, HISTORY);
  const child = await f.select("", { sessionId: "parent", agentId: "child-1" });
  expect(child.selections.map(selection => [selection.slug, selection.reason])).toEqual([["hook-drift-repair", "subagent-inherit"]]);
  expect(child.omitted.map(entry => entry.slug)).toEqual(HISTORY.slice(-10, -1).reverse());
  // Nothing older than the ten most recent is re-listed.
  expect(child.omitted.map(entry => entry.slug)).not.toContain("book-cover-production-brief");
});

test("a restore re-delivers the two most recent loaded skills and lists the next ones", async () => {
  const f = await fixture();
  sessionWithHistory(f, HISTORY);
  const restored = await f.select("", { sessionId: "parent", restore: true });
  expect(restored.selections.map(selection => [selection.slug, selection.reason])).toEqual([["hook-drift-repair", "session-restore"], ["session-reconciliation-repair", "session-restore"]]);
  expect(restored.omitted.map(entry => entry.slug)).toEqual(HISTORY.slice(-10, -2).reverse());
});

test("a read-only prompt leaves the session receipt and its generation unchanged; a new load still records", async () => {
  const f = await fixture();
  sessionWithHistory(f, ["hook"]);
  const before = readSkillSessionSnapshot("parent", f.options);
  expect((await f.select("continue the current task", { sessionId: "parent" })).selections).toEqual([]);
  const after = readSkillSessionSnapshot("parent", f.options);
  expect(after.generation).toBe(before.generation);
  expect(after.sha256).toBe(before.sha256);
  expect((await f.select("make a seating plan for the wedding event", { sessionId: "parent" })).selections.map(selection => selection.slug)).toEqual(["event-seating-plan"]);
  expect(readSkillSessionSnapshot("parent", f.options).generation).toBe(before.generation + 1);
});

test("on the fleet's word shapes, a generic run of slug words or a much weaker match is never injected", async () => {
  // As in the fleet profile: "reconcile" is a rare trigger word there (no
  // other reconcile skills), "check" and "compliance" are shared.
  const specs = SPECS.filter(([slug]) => !["bank-reconcile", "ledger-reconcile", "sessions-reconcile"].includes(slug)).concat([
    ["compliance-evidence-mapping", null], ["marketing-compliance-copy-review", null],
    ["health-check", { keywords: ["health check"] }], ["link-check", { keywords: ["check links"] }], ["spell-check", { keywords: ["spell check"] }],
  ] as Spec[]);
  const f = await fixture(specs);
  const pasted = await f.select(PASTED_HOOK);
  expect(pasted.selections.map(selection => selection.slug)).toEqual(["session-reconciliation-repair"]);
  // The bookkeeping skill matched one rare word only: offered, not injected.
  expect(pasted.omitted.map(entry => [entry.slug, entry.reason])).toContainEqual(["reconcile", "weak-match"]);
  expect(await f.slugs("a run of the tests failed on the build host")).toEqual([]);
  expect(await f.slugs("please do a compliance check of this patch before merge")).toEqual([]);
  // Positive controls on the same profile.
  expect(await f.slugs("reconcile the ledger for march")).toEqual(["reconcile"]);
  expect(await f.slugs("prepare the run of show for the live event")).toEqual(["live-event-run-of-show"]);
  expect(await f.slugs("draft the grant compliance check for the foundation")).toEqual(["grant-compliance-check"]);
});

test("weak prompt pointers are offered as load commands after every other omission, never injected, and never unrelated domain skills", async () => {
  const specs = SPECS.concat([
    ["designs-watch", { keywords: ["Hasna designs", "designs review", "designs round", "designs watch", "designs-watch", "review pins", "screen review"] }],
    ...Array.from({ length: 4 }, (_, index): Spec => [`review-user-${index}`, { keywords: ["review"] }]),
  ]);
  const f = await fixture(specs);
  // Real-profile shape: the adjacent phrase is absent, so nothing is injected.
  const designs = await f.select("push the new iPhone screens to the designs app for review");
  expect(designs.selections).toEqual([]);
  expect(designs.context).toBe("");
  expect(designs.omitted.map(entry => [entry.slug, entry.reason, entry.loadCommand])).toEqual([["designs-watch", "partial-match", "skills load designs-watch@1.0.0 --selection-profile fleet"]]);
  // The engineering prompt still injects only its two phrases, and offers no domain skill.
  const engineering = await f.select(ENGINEERING);
  expect(engineering.selections.map(selection => selection.slug).sort()).toEqual(["hook-drift-repair", "station-network"]);
  for (const slug of UNRELATED) expect(engineering.omitted.map(entry => entry.slug)).not.toContain(slug);
  expect(engineering.omitted.every(entry => ["common-word", "partial-match", "weak-match", "skill-limit", "ambiguous-match"].includes(entry.reason))).toBe(true);
  // Offers follow the other omissions.
  const mixed = await f.select("the quartz lamp and the grant compliance check, and push the screens to the designs app for review");
  expect(mixed.omitted.map(entry => entry.reason)).toEqual([...Array(4).fill("ambiguous-match"), "partial-match"]);
});

test("a minimum prompt score offers one-word matches, keeps names and phrases, and leaves the default unchanged", async () => {
  const f = await fixture();
  const managed = { ...f.options, minPromptScore: 200 };
  const select = (prompt: string) => buildSkillContext({ profileId: "fleet", prompt }, managed);
  // One discriminating word: injected by default, offered once the hook asks for a phrase.
  expect(await f.slugs("the login page fails")).toEqual(["login"]);
  const oneWord = await select("the login page fails");
  expect(oneWord.selections).toEqual([]);
  expect(oneWord.omitted.map(entry => [entry.slug, entry.reason])).toEqual([["login", "weak-match"]]);
  expect(oneWord.omitted[0]!.loadCommand).toBe("skills load login@1.0.0 --selection-profile fleet");
  expect(oneWord.context).not.toContain("Fixture body");
  // A phrase of two words reaches the score.
  expect((await select("look at the hook drift on this station")).selections.map(entry => entry.slug)).toEqual(["hook-drift-repair"]);
  // A complete name is never held back by the score, nor is an explicit request.
  expect((await select("run hook-drift-repair now")).selections.map(entry => entry.slug)).toEqual(["hook-drift-repair"]);
  expect((await select("use the reconcile skill")).selections.map(entry => entry.slug)).toEqual(["reconcile"]);
  expect((await select("please use $reconcile here")).selections.map(entry => [entry.slug, entry.reason])).toEqual([["reconcile", "explicit"]]);
});

test("zero inherited bodies gives a subagent its parent's skills as load commands, and its pin is unchanged", async () => {
  const f = await fixture();
  const parent = await f.select("$reconcile and $hook-drift-repair", { sessionId: "parent" });
  expect(parent.selections.map(selection => selection.slug).sort()).toEqual(["hook-drift-repair", "reconcile"]);
  const child = await buildSkillContext({ profileId: "fleet", prompt: "", sessionId: "parent", agentId: "child-pointers" }, { ...f.options, inheritedBodies: 0 });
  expect(child.selections).toEqual([]);
  expect(child.context).not.toContain("Fixture body");
  expect(child.omitted.map(entry => entry.slug).sort()).toEqual(["hook-drift-repair", "reconcile"]);
  expect(child.omitted.every(entry => entry.loadCommand.startsWith(`skills load ${entry.slug}@1.0.0`))).toBe(true);
  const receipt = readSkillSessionSnapshot("parent:child-pointers", { cacheDir: f.cacheDir }).receipt;
  expect(receipt.parent?.sessionId).toBe("parent");
  expect(receipt.loaded).toEqual([]);
  // A child that names one of them, or matches it by a phrase, still gets that body.
  const named = await buildSkillContext({ profileId: "fleet", prompt: "$reconcile please", sessionId: "parent", agentId: "child-named" }, { ...f.options, inheritedBodies: 0 });
  expect(named.selections.map(selection => [selection.slug, selection.reason])).toEqual([["reconcile", "explicit"]]);
  expect(named.omitted.map(entry => entry.slug)).toEqual(["hook-drift-repair"]);
  const phrase = await buildSkillContext({ profileId: "fleet", prompt: "see the hook drift", sessionId: "parent", agentId: "child-phrase" }, { ...f.options, inheritedBodies: 0, minPromptScore: 200 });
  expect(phrase.selections.map(selection => [selection.slug, selection.reason])).toEqual([["hook-drift-repair", "prompt"]]);
  // The same child with the default keeps today's one body.
  const another = await f.select("", { sessionId: "parent", agentId: "child-default" });
  expect(another.selections.map(selection => selection.reason)).toEqual(["subagent-inherit"]);
});

test("a negative or fractional score or inherited body limit is refused", async () => {
  const f = await fixture();
  for (const limits of [{ minPromptScore: -1 }, { minPromptScore: 1.5 }, { inheritedBodies: -1 }, { inheritedBodies: 0.5 }]) {
    await expect(buildSkillContext({ profileId: "fleet", prompt: "x" }, { ...f.options, ...limits })).rejects.toMatchObject({ code: "INVALID_CONTEXT_BUDGET" });
  }
});

test("long task text that uses a one-word trigger's word gets no body under the hook's score, but the same words do by default", async () => {
  const f = await fixture([["effect", { keywords: ["effect"] }], ["rollback", { keywords: ["rollback"] }], ["handoff", { keywords: ["handoff"] }],
    ["marketing", { keywords: ["marketing"] }], ["missing-invoices", { keywords: ["missing invoices"] }]]);
  const text = "The change takes effect after the ship. Rollback is the flag ship. Keep the checkout handoff bound to the original workspace, and the marketing site reads the same price.";
  const managed = await buildSkillContext({ profileId: "fleet", prompt: text }, { ...f.options, minPromptScore: 200, maxSkills: 2 });
  expect(managed.selections).toEqual([]);
  expect(managed.omitted.map(entry => entry.reason)).toEqual(["weak-match", "weak-match", "weak-match", "weak-match"]);
  // Control: the check can fail. Without the score these are real prompt matches.
  const plain = await buildSkillContext({ profileId: "fleet", prompt: text }, { ...f.options, maxSkills: 4 });
  expect(plain.selections.map(selection => selection.slug).sort()).toEqual(["effect", "handoff", "marketing", "rollback"]);
  // A phrase in the same text is still on the subject.
  const phrase = await buildSkillContext({ profileId: "fleet", prompt: `${text} Send the missing invoices.` }, { ...f.options, minPromptScore: 200, maxSkills: 2 });
  expect(phrase.selections.map(selection => selection.slug)).toEqual(["missing-invoices"]);
});
