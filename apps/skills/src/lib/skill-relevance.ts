/**
 * Deterministic prompt relevance for selected skills. Pure metadata: it reads
 * slugs, aliases and trigger keywords, never payloads, and builds no regular
 * expression from profile data.
 *
 * - A keyword is a phrase: all of its words, in order and adjacent, in the
 *   prompt. Duplicated keywords count once.
 * - A selection without keywords is matched by its slug's words as a phrase:
 *   the whole slug, or a shorter run of adjacent slug words that carries the
 *   slug's own distinguishing word ("seating plan" for event-seating-plan, not
 *   "compliance check" for grant-compliance-check or "run of" for
 *   live-event-run-of-show), scored by the longest run that matched. A shorter
 *   run needs two words of at least SLUG_CONTENT_WORD_MIN_LENGTH letters and
 *   one of the slug's least-used words in this profile's triggers. Single slug
 *   words never match on their own, except a one-word slug.
 * - A one-word phrase counts only when it discriminates in this profile: a
 *   word used by the triggers of more than DISCRIMINATING_WORD_MAX_SELECTIONS
 *   selections (review, plan, check) says nothing on its own about which skill
 *   a prompt needs.
 * - A selection is named when the prompt contains its kebab-case slug or alias
 *   with at least one hyphen, or a one-word name separated only by whitespace
 *   from the word "skill" or "skills". A name raises priority and lets the
 *   selection's own one-word triggers count, but never selects on its own.
 * - A match much weaker than the prompt's best match (less than
 *   WEAK_MATCH_FRACTION of its score) is marked weak: the prompt is about
 *   something else, so it is offered as a load command, not injected. Named
 *   selections are never weak.
 * - An empty keyword list still disables prompt matching.
 */
import type { ResolvedSkillSelection } from "../types/skill-selection.js";

/** A one-word trigger shared by more selections than this selects nothing alone. */
export const DISCRIMINATING_WORD_MAX_SELECTIONS = 3;
/** One matched phrase word is worth this much; a candidate needs at least one. */
export const PHRASE_WORD_SCORE = 100;
/** A match scoring below this fraction of the prompt's best match is weak. */
export const WEAK_MATCH_FRACTION = 0.5;
/** Shorter slug words (of, to, a) neither distinguish a slug nor fill a partial slug run. */
export const SLUG_CONTENT_WORD_MIN_LENGTH = 3;
const NAME_CUES = new Set(["skill", "skills"]);

export interface PromptRelevance {
  selection: ResolvedSkillSelection;
  /** 2 when the prompt names the selection, otherwise 1. */
  priority: 1 | 2;
  score: number;
  /** The distinct phrases that counted, as normalized words. */
  phrases: string[];
  /** Much weaker than the prompt's best match; offered, not injected. */
  weak: boolean;
}

export function promptWords(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

interface SelectionPhrases { phrases: string[][]; fromSlug: boolean }
/** The selection's distinct trigger phrases, or its slug's word runs when it has no keywords. */
export function selectionPhrases(selection: Pick<ResolvedSkillSelection, "slug" | "triggers">): SelectionPhrases {
  const keywords = selection.triggers?.keywords;
  if (!Array.isArray(keywords)) {
    const words = promptWords(selection.slug);
    if (words.length < 2) return { phrases: words.length ? [words] : [], fromSlug: true };
    const runs: string[][] = [];
    for (let length = words.length; length >= 2; length--) {
      for (let start = 0; start + length <= words.length; start++) runs.push(words.slice(start, start + length));
    }
    return { phrases: runs, fromSlug: true };
  }
  const seen = new Set<string>(), phrases: string[][] = [];
  for (const keyword of keywords) {
    if (typeof keyword !== "string") continue;
    const words = promptWords(keyword);
    const key = words.join(" ");
    if (!words.length || seen.has(key)) continue;
    seen.add(key);
    phrases.push(words);
  }
  return { phrases, fromSlug: false };
}

/** How many selections use each word in any trigger phrase (each selection counted once). */
export function triggerWordFrequency(selections: readonly Pick<ResolvedSkillSelection, "slug" | "triggers">[]): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const selection of selections) {
    for (const word of new Set(selectionPhrases(selection).phrases.flat())) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  }
  return frequency;
}

interface PromptIndex { words: string[]; positions: Map<string, number[]>; names: Set<string>; spaced: string[] }
function indexPrompt(prompt: string): PromptIndex {
  const lower = prompt.toLowerCase(), words = promptWords(lower), positions = new Map<string, number[]>();
  words.forEach((word, index) => {
    const list = positions.get(word);
    if (list) list.push(index); else positions.set(word, [index]);
  });
  return {
    words, positions,
    // Keep complete kebab-case names intact: "inspect" is a word in
    // "inspect-follow", but is not an exact mention of a shorter skill.
    names: new Set(lower.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []),
    // Whitespace-separated tokens without surrounding quotes or punctuation,
    // so "the `hook` skill" names hook and "Hook · Skills" does not.
    spaced: lower.split(/\s+/).map(token => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")),
  };
}
function containsPhrase(index: PromptIndex, phrase: readonly string[]): boolean {
  const starts = index.positions.get(phrase[0]!);
  if (!starts) return false;
  next: for (const start of starts) {
    for (let offset = 1; offset < phrase.length; offset++) if (index.words[start + offset] !== phrase[offset]) continue next;
    return true;
  }
  return false;
}
function named(index: PromptIndex, name: string): boolean {
  if (name.includes("-")) return index.names.has(name);
  return index.spaced.some((token, position) => token === name && (NAME_CUES.has(index.spaced[position - 1] ?? "") || NAME_CUES.has(index.spaced[position + 1] ?? "")));
}

/**
 * The slug's distinguishing words: among its words of at least
 * SLUG_CONTENT_WORD_MIN_LENGTH letters, those used by the fewest selections'
 * triggers in this profile (all of them when tied).
 */
export function slugAnchors(slugWords: readonly string[], frequency: ReadonlyMap<string, number>): Set<string> {
  const content = slugWords.filter(word => word.length >= SLUG_CONTENT_WORD_MIN_LENGTH);
  const least = Math.min(...content.map(word => frequency.get(word) ?? 0));
  return new Set(content.filter(word => (frequency.get(word) ?? 0) === least));
}
function partialSlugRunCounts(run: readonly string[], anchors: ReadonlySet<string>): boolean {
  return run.filter(word => word.length >= SLUG_CONTENT_WORD_MIN_LENGTH).length >= 2 && run.some(word => anchors.has(word));
}

/**
 * Rank selections by prompt relevance. Only candidates with at least one
 * counted phrase are returned, ordered by priority, then score, then slug.
 */
export function rankPromptRelevance(prompt: string, selections: readonly ResolvedSkillSelection[], frequency = triggerWordFrequency(selections)): PromptRelevance[] {
  const index = indexPrompt(prompt);
  const ranked: PromptRelevance[] = [];
  for (const selection of selections) {
    if (Array.isArray(selection.triggers?.keywords) && selection.triggers.keywords.length === 0) continue;
    const isNamed = [selection.slug, ...(selection.aliases ?? [])].some(name => named(index, name));
    const { phrases: candidates, fromSlug } = selectionPhrases(selection);
    const slugLength = fromSlug ? (candidates[0]?.length ?? 0) : 0;
    const anchors = fromSlug ? slugAnchors(candidates[0] ?? [], frequency) : undefined;
    let score = 0;
    const phrases: string[] = [];
    for (const phrase of candidates) {
      // A shorter slug run must still say which skill it means.
      if (anchors && phrase.length < slugLength && !partialSlugRunCounts(phrase, anchors)) continue;
      if (!containsPhrase(index, phrase)) continue;
      // A name disambiguates its own one-word triggers; elsewhere a common
      // one-word trigger selects nothing on its own.
      const weight = phrase.length > 1 ? PHRASE_WORD_SCORE * phrase.length
        : isNamed || (frequency.get(phrase[0]!) ?? 0) <= DISCRIMINATING_WORD_MAX_SELECTIONS ? PHRASE_WORD_SCORE : 0;
      if (!weight) continue;
      score += weight;
      phrases.push(phrase.join(" "));
      // Slug runs are listed longest first: the longest match is the score.
      if (fromSlug) break;
    }
    if (score >= PHRASE_WORD_SCORE) ranked.push({ selection, priority: isNamed ? 2 : 1, score, phrases, weak: false });
  }
  const best = Math.max(0, ...ranked.map(entry => entry.score));
  for (const entry of ranked) entry.weak = entry.priority === 1 && entry.score < best * WEAK_MATCH_FRACTION;
  return ranked.sort((a, b) => b.priority - a.priority || b.score - a.score || a.selection.slug.localeCompare(b.selection.slug));
}

/** At most this many weak prompt pointers are offered as load commands. */
export const PROMPT_OFFER_LIMIT = 3;
export type PromptOfferReason = "partial-match" | "common-word";
export interface PromptOffer { selection: ResolvedSkillSelection; reason: PromptOfferReason; evidence: number }
/**
 * Selections the prompt points at too weakly to select, offered as `skills
 * load` commands and never injected. Only trigger keywords count, never slug
 * runs, and a selection the caller excludes (already selected, ranked or
 * loaded) is skipped.
 *
 * - partial-match: all content words (at least SLUG_CONTENT_WORD_MIN_LENGTH
 *   letters, two or more) of a multi-word keyword appear in the prompt, though
 *   not as the phrase, and one of them discriminates in this profile
 *   ("designs review" in "push the screens to the designs app for review").
 * - common-word: a one-word keyword used by more than
 *   DISCRIMINATING_WORD_MAX_SELECTIONS selections appears in the prompt.
 *
 * Partial matches rank before common words, then more matching keywords,
 * then slug. A tie that does not fit the remaining offers is left out
 * entirely: an alphabetical slug is no reason to prefer one.
 */
export function rankPromptOffers(prompt: string, selections: readonly ResolvedSkillSelection[], frequency = triggerWordFrequency(selections),
  exclude: (selection: ResolvedSkillSelection) => boolean = () => false): PromptOffer[] {
  const present = new Set(promptWords(prompt));
  if (!present.size) return [];
  const found: PromptOffer[] = [];
  for (const selection of selections) {
    if (!Array.isArray(selection.triggers?.keywords) || selection.triggers.keywords.length === 0 || exclude(selection)) continue;
    let partial = 0, common = 0;
    for (const phrase of selectionPhrases(selection).phrases) {
      if (phrase.length > 1) {
        const content = phrase.filter(word => word.length >= SLUG_CONTENT_WORD_MIN_LENGTH);
        if (content.length >= 2 && content.every(word => present.has(word)) && content.some(word => (frequency.get(word) ?? 0) <= DISCRIMINATING_WORD_MAX_SELECTIONS)) partial++;
      } else if (present.has(phrase[0]!) && (frequency.get(phrase[0]!) ?? 0) > DISCRIMINATING_WORD_MAX_SELECTIONS) common++;
    }
    if (partial) found.push({ selection, reason: "partial-match", evidence: partial });
    else if (common) found.push({ selection, reason: "common-word", evidence: common });
  }
  found.sort((a, b) => Number(a.reason === "common-word") - Number(b.reason === "common-word") || b.evidence - a.evidence || a.selection.slug.localeCompare(b.selection.slug));
  const offers: PromptOffer[] = [];
  for (let start = 0; start < found.length && offers.length < PROMPT_OFFER_LIMIT;) {
    let end = start;
    while (end + 1 < found.length && found[end + 1]!.reason === found[start]!.reason && found[end + 1]!.evidence === found[start]!.evidence) end++;
    if (end - start + 1 > PROMPT_OFFER_LIMIT - offers.length) break;
    offers.push(...found.slice(start, end + 1));
    start = end + 1;
  }
  return offers;
}
