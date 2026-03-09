---
name: skill-scancommitpr
description: Scan repo for all changes, group them into logical commits, push to GitHub, and optionally create a pull request. Only creates a PR when the user explicitly asks for one.
---

# Scan, Commit, Push & PR

This skill performs the full scan/commit/push workflow and additionally offers to create a pull request on GitHub.

**IMPORTANT**: Only create a PR if the user explicitly asked for one. If the user just said "commit" or "push", do NOT create a PR.

## Phase 1: Scan, Commit & Push

Follow ALL steps from the scancommitpush workflow:

### Step 1: Pre-flight Checks

1. **Verify git repo**: `git rev-parse --git-dir`. If not a repo, stop.
2. **Check merge conflicts**: `git diff --name-only --diff-filter=U`. If any, stop and report.
3. **Check branch**: `git branch --show-current`. Warn on detached HEAD.
4. **Check remote**: `git remote -v`. If none, stop.
5. **Check upstream**: `git rev-parse --abbrev-ref @{upstream} 2>/dev/null`. Note if missing.

### Step 2: Scan All Changes

1. `git status` (no `-uall` flag) — note staged, unstaged, untracked.
2. `git diff --stat` — unstaged summary.
3. `git diff --cached --stat` — staged summary.
4. If no changes: "Working tree is clean. Nothing to commit." Stop.
5. Detect and exclude sensitive files (.env, *.pem, *.key, credentials.json, .secrets/).

### Step 3: Group Changes into Logical Commits

Group by priority:
1. **Feature/functionality** — related files implementing one feature/fix together
2. **Type** — config, docs, deps, refactor, tests each separate
3. **Scope** — unrelated areas get separate commits
4. **Single-file** — lone changes get own commit

When in doubt, split. Lockfiles go with their package.json. Test files go with the code they test.

### Step 4: Create Commits

For each group, in dependency order:

1. Stage specific files: `git add <file1> <file2>` — NEVER `git add .`
2. Commit with conventional message format:
   ```
   <type>: <imperative summary, max 72 chars>

   <optional WHY body>

   Co-Authored-By: Claude <noreply@anthropic.com>
   ```
   Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `style`, `perf`
3. Use HEREDOC for commit message.
4. Verify with `git log --oneline -1`.

### Step 5: Push to Remote

- No upstream: `git push -u origin <branch>`
- Has upstream: `git push`
- NEVER force push unless explicitly asked.
- Report failures clearly (rejected, auth, permissions).

### Step 6: Summary

List all commits with hashes, types, summaries, and file counts.

---

## Phase 2: Pull Request Creation (Conditional)

**Only proceed if the user explicitly requested a PR.**

### Decision Tree

```
User says "commit" or "push"           -> Phase 1 ONLY, no PR
User says "commit and push"            -> Phase 1 ONLY, no PR
User says "commit and create a PR"     -> Phase 1 + Phase 2
User says "push and open a PR"         -> Phase 1 + Phase 2
User says "create a PR"                -> Phase 1 + Phase 2
User says "PR" or "pull request"       -> Phase 1 + Phase 2
```

If the user did NOT ask for a PR, stop after Phase 1. Do NOT ask "would you like me to create a PR?" — just stop.

### Step PR-1: Determine Base Branch

1. Current branch should NOT be `main` or `master`. If it is, warn: "You are on the main branch. PRs are typically created from feature branches. Proceed anyway?"

2. Find base branch:
   ```bash
   git rev-parse --verify origin/main 2>/dev/null && echo "main" || git rev-parse --verify origin/master 2>/dev/null && echo "master"
   ```
   If neither exists, ask the user.

3. Check for existing PR: `gh pr list --head <current-branch> --state open`. If PR exists: "A PR already exists for this branch: <url>. New commits have been pushed to it." Stop.

### Step PR-2: Gather PR Information

1. Get full diff: `git log --oneline <base>..HEAD` — ALL commits on this branch, not just new ones.

2. Analyze all commits to understand the full PR scope.

3. Draft PR title:
   - Under 72 characters
   - Imperative mood
   - Specific, not just concatenated commit messages

4. Draft PR body:
   ```markdown
   ## Summary
   <1-3 bullet points: what and why>

   ## Changes
   <Key changes, grouped logically>

   ## Test plan
   <Testing steps checklist>

   Generated with [Claude Code](https://claude.ai/code)
   ```

### Step PR-3: Create the PR

```bash
gh pr create --title "<title>" --body "$(cat <<'EOF'
<PR body>
EOF
)"
```

Handle errors:
- **`gh` not installed**: "Install GitHub CLI: `brew install gh` or https://cli.github.com"
- **Not authenticated**: "Run `gh auth login`"
- **No permission**: "You may not have PR access to this repository"

Do NOT add labels, reviewers, or assignees unless asked. Do NOT auto-merge.

### Step PR-4: Final Summary

```
Committed and pushed to <branch>:

1. <hash> <type>: <summary> (N files)
2. <hash> <type>: <summary> (N files)

Total: X commits, Y files changed

Pull Request created:
  Title: <title>
  URL: <url>
  Base: <base> <- <branch>
```

## Edge Cases

| Situation | Action |
|-----------|--------|
| On main/master | Warn, ask before creating PR |
| PR already exists | Report URL, don't create duplicate |
| `gh` not installed | Provide install instructions |
| `gh` not authenticated | Tell user to run `gh auth login` |
| No diff between branch and base | "No differences. Nothing to PR." |
| Draft PR requested | Use `gh pr create --draft` |
| Specific reviewers requested | Use `--reviewer` flag |
| Fork workflow | Use `gh pr create --head <user>:<branch>` |

## Safety Rules

All scancommitpush safety rules apply, plus:
- **NEVER** create a PR without explicit user request
- **NEVER** auto-merge PRs
- **NEVER** force push to create a clean PR
- **NEVER** modify commit history to make the PR "look better"
- **NEVER** add labels or reviewers unless asked
