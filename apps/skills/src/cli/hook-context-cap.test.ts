import { afterEach, expect, test } from "bun:test";
import { capManagedHookContext, managedHookContextLimits, MANAGED_HOOK_CONTEXT_MAX_CHARS, MANAGED_HOOK_CONTEXT_MAX_SKILLS, MANAGED_HOOK_CONTEXT_RESERVE_CHARS } from "./commands/agent-integration.js";

const names = ["SKILLS_HOOK_CONTEXT_MAX_CHARS", "SKILLS_HOOK_CONTEXT_MAX_SKILLS"] as const;
const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
afterEach(() => { for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; } });

test("hook limits default to 12000 characters and 2 skills, with the body budget below the cap", () => {
  for (const name of names) delete process.env[name];
  expect(managedHookContextLimits()).toEqual({ maxChars: 12_000, maxSkills: 2, bodyChars: 12_000 - MANAGED_HOOK_CONTEXT_RESERVE_CHARS });
  expect(MANAGED_HOOK_CONTEXT_MAX_CHARS).toBe(12_000);
  expect(MANAGED_HOOK_CONTEXT_MAX_SKILLS).toBe(2);
});

test("only an in-range integer override changes the hook limits", () => {
  process.env.SKILLS_HOOK_CONTEXT_MAX_CHARS = "8000"; process.env.SKILLS_HOOK_CONTEXT_MAX_SKILLS = "1";
  expect(managedHookContextLimits()).toEqual({ maxChars: 8_000, maxSkills: 1, bodyChars: 8_000 - MANAGED_HOOK_CONTEXT_RESERVE_CHARS });
  for (const [chars, skills] of [["64001", "21"], ["100", "0"], ["12k", "two"], ["-5", "-1"], ["", " "], ["1e4", "1.5"]]) {
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
    "<task-notification>\n<task-id>x</task-id>", "[SYSTEM NOTIFICATION - NOT USER INPUT]\nThis is an automated background-task event.\n\n<task-notification>", "header line\n[hasna:messages:abc]"])
    expect(isAgentSubmittedPrompt(prompt)).toBe(true);
  for (const prompt of ["review the ios app", "what does hasna:messages do?", "see [hasna:messages:abc] above", `${"x".repeat(400)}<task-notification>`, `${"y".repeat(401)}\n[hasna:messages:abc]`, "", undefined, 42])
    expect(isAgentSubmittedPrompt(prompt)).toBe(false);
});
