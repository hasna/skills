# Public Boundary Sync Workflow

Use this workflow when a hosted wrapper or private integration produces a
generic engine change that should land in `hasna/skills`.

## Principles

- Do not use git worktrees.
- Move reusable client, embedded-engine, and provider-neutral server changes
  into the public repo. The generic server, workers, queues, persistence
  adapters, migrations, shared contracts, and selfhost deployment artifacts
  are OSS-owned surfaces.
- Keep only Hasna SaaS-specific code and configuration out of public commits:
  customer tenant topology, Hasna billing and entitlements, private provider
  routing, managed production infrastructure, credentials, support tooling,
  and cloud-only operational policy.
- Treat the public package as local-first; remote mode remains optional.

The canonical ownership and mode semantics are defined in
[Open Product Three-Mode Contract](open-product-three-mode-contract.md) and
[Package Ownership And Sync Strategy](package-ownership-sync-strategy.md).
This workflow must not be interpreted as moving generic server execution or
database code into the platform repository.

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
strings such as private package dependencies, protected cloud paths, Hasna
payment env names, customer tenancy, and production SaaS deploy wording. A
generic server, worker, queue, persistence adapter, migration, or selfhost
deployment contract is not private merely because it runs remotely.

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
  source, SaaS-specific configuration, and deployment secrets are not included.
