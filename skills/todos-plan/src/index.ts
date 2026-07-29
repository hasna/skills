#!/usr/bin/env bun
import { spawnSync } from "node:child_process";

const CHECKLIST = [
  "Read the Todos plan with: todos plans --show <plan-id>",
  "Inspect and start exactly one task before editing.",
  "Keep the Markdown plan artifact under .hasna/todos/plans/<project-id>/.",
  "Use Todos CLI for task status, comments, dependencies, and verification.",
  "Record validation evidence before marking a task done.",
];

function usage(): string {
  return [
    "todos-plan - plan authoring helper for Todos CLI source-of-truth workflows",
    "",
    "Usage:",
    "  todos-plan checklist",
    "  todos-plan path <project-id> <plan-slug>",
    "  todos-plan show <plan-id>",
    "",
    "This skill never edits Todos stores directly. It shells out to the",
    "installed todos CLI only for explicit show commands.",
  ].join("\n");
}

function runTodos(args: string[]): number {
  const result = spawnSync("todos", args, { stdio: "inherit" });
  if (result.error) {
    console.error(`todos CLI unavailable: ${result.error.message}`);
    return 1;
  }
  return typeof result.status === "number" ? result.status : 1;
}

const [command, ...args] = process.argv.slice(2);

if (!command || command === "--help" || command === "-h") {
  console.log(usage());
  process.exit(0);
}

if (command === "checklist") {
  for (const item of CHECKLIST) console.log(`- ${item}`);
  process.exit(0);
}

if (command === "path") {
  const [projectId, slug] = args;
  if (!projectId || !slug) {
    console.error("Usage: todos-plan path <project-id> <plan-slug>");
    process.exit(1);
  }
  console.log(`.hasna/todos/plans/${projectId}/${slug}.md`);
  process.exit(0);
}

if (command === "show") {
  const [planId] = args;
  if (!planId) {
    console.error("Usage: todos-plan show <plan-id>");
    process.exit(1);
  }
  process.exit(runTodos(["plans", "--show", planId]));
}

console.error(`Unknown command: ${command}`);
console.error(usage());
process.exit(1);
