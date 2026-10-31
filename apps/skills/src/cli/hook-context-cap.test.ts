import { afterEach, expect, test } from "bun:test";
import { capManagedHookContext, managedHookContextLimits, managedHookPromptMinPhraseWords, managedHookSelectionArgs, MANAGED_HOOK_PROMPT_MIN_PHRASE_WORDS, MANAGED_HOOK_CONTEXT_MAX_CHARS, MANAGED_HOOK_CONTEXT_MAX_SKILLS, MANAGED_HOOK_CONTEXT_RESERVE_CHARS } from "./commands/agent-integration.js";

const names = ["SKILLS_HOOK_CONTEXT_MAX_CHARS", "SKILLS_HOOK_CONTEXT_MAX_SKILLS", "SKILLS_HOOK_PROMPT_MIN_PHRASE_WORDS"] as const;
const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
afterEach(() => { for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; } });

test("hook limits default to 12000 characters and 2 skills, with the body budget below the cap", () => {
  for (const name of names) delete process.env[name];
  expect(managedHookContextLimits()).toEqual({ maxChars: 12_000, maxSkills: 2, bodyChars: 12_000 - MANAGED_HOOK_CONTEXT_RESERVE_CHARS });
  expect(MANAGED_HOOK_CONTEXT_MAX_CHARS).toBe(12_000);
  expect(MANAGED_HOOK_CONTEXT_MAX_SKILLS).toBe(2);
});

test("an environment override can only lower the hook limits", () => {
  process.env.SKILLS_HOOK_CONTEXT_MAX_CHARS = "8000"; process.env.SKILLS_HOOK_CONTEXT_MAX_SKILLS = "1";
  expect(managedHookContextLimits()).toEqual({ maxChars: 8_000, maxSkills: 1, bodyChars: 8_000 - MANAGED_HOOK_CONTEXT_RESERVE_CHARS });
  process.env.SKILLS_HOOK_CONTEXT_MAX_CHARS = "12000"; process.env.SKILLS_HOOK_CONTEXT_MAX_SKILLS = "2";
  expect(managedHookContextLimits()).toMatchObject({ maxChars: 12_000, maxSkills: 2 });
  for (const [chars, skills] of [["12001", "3"], ["64000", "20"], ["64001", "21"], ["100", "0"], ["12k", "two"], ["-5", "-1"], ["", " "], ["1e4", "1.5"]]) {
    process.env.SKILLS_HOOK_CONTEXT_MAX_CHARS = chars; process.env.SKILLS_HOOK_CONTEXT_MAX_SKILLS = skills;
    expect(managedHookContextLimits()).toMatchObject({ maxChars: MANAGED_HOOK_CONTEXT_MAX_CHARS, maxSkills: MANAGED_HOOK_CONTEXT_MAX_SKILLS });
  }
});

test("assembled hook context never exceeds the cap and short context is unchanged", () => {
  const short = "Skill a@1.0.0\nbody";
  expect(capManagedHookContext(short, 12_000)).toBe(short);
  const exact = "x".repeat(12_000);
  expect(capManagedHookContext(exact, 12_000)).toBe(exact);
  const long = Array.from({ length: 2_000 }, (_, line) => `line ${line} of a long injected skill body`).join("\n");
  for (const cap of [3_012, 12_000, 64_000]) {
    const capped = capManagedHookContext(long, cap);
    expect(capped.length).toBeLessThanOrEqual(cap);
    expect(capped.endsWith("[Skills context truncated at the hook limit; read the rest with `skills load <slug>`.]")).toBe(true);
    expect(long.startsWith(capped.slice(0, capped.lastIndexOf("\n")))).toBe(true);
  }
  const unbroken = "y".repeat(50_000);
  expect(capManagedHookContext(unbroken, 12_000).length).toBeLessThanOrEqual(12_000);
});

test("agent-submitted prompts are recognised only by a marker at their start", async () => {
  const { isAgentSubmittedPrompt } = await import("../lib/agent-integration.js");
  for (const prompt of ["[hasna:messages:abc]\nFrom x", "  \n[hasna:conversations:abc]\n#general", "The hasna-messages plugin sent a message:\n[hasna:messages:abc]\nbody",
    "<task-notification>\n<task-id>x</task-id>", "[SYSTEM NOTIFICATION - NOT USER INPUT]\nThis is an automated background-task event.\n\n<task-notification>", "header line\n[hasna:messages:abc]",
    "Another Claude session sent a message:\n<agent-message from=\"bg-1\">\nbody\n</agent-message>", "Another Claude session sent a message:\n<cross-session-message from=\"s-2\">\nbody\n</cross-session-message>",
    "  \n<cross-session-message from=\"s-3\">\nbody", "header line\n<agent-message from=\"bg-4\">",
    "Another Claude session sent a message while you were working:\n<cross-session-message>\nbody", "A peer session sent a message while you were working:\nbody",
    "The coordinator sent a message while you were working:\nbody", "The hasna-messages plugin sent a message while you were working:\nbody",
    "[MESSAGE FROM NON-USER SOURCE - NOT USER INPUT]\nfrom #general", "<teammate-message teammate_id=\"t1\">\nbody\n</teammate-message>"])
    expect(isAgentSubmittedPrompt(prompt)).toBe(true);
  for (const prompt of ["review the ios app", "what does hasna:messages do?", "see [hasna:messages:abc] above", "what does <agent-message from=x> mean?", "quote: Another Claude session sent a message:", "The coordinator sent a message about the release and I want a summary", "tell me about <teammate-message> tags", `${"x".repeat(400)}<task-notification>`, `${"y".repeat(401)}\n[hasna:messages:abc]`, "", undefined, 42])
    expect(isAgentSubmittedPrompt(prompt)).toBe(false);
});

test("the hook's phrase length defaults to two words and an environment override can only raise it", () => {
  delete process.env.SKILLS_HOOK_PROMPT_MIN_PHRASE_WORDS;
  expect(MANAGED_HOOK_PROMPT_MIN_PHRASE_WORDS).toBe(2);
  expect(managedHookPromptMinPhraseWords()).toBe(2);
  process.env.SKILLS_HOOK_PROMPT_MIN_PHRASE_WORDS = "3";
  expect(managedHookPromptMinPhraseWords()).toBe(3);
  for (const value of ["1", "0", "-1", "2e1", "two", "", "17", "1000000"]) {
    process.env.SKILLS_HOOK_PROMPT_MIN_PHRASE_WORDS = value;
    expect(managedHookPromptMinPhraseWords()).toBe(2);
  }
});

test("Sumi's hook passes no selection flags, because its plugin discards the admission output a pointer would need", () => {
  delete process.env.SKILLS_HOOK_PROMPT_MIN_PHRASE_WORDS;
  expect(managedHookSelectionArgs("sumi")).toEqual([]);
  for (const agent of ["claude", "codex", "opencode", "cursor"] as const) {
    expect(managedHookSelectionArgs(agent)).toEqual(["--min-prompt-phrase-words", "2", "--inherited-bodies", "0"]);
  }
});
