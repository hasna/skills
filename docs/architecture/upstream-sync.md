# Public Boundary Sync Workflow

Use this workflow when a hosted wrapper or private integration produces a
generic engine change that should land in `hasna/skills`.

## Principles

- Do not use git worktrees.
- Move only reusable skill engine changes into the public repo.
- Keep private product code, deployment config, billing, database, account
  state, and hosted execution code out of public commits.
- Treat the public package as local-first; remote mode remains optional.

## Preflight

Inspect the candidate range:

```bash
scripts/check_upstream_sync.sh main..HEAD
```

Use strict marker mode before opening a public PR or publishing:

```bash
scripts/check_upstream_sync.sh --strict-private-markers main..HEAD
```

The preflight checks for private product paths and warns about private marker
strings such as private package dependencies, protected hosted paths, deployment
commands, payment env names, tenants, billing, and production deploy wording.

## Prepare A Branch

Create a clean public branch from the current public base:

```bash
git fetch origin
git switch -c public/<topic> origin/main
git cherry-pick <generic-commit-sha>
```

Cherry-pick one logical generic commit at a time. Resolve conflicts as public
package decisions, not hosted product decisions.

## Required Gates

Run the package gates on the public branch:

```bash
bun run typecheck
bun test
bun run build
npm pack --dry-run --json --ignore-scripts
```

On Linux, run long test suites through the configured memory guard or an
equivalent `systemd-run --user --scope` cgroup.

## PR Checklist

The public PR description must include:

- The exact reusable problem being solved.
- The public package APIs or CLI/MCP contracts changed.
- The tests and build commands that passed.
- Confirmation that private product paths, private dependencies, protected
  source, and deployment secrets are not included.
