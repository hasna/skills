---
name: todos-plan
description: Use when Codewith needs to create, edit, save, verify, execute, route, or sync todos plans for local @hasna/todos work or hosted todos.md/platform-todos work. Triggers include todos plan authoring, local plan Markdown files, plan IDs, task-triggered workers, launch verification checklists, platform plan sync, dry-run plan generation, and updating Codewith workers that must use Todos CLI task IDs as source of truth.
---

# Todos Plan

Use the Todos CLI as the source of truth. Markdown plan files are durable
human-readable artifacts; they do not replace task or plan rows. Never edit
SQLite, RDS rows, or generated task stores directly.

## Known Launch Plans

- Platform launch plan: `fc27c6c1-7f26-4bea-bbda-dc0731a9d972`
- Codewith skills plan: `4bc933b6-8b0a-4e38-8807-aa11b034a9af`

When a prompt includes task IDs, inspect and update each task one at a time:
Commands containing angle-bracket placeholders are illustrative; replace the
placeholders with real task, plan, org, or file values before running them.

```bash
todos plans --show <plan-id>
todos inspect <task-id>
todos --agent <agent> start <task-id>
todos comment <task-id> "Progress note"
todos record-verification <task-id> "<command>" --status passed --summary "<summary>" --agent <agent>
todos --agent <agent> done <task-id> --files-changed "<paths>" --test-results "<results>" --notes "<notes>"
```

## Authoring Workflow

1. Start a native Codewith goal for non-trivial work.
2. Read the relevant plan with `todos plans --show <plan-id>`.
3. Inspect the current task before editing anything.
4. Create or update the local Markdown artifact under
   `.hasna/todos/plans/<project-id>/<plan-slug>.md`.
5. Use CLI commands for task/plan state changes:
   `todos plans --add`, `todos add --plan`, `todos update`,
   `todos comment`, `todos record-verification`, and `todos done`.
6. Use the Markdown file for intent, acceptance criteria, dependency notes,
   rollout notes, and evidence links.
7. Run validation commands and record them on the task.
8. Complete only the task whose acceptance criteria are satisfied.

Use direct file edits for plan text. Use Todos CLI for state transitions,
assignments, comments, dependencies, and verification evidence.

## Local Plan Files

Preferred location:

```text
.hasna/todos/plans/<project-id>/<plan-slug>.md
```

Use stable lowercase slugs. Include the Todos plan ID when one exists. If a
plan is still draft-only, set `plan_id: pending` and create or link the plan
before workers execute it.

Example:

```markdown
---
plan_id: 4bc933b6-8b0a-4e38-8807-aa11b034a9af
project_id: open-skills
plan_slug: codewith-todos-plan-skills
status: active
source: todos-cli
updated: 2026-06-30
---

# Codewith Todos Plan Skills

## Scope
- Create a `todos-plan` Codewith skill.
- Sync it to the active Codewith skills directory.

## Tasks
- [ ] `4a32ec84` Define authoring workflow.
- [ ] `36e08375` Document local plan file naming.
- [ ] `904a4e78` Validate command examples.

## Status Transitions
- `pending`: task is not started.
- `in_progress`: one agent owns it and has a lock.
- `blocked`: a named prerequisite is missing.
- `completed`: verification is recorded and accepted.

## Verification
- `python3 .../quick_validate.py skills/todos-plan`
- `todos plans --show 4bc933b6-8b0a-4e38-8807-aa11b034a9af`
```

## Hosted Sync

Hosted sync is explicit. Confirm tenant, auth, and billing before writing.

```bash
platform-todos --json auth status
platform-todos --json auth whoami
platform-todos --json billing status
platform-todos docs catalog --surface api --json
platform-todos docs catalog --surface mcp --json
```

Preview first:

```bash
platform-todos plans generate \
  --org <organization-id> \
  --objective "Create project tasks, dependencies, and verification gates" \
  --dry-run true \
  --approval-before-create true
```

Create only after approval:

```bash
platform-todos plans generate \
  --org <organization-id> \
  --objective "Create project tasks, dependencies, and verification gates" \
  --dry-run false \
  --approval-before-create true
```

For local imports, prefer a dry run and a conflict strategy:

```bash
platform-todos import local-sqlite <manifest.json> \
  --org <organization-id> \
  --dry-run true \
  --conflict-strategy skip \
  --idempotency-key <stable-key>
```

Record evidence on the task: command, status, org/project ID, plan ID, and
artifact path. Do not record API keys, raw tokens, secret values, or private
payloads.

## Worker Routing

Task-triggered launch workers must receive:

- task ID and plan ID
- repo path and allowed paths
- source-of-truth instruction: use Todos CLI, not messages or tmux panes
- native Codewith goal requirement
- validation gates and evidence expectations
- explicit out-of-scope paths
- requirement for adversarial verification before completion

Use isolated work scopes. Do not route new repo-mutating work by pasting prompts
into existing tmux panes. If the routing automation is missing, create a task
for the missing automation instead of using a hidden fallback.

Prompt shape:

```text
Task: <task-id>
Plan: <plan-id>
Repo: <absolute-path>
Allowed paths: <paths>
Out of scope: <paths>
Use Todos CLI as source of truth.
Start a native Codewith goal.
Record verification and changed files on the task before done.
```

## Launch Checklist

For todos.md launch tasks, verify the relevant surfaces and record evidence:

- Auth: `platform-todos auth login`, `auth status`, `auth whoami`, API key
  creation/revocation/rotation.
- Billing: `platform-todos billing status`, `usage`, `checkout`, `portal`,
  Stripe webhook lifecycle, quota errors.
- Plan CRUD: local `todos plans --add/show`, hosted `platform-todos plans
  templates/create/generate/refine`, dry-run before create.
- Hosted runs: list/create/show/logs/artifacts/cancel plus controls, pause,
  resume, emergency stop, usage evidence, and sandbox policy.
- Audit export: redacted export command, hash/manifest evidence, no secrets.
- Storage: signed upload/download/delete/export behavior and quota gates.
- Landing and docs: desktop/mobile screenshot review, docs links, billing entry,
  no unsupported dashboard or OAuth promises.

## Done Criteria

- The plan file is under `.hasna/todos/plans/<project-id>/`.
- Todos CLI reflects the task/plan state.
- Command examples were run or clearly marked illustrative.
- Verification is recorded with `todos record-verification`.
- Changed files and residual risks are noted on the task.
- For substantial work, an adversarial verifier or explicit adversarial
  self-review is reconciled before marking the task done.
