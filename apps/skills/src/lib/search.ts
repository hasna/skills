/**
 * Skill search — fuzzy matching with edit-distance and prefix scoring
 */

import { loadRegistry, type SkillMeta } from "./registry.js";

/**
 * Compute Levenshtein edit distance between two strings.
 * Uses a 2-row DP approach — no external deps.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,       // insertion
        prev[j] + 1,           // deletion
        prev[j - 1] + cost     // substitution
      );
    }
    prev.splice(0, prev.length, ...curr);
  }

  return prev[b.length];
}

/**
 * Check whether a query word fuzzy-matches any token in a target string.
 * Matching strategies (in order):
 *  1. Exact substring match
 *  2. Prefix match: word is a prefix of any whitespace/hyphen/underscore-split token
 *  3. Edit distance <= 2 for words of length >= 4, compared against each token
 *
 * Returns a score modifier (lower than exact substring to rank fuzzy results below exact ones).
 */
function fuzzyMatchScore(word: string, target: string): number {
  if (target.includes(word)) return 1; // exact substring — full score

  // Split target into individual tokens
  const tokens = target.split(/[\s\-_]+/).filter(Boolean);

  // Prefix match: word is a prefix of any token
  for (const token of tokens) {
    if (token.startsWith(word)) return 0.6;
  }

  // Edit distance match (only for words long enough to avoid noise)
  if (word.length >= 3) {
    const maxDist = word.length <= 3 ? 1 : 2;
    for (const token of tokens) {
      if (Math.abs(token.length - word.length) <= maxDist) {
        const dist = editDistance(word, token);
        if (dist <= maxDist) return 0.4;
      }
    }
  }

  return 0;
}

/**
 * Search skills by name, description, and tags using fuzzy matching.
 */
export function searchSkills(query: string, registry: SkillMeta[] = loadRegistry()): SkillMeta[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const scored: { skill: SkillMeta; score: number }[] = [];

  for (const skill of registry) {
    const nameLower = skill.name.toLowerCase();
    const displayNameLower = skill.displayName.toLowerCase();
    const descriptionLower = skill.description.toLowerCase();
    const tagsLower = skill.tags.map((t) => t.toLowerCase());
    const tagsCombined = tagsLower.join(" ");

    let score = 0;
    let allWordsMatch = true;

    for (const word of words) {
      let wordScore = 0;

      const nameMatch = fuzzyMatchScore(word, nameLower);
      if (nameMatch > 0) wordScore += 10 * nameMatch;

      const displayMatch = fuzzyMatchScore(word, displayNameLower);
      if (displayMatch > 0) wordScore += 7 * displayMatch;

      const tagMatch = Math.max(
        ...tagsLower.map((t) => fuzzyMatchScore(word, t)),
        fuzzyMatchScore(word, tagsCombined)
      );
      if (tagMatch > 0) wordScore += 5 * tagMatch;

      const descMatch = fuzzyMatchScore(word, descriptionLower);
      if (descMatch > 0) wordScore += 2 * descMatch;

      if (wordScore === 0) {
        allWordsMatch = false;
        break;
      }

      score += wordScore;
    }

    if (allWordsMatch && score > 0) {
      scored.push({ skill, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.skill);
}

/**
 * Bounded close canonical names for a refused name, strongest evidence first:
 *
 *  0. the exact name;
 *  1. a hyphen-delimited containment — the candidate owns the query as a whole
 *     leading or trailing segment (`fleet-refresh` → `instructions-fleet-refresh`);
 *  2. a multi-word token subset of the candidate;
 *  3. the edit-distance rule that was the only signal before.
 *
 * Containment is what edit distance cannot see, and it is the case that cost
 * real time: the canonical name that owns a shorter name as its trailing
 * segment is 13 edits from the short name, so a caller naming the procedure by
 * its last words was told the procedure did not exist (Agents Audit A27). The
 * distance pass still runs and fills any slots containment leaves, so a
 * distance-only miss — including every query under three characters — keeps the
 * answer it has always had.
 */
export function findCloseSkillNames(query: string, names: readonly string[], maxResults = 3): string[] {
  if (maxResults <= 0) return [];
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  const tokens = q.split("-").filter(Boolean);

  // Containment is evidence only from three characters; below that a whole
  // name would be a "segment" of far too many others. The scan is skipped for
  // short queries, never the distance pass below, which answers them exactly as
  // it did before this function existed (its threshold is `max(3, ...)`, so a
  // one- or two-character query still gets its distance matches).
  const ranked: Array<[string, number]> = [];
  if (q.length >= 3) {
    for (const name of names) {
      const candidate = name.toLowerCase();
      const rank = candidate === q ? 0
        : candidate.endsWith(`-${q}`) || candidate.startsWith(`${q}-`) ? 1
        : tokens.length > 1 && tokens.every((token) => candidate.split("-").includes(token)) ? 2
        : undefined;
      if (rank !== undefined) ranked.push([name, rank]);
    }
  }
  ranked.sort((a, b) => a[1] - b[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]));

  const found = ranked.slice(0, maxResults).map(([name]) => name);
  if (found.length === maxResults) return found;

  const taken = new Set(found);
  const threshold = Math.max(3, Math.floor(q.length / 2));
  const byDistance = names
    .filter((name) => !taken.has(name))
    .map((name) => ({ name, distance: editDistance(q, name.toLowerCase()) }))
    .filter((entry) => entry.distance <= threshold)
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
  return [...found, ...byDistance.slice(0, maxResults - found.length).map((entry) => entry.name)];
}

/**
 * Find skills with names similar to the given query (for "did you mean?" suggestions).
 */
export function findSimilarSkills(query: string, maxResults = 3, registry: SkillMeta[] = loadRegistry()): string[] {
  return findCloseSkillNames(query, registry.map((skill) => skill.name), maxResults);
}
