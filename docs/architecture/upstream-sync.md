# Upstream Sync Workflow

Use this workflow when a change made in `hasnatools/platform-skills` should be
proposed back to the open `hasna/skills` repository.

## Principles

- Do not use git worktrees.
- Keep `origin` pointed at `hasnatools/platform-skills`.
- Keep `upstream` pointed at `hasna/skills`.
- Move only generic skill engine changes upstream.
- Keep private product code, deployment config, billing, database, and hosted
  execution code out of upstream PRs.

## Preflight

Fetch both remotes and inspect the candidate range:

```bash
git fetch origin upstream
bun run upstream:check upstream/main..HEAD
```

Use strict marker mode before opening an upstream PR:

```bash
bun run upstream:check -- --strict-private-markers upstream/main..HEAD
```

The preflight verifies the remotes, rejects private product paths, and warns
about private marker strings such as `skills.md`, `hasnatools`, Stripe,
PostgreSQL, AWS, tenants, billing, and deployment wording.

## Prepare A Branch

Create the upstream PR branch directly in this repository:

```bash
git fetch upstream origin
git switch -c upstream/<topic> upstream/main
git cherry-pick <generic-commit-sha>
```

Cherry-pick one logical generic commit at a time. Resolve conflicts as upstream
package decisions, not private product decisions.

## Required Gates

Run the package gates on the upstream branch:

```bash
bun run typecheck
bun test
bun run build
```

On Linux, run `bun test` through the configured memory guard or an equivalent
`systemd-run --user --scope` cgroup.

## Push And PR

Push the branch to `hasna/skills` when the upstream remote is writable:

```bash
git push upstream upstream/<topic>
```

If direct upstream push is not available, push a branch to the private origin
for review and manually open the upstream PR from the same commit set.

The upstream PR description must include:

- The exact generic problem being solved.
- The public package APIs or CLI/MCP contracts changed.
- The tests and build commands that passed.
- Confirmation that private SaaS paths and secrets are not included.

## Return To Product Work

After preparing or opening the upstream PR:

```bash
git switch main
git pull --ff-only origin main
```

Keep product work on `origin/main` unless actively preparing an upstream PR.
