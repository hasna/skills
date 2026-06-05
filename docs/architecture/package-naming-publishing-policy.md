# Package Naming And Publishing Policy

This policy keeps the open `hasna/skills` package, the `skills` CLI, and MCP
setup from colliding with hosted wrappers.

## Canonical Names

| Surface | Name | Owner | Publish Target |
| --- | --- | --- | --- |
| Open repository | `hasna/skills` | Hasna | GitHub |
| Open package | `@hasna/skills` | `hasna/skills` | Public npm package |
| Main CLI | `skills` | `@hasna/skills` | `bin/index.js` |
| MCP CLI | `skills-mcp` | `@hasna/skills` | `bin/mcp.js` |
| Optional hosted API | `skills.md` or compatible URL | Hosted wrapper | Explicit config |

No hosted wrapper or private module should publish to npm as `@hasna/skills`.
Wrappers consume `@hasna/skills` as a normal dependency and keep their service
identity separate.

## Versioning Rules

Use semver for the public package:

- Patch: bug fixes, validation hardening, docs, tests, and non-breaking
  internal refactors.
- Minor: new non-breaking CLI commands, MCP tools, public API exports, or
  registry capabilities.
- Major: breaking CLI/MCP/API behavior, package export removals, or install
  path changes.

If publishing manually, inspect `npm view @hasna/skills version` first and use
the smallest correct bump.

## Publishing Workflow For `@hasna/skills`

Only publish from a clean public-package branch:

1. Confirm the branch contains only reusable package changes.
2. Run the public-boundary marker check.
3. Run `bun run typecheck`.
4. Run guarded `bun test`.
5. Run `bun run build`.
6. Run `npm pack --dry-run --json --ignore-scripts`.
7. Commit with a conventional commit message and push.
8. Check the current published version with `npm view @hasna/skills version`.
9. Bump the smallest correct semver version.
10. Run the gates again after the version bump.
11. Publish with `npm publish`.
12. Refresh the local global install with `bun install -g @hasna/skills`.
13. Verify `skills --version`, `skills --help`, `skills setup --mode local
    --json`, and `skills-mcp --help`.

Do not publish private cloud dependencies, protected hosted source, account
state, billing logic, tenant logic, or deployment assumptions in the public npm
package.

## Local Install Refresh

After publishing `@hasna/skills`, refresh the local command:

```bash
bun install -g @hasna/skills
skills --version
skills --help
skills setup --mode local --json
skills registry sync --profile basic --no-docs --no-requirements --no-validation --json
```

This verifies the package tarball, CLI bin, MCP bin, and registry artifact path.

## Commit Policy

Use conventional commits:

- `feat:` for new commands or public APIs.
- `fix:` for bug fixes.
- `docs:` for documentation-only changes.
- `test:` for test-only changes.
- `chore:` for maintenance and release work.

Do not add `Co-Authored-By` trailers. Run staged whitespace and secret checks
before every commit.
