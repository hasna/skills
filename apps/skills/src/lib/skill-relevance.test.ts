import { expect, test } from "bun:test";
import { DISCRIMINATING_WORD_MAX_SELECTIONS, rankPromptRelevance, selectionPhrases, slugAnchors, triggerWordFrequency } from "./skill-relevance.js";
import type { ResolvedSkillSelection } from "../types/skill-selection.js";

const selection = (slug: string, triggers?: ResolvedSkillSelection["triggers"], aliases?: string[]): ResolvedSkillSelection => ({
  authority: "https://skills.example.com/api/v1", workspaceId: "org-test", profileRevision: "r1", slug, version: "1.0.0",
  bundleDigest: `sha256:${"a".repeat(64)}`, ...(triggers ? { triggers } : {}), ...(aliases ? { aliases } : {}),
});
const rank = (prompt: string, selections: ResolvedSkillSelection[]) => rankPromptRelevance(prompt, selections).map(entry => [entry.selection.slug, entry.priority, entry.score]);

test("a selection without keywords is matched by runs of two or more adjacent slug words, scored by the longest", () => {
  expect(selectionPhrases(selection("event-seating-plan")).phrases.map(words => words.join(" "))).toEqual(["event seating plan", "event seating", "seating plan"]);
  expect(selectionPhrases(selection("hook")).phrases).toEqual([["hook"]]);
  const all = [selection("event-seating-plan")];
  expect(rank("show me the plan for the event", all)).toEqual([]);
  expect(rank("the seating plan", all)).toEqual([["event-seating-plan", 1, 200]]);
  expect(rank("an event seating plan", all)).toEqual([["event-seating-plan", 1, 300]]);
});

test("duplicated keywords count once and keywords are phrases", () => {
  const all = [selection("reconcile", { keywords: ["reconcile", "reconcile", "Reconcile"] }), selection("hasna-hooks", { keywords: ["Hasna hooks"] })];
  expect(rank("reconcile the ledger", all)).toEqual([["reconcile", 1, 100]]);
  expect(rank("the hasna hooks lane", all)).toEqual([["hasna-hooks", 1, 200]]);
  expect(rank("hooks for hasna", all)).toEqual([]);
});

test("a one-word trigger used by more than the discriminating bound of selections counts only for a named selection", () => {
  const users = Array.from({ length: DISCRIMINATING_WORD_MAX_SELECTIONS + 1 }, (_, index) => selection(`plan-user-${index}`, { keywords: ["plan"] }));
  expect(triggerWordFrequency(users).get("plan")).toBe(DISCRIMINATING_WORD_MAX_SELECTIONS + 1);
  expect(rank("show me the plan", users)).toEqual([]);
  expect(rank("show me the plan from plan-user-2", users)).toEqual([["plan-user-2", 2, 100]]);
  const fewer = users.slice(0, DISCRIMINATING_WORD_MAX_SELECTIONS);
  expect(rank("show me the plan", fewer).map(([slug]) => slug)).toEqual(fewer.map(entry => entry.slug));
});

test("one-word names count only beside the word skill, separated by whitespace; hyphenated names and aliases count anywhere", () => {
  const all = [selection("hook", { keywords: ["hook"] }, ["skill-hook"]), selection("fleet-sync", { keywords: ["sync"] }, ["sync"])];
  expect(rank("use the hook skill", all)).toEqual([["hook", 2, 100]]);
  expect(rank("use skill `hook` now", all)).toEqual([["hook", 2, 100]]);
  expect(rank("Hook · Skills context is unavailable", all)).toEqual([["hook", 1, 100]]);
  expect(rank("ask skill-hook about it, the hook", all)).toEqual([["hook", 2, 100]]);
  expect(rank("sync the fleet", all)).toEqual([["fleet-sync", 1, 100]]);
  expect(rank("run fleet-sync to sync", all)).toEqual([["fleet-sync", 2, 100]]);
  // A name raises priority but never selects without a trigger match.
  expect(rank("the fleet-sync page", [selection("fleet-sync", { keywords: ["machine rollout"] })])).toEqual([]);
  // An empty keyword list still disables prompt matching, even for a name.
  expect(rank("use the hook skill", [selection("hook", { keywords: [] })])).toEqual([]);
});

test("a shorter slug run counts only with two words of three or more letters and one of the slug's least-used words", () => {
  const all = [
    selection("grant-compliance-check"), selection("compliance-evidence-mapping"), selection("marketing-compliance-copy-review"),
    selection("live-event-run-of-show"), selection("event-seating-plan"),
    // Other users of "check", so it says little about grant-compliance-check.
    selection("health-check", { keywords: ["health check"] }), selection("link-check", { keywords: ["check links"] }), selection("spell-check", { keywords: ["spell check"] }),
  ];
  const frequency = triggerWordFrequency(all);
  expect([...slugAnchors(["grant", "compliance", "check"], frequency)]).toEqual(["grant"]);
  expect([...slugAnchors(["live", "event", "run", "of", "show"], frequency)].sort()).toEqual(["live", "run", "show"]);
  // Negative controls: generic runs that carry no distinguishing word, or only one content word.
  expect(rank("please do a compliance check of this patch", all)).toEqual([]);
  expect(rank("a run of the tests failed", all)).toEqual([]);
  expect(rank("one of show and tell", all)).toEqual([]);
  // Positive controls: the whole slug, and shorter runs that name the skill.
  expect(rank("draft the grant compliance check", all)).toEqual([["grant-compliance-check", 1, 300]]);
  expect(rank("the grant compliance rules", all)).toEqual([["grant-compliance-check", 1, 200]]);
  expect(rank("prepare the run of show", all)).toEqual([["live-event-run-of-show", 1, 300]]);
  expect(rank("make a seating plan", all)).toEqual([["event-seating-plan", 1, 200]]);
});

test("a match much weaker than the prompt's best is marked weak; comparable and named matches are not", () => {
  const repair = selection("session-reconciliation-repair", { keywords: ["Skills context is unavailable", "session reconciliation"] });
  const reconcile = selection("reconcile", { keywords: ["reconcile"] });
  const weakOf = (prompt: string, selections: ResolvedSkillSelection[]) => rankPromptRelevance(prompt, selections).map(entry => [entry.selection.slug, entry.weak]);
  expect(weakOf("Skills context is unavailable; review skills sessions reconcile", [repair, reconcile])).toEqual([["session-reconciliation-repair", false], ["reconcile", true]]);
  // Alone, the same match is the best one and is not weak.
  expect(weakOf("reconcile the ledger", [repair, reconcile])).toEqual([["reconcile", false]]);
  // Exactly half of the best is not weak.
  const plans = [selection("meal-plan"), selection("event-seating-plan")];
  expect(weakOf("a meal plan and an event seating plan", plans)).toEqual([["event-seating-plan", false], ["meal-plan", false]]);
  // A named selection is never weak.
  expect(weakOf("Skills context is unavailable; use the reconcile skill", [repair, reconcile])).toEqual([["reconcile", false], ["session-reconciliation-repair", false]]);
});
