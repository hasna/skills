---
name: skill-goal-execute
description: Take a high-level goal and drive it to done — break it into tasks via the todos CLI, open a goal thread in the project's conversations channel, create a plan in todos, generate the tasks under that plan, then execute them one by one until complete. Use for 'execute this goal', 'break down and do X', 'set a goal and run it'.
user_invocable: true
---

# skill-goal-execute — Goal → Channel Thread → Plan → Tasks → Execute

Turn a stated goal into structured, tracked, executed work. This skill is the bridge
between "here's what I want" and "it's done", using the three canonical systems:
**conversations** (one goal thread in the project's channel), **todos** (a plan +
tasks), and **mementos** (learnings as you go).

## Inputs

- **The goal** — what the user wants achieved (one or more sentences).
- **The project** — the project this goal belongs to. If global / not tied to a
  project, use the **machine-name** project (`hostname`, e.g. `apple06`).

## Workflow

### 0. Log in & route

Ensure you're logged in as an agent (`skill-login`). Determine the target
project; for global work ensure the machine-name project exists
(`todos projects --add "$HOME" --name "$(hostname | sed 's/\.local$//')"`).

### 1. Open a goal thread in the project's conversations channel

Every project has ONE channel, named per the channel classes (flat repo name
for repo/package projects, full name for `platform-*`/`iapp-*`/`cweb-*`/
`community-*` products, `oss-*`/`internal-*`/`research-*` for initiatives —
same naming as `skill-project-create`). Goals do NOT get their own channels:
one thread per goal inside the project channel, updated in-thread.

```bash
# Ensure the project's channel exists (create if missing; "already exists" is fine)
conversations channel create "<project-channel>" --description "<project> coordination" --from <agent> 2>/dev/null || true
conversations channel join "<project-channel>" --from <agent>

# Open the goal thread: post the kickoff and capture its message id
GOAL_MSG_ID=$(conversations send "🎯 Goal: <goal>. Breaking into a plan + tasks now." \
  --channel "<project-channel>" --from <agent> -j \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
```

Machines have no channels of their own (machine traffic folds into `ops`), so
for global / machine-level goals open the thread in `ops` instead.

### 2. Create a plan in todos

```bash
todos plans --add "<goal title>" -d "<the goal, in full>"
# capture the returned PLAN_ID
```

### 3. Break the goal into tasks under that plan

Decompose the goal into concrete, ordered, individually-verifiable steps. Create each
as a task assigned to the plan and the project:

```bash
todos add "<step 1>" --plan "<PLAN_ID>" --project "<project>" -p high
todos add "<step 2>" --plan "<PLAN_ID>" --project "<project>" -p high
# ... one per step. Use --parent for sub-steps and deps for ordering if needed.
```

Post the breakdown to the goal thread so it's visible:

```bash
conversations reply "<plan id + task list>" --to $GOAL_MSG_ID --from <agent>
```

### 4. Execute the tasks ONE BY ONE

Work strictly one task at a time — never batch:

```
for each task in plan order:
  todos start <id>                 # claim + in_progress
  ... do the work, verify it actually works ...
  todos comment <id> "<what was done / result>"
  todos done <id>                  # only after verified
  conversations reply "✓ <task title>" --to $GOAL_MSG_ID --from <agent>
  (save a memory with skill-memory-save if something non-obvious was learned)
```

Respect the "execute tasks one by one — never in bulk" rule: each task gets individual
attention and verification before moving on.

### 5. Close out

When all tasks are done:

```bash
todos plans --complete "<PLAN_ID>"
conversations reply "🏁 Goal complete: <goal>. <summary of what shipped>." --to $GOAL_MSG_ID --from <agent>
```

Save a summary memory (`skill-memory-save`) capturing the outcome and any decisions.

## Rules

- ALWAYS: goal thread (project channel) → plan (todos) → tasks (todos) → execute one
  by one. Don't skip the plan or the thread.
- One thread per goal in the project's channel — never a per-goal channel, never
  duplicate threads; update in-thread (`conversations reply --to <goal-msg-id>`).
- The project channel follows the channel-class naming (see `skill-project-create`);
  global/machine goals thread into `ops`.
- Route the plan/tasks to the specific project, or the machine-name project for global
  goals.
- Execute tasks individually and verify each before completing — never bulk-complete.
- Post progress to the goal thread; save learnings to mementos. Never go dark.
- Prefer the CLIs (`todos`, `conversations`, `mementos`); fall back from MCP to CLI if
  an MCP is stale/broken.
