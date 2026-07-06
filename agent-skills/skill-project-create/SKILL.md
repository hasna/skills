---
name: skill-project-create
description: Bootstrap a brand-new Hasna repo project or work project with the current `projects create`/`start` workflow, register todos/conversations, create the project's conversations channel, and preserve the intended category and naming convention.
user_invocable: true
---

# skill-project-create

Create a new project end to end: folder, Projects registry row, todos tracking,
the project conversations channel, and launch session. First classify it as a
repo project or work project.

## Inputs

- Name or idea from the user.
- Description derived from the prompt.
- Division/root, inferred when obvious.
- Category: repo project or work project.

## Naming

Repo projects are code repositories/apps such as `open-*`, platform repos, and
internal apps. Work projects are business/research/operations folders under
`.../project/<project-name>`.

For new work projects, follow the user's requested name and the local root
convention. Existing work folders may already use `project-*`; do not rename or
collapse those names during import. For new repo projects, use the repo's naming
convention, such as `open-<name>` for Hasna OSS apps.

The project channel is named after the slug (flat repo name for repo projects).
Channel class for the topic line: `package` for `open-*` and other repo/package
projects, `product` for `platform-*`/`iapp-*`/`cweb-*`/`community-*`, and
`initiative` for work projects (`oss-*`/`internal-*`/`research-*`) — initiative
topics must carry `owner:<agent> until:<date|gate-id>`. When the installed
conversations CLI supports `--class` on `channel create` (newer than 0.3.3),
pass `--class <package|product|initiative>` as well so the class lands in
`metadata.channel_schema.class`; the topic line stays either way.

## Workflow

```bash
export HASNA_PROJECTS_DB_PATH="$HOME/.hasna/projects/projects.db"
export HASNA_PROJECTS_HOME="$HOME/.hasna/projects"
projects roots list --json
mkdir -p "<path>"
projects create \
  --name "<Name>" \
  --slug "<slug>" \
  --path "<path>" \
  --kind "<project|open-source|internal-app|platform>" \
  --description "<description>" \
  --tmux
todos projects --add "<path>" --name "<slug>"
# Every project has a conversations channel — create it if missing, then join.
# "Already exists" is fine; join and continue.
conversations channel create "<slug>" \
  --description "<description>" \
  --topic "class:<package|product|initiative> owner:<agent>" \
  --from <agent>
conversations channel join "<slug>" --from <agent>
conversations send "project created: <slug> — <description>" \
  --channel "<slug>" --from <agent>
projects show "<slug>" --json
projects status "<slug>" --json
projects context "<slug>" --for-agent
```

Use `projects publish <slug>` only for repo projects and only when the user wants
a GitHub repository now.

The project channel is the project's coordination home from this point on:
post there when you claim a task, get blocked, hit a milestone, or finish
(max 3 lines: task id, state, next step).

## Safety

- Keep secrets out of the repo; use vaults or gitignored `.secrets/`.
- `cleanup-create` is for rollback of a creation run only; do not use it for
  imported rows.
- Do not delete source directories without backup and a clear registry/import
  undo plan.
- Store/canvas/loop commands are allowed only when `projects --help` on the
  active machine shows `store`, `canvases`, and `loops`.

## Done When

The folder exists, `projects show` resolves it, `projects status` reports the
launch state, todos is registered, the project conversations channel exists
with you joined and the creation message posted, and the description and path
are reported.
