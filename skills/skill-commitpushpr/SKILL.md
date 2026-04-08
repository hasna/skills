---
name: skill-commitpushpr
description: Create logical commits from all changes, push to a new branch, and open a pull request on GitHub. Groups related changes into separate commits with conventional commit messages. Use when you want to submit changes for review via PR instead of pushing directly to main.
user_invocable: true
---

# Commit, Push & Create PR

Create logical, well-organized commits from the current working directory changes, push to a feature branch, and open a pull request.

## Workflow

1. Analyze changes with `git status` and `git diff --stat`.
2. Determine a descriptive branch name:
   - `type/short-description`
   - if already on a non-main branch, use it
3. Create and switch to that branch if you are on `main`
4. Group related changes into logical commits
5. Skip temp or generated files:
   - `.agents-data/`, `.tmp/`, uploaded blobs
   - non-package-manager lockfiles
   - `.claude/scheduled_tasks.lock`
6. Stage specific files and commit with conventional messages
7. Push with `git push -u origin <branch-name>`
8. Create a PR with `gh pr create`
9. Report the commits created and the PR URL

## Commit message format

```text
type: concise description of the change

Optional body explaining why the change was made,
not what was changed.
```

## PR body format

```markdown
## Summary
- bullet points

## Test plan
- [ ] checklist items
```

## Rules

- Never use `git add .` or `git add -A`
- Never commit secrets, `.env` files, or credentials
- Never amend existing commits unless the user explicitly asks
- Never force-push
- Never push directly to `main`
- If there are no changes, say so and stop
- If already on a feature branch, reuse it
