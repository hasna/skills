# Package Naming And Publishing Policy

This policy keeps the open `hasna/skills` package, the private
`hasnatools/platform-skills` SaaS product, and local agent MCP setup from
colliding.

## Canonical Names

| Surface | Name | Owner | Publish Target |
| --- | --- | --- | --- |
| Open package | `@hasna/skills` | `hasna/skills` | Public npm package |
| Main CLI | `skills` | `@hasna/skills` | `bin/index.js` |
| MCP CLI | `skills-mcp` | `@hasna/skills` | `bin/mcp.js` |
| Private SaaS repo | `hasnatools/platform-skills` | Hasna Tools | GitHub/ECR/AWS, not npm by default |
| Production domain | `skills.md` | Hasna Tools | Route 53/ACM/AWS deploy |
| Local dev port | `3505` | Hasna Tools | Local web/API development |

No private SaaS module should publish to npm as `@hasna/skills`. The SaaS
workspace root package is `@hasnatools/platform-skills`, and it consumes
`@hasna/skills` as a normal dependency for upstream engine APIs.

## Versioning Rules

### `@hasna/skills`

Use semver for the public package:

- Patch: bug fixes, validation hardening, docs, tests, non-breaking internal
  refactors.
- Minor: new non-breaking CLI commands, MCP tools, public API exports, or skill
  registry capabilities.
- Major: breaking CLI/MCP/API behavior, package export removals, or install
  path changes.

The existing auto-version policy may bump `feat:` commits as minor and `fix:`
commits as patch. If publishing manually, inspect `npm view @hasna/skills
version` first and use the smallest correct bump.

### `hasnatools/platform-skills`

The SaaS app is deployed by immutable container image and release tag, not by
npm package version. Use git SHA, ECR image digest, and release tags as
deployment identity. Internal package versions can remain workspace-private
unless a package is explicitly published for reuse.

## Publishing Workflow For `@hasna/skills`

Only publish from a clean upstream-compatible branch:

1. Confirm the branch contains only public package changes.
2. Run the upstream private-marker check.
3. Run `bun run typecheck`.
4. Run guarded `bun test`.
5. Run `bun run build`.
6. Commit with a conventional commit message and push.
7. Check the current published version with `npm view @hasna/skills version`.
8. Bump the smallest correct semver version.
9. Run the gates again after the version bump.
10. Publish with `npm publish`.
11. Refresh the local global install with `bun install -g @hasna/skills`.
12. Verify `skills --version`, `skills --help`, `skills-mcp`, and
    `skills registry sync --profile basic --no-docs --no-requirements
    --no-validation --json`.

Do not publish private SaaS commits, Stripe code, AWS config, PostgreSQL
schema, tenant logic, or `skills.md` deployment assumptions in the public npm
package.

## Private SaaS Release Workflow

The private product release is separate:

1. Merge only after CI, security checks, and app tests pass.
2. Build immutable ECR images.
3. Deploy PR previews for pull requests.
4. Deploy production only from gated release tags.
5. Run migrations and seeds as one-shot jobs.
6. Run smoke tests against the deployed URL.
7. Keep rollback tied to the previous image digest and migration plan.

No private SaaS release requires `npm publish` unless an explicitly reusable
package is created.

## Local Install Refresh

After publishing `@hasna/skills`, refresh the local command:

```bash
bun install -g @hasna/skills
skills --version
skills --help
skills registry sync --profile basic --no-docs --no-requirements --no-validation --json
```

This verifies the package tarball, the CLI bin, and the registry artifact path
that the SaaS will later consume.

## Repo Bootstrap Guardrail

Product work must stay clearly separated from the public package. The private
workspace boundary is:

- Keep the private root package away from `@hasna/skills`.
- Keep `@hasna/skills` as a dependency.
- Route SaaS imports of upstream registry, docs, validation, and run-state APIs
  through `src/platform/upstream/skills.ts`.
- Keep upstream-compatible package work isolated for cherry-pick into
  `hasna/skills`.
- Keep private deployment and billing code out of upstream package exports.

## Commit Policy

Use conventional commits:

- `feat:` for new commands, public APIs, or SaaS features.
- `fix:` for bug fixes.
- `docs:` for documentation-only changes.
- `test:` for test-only changes.
- `chore:` for maintenance and release work.

Do not add `Co-Authored-By` trailers. Run staged whitespace and secret checks
before every commit.
