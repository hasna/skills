# Package Naming And Publishing Policy

This policy keeps the open `hasna/skills` package, the `skills` CLI, and MCP
setup from colliding with remote operators. Canonical deployment ownership and
mode semantics are defined in
[Open Product Three-Mode Contract](open-product-three-mode-contract.md) and
[Package Ownership And Sync Strategy](package-ownership-sync-strategy.md).

## Canonical Names

| Surface | Name | Owner | Publish Target |
| --- | --- | --- | --- |
| Open repository | `hasna/skills` | Hasna | GitHub |
| Open package | `@hasna/skills` | `hasna/skills` | Public npm package |
| Main CLI | `skills` | `@hasna/skills` | `bin/index.js` |
| MCP CLI | `skills-mcp` | `@hasna/skills` | `bin/mcp.js` |
| Hasna cloud SaaS | `skills.md` | Hasna cloud composition | Explicit enrolled `cloud` profile |
| Compatible operator API | Operator-chosen URL | Operator selfhost composition | Explicit enrolled `selfhost` profile |

No cloud or selfhost composition should publish to npm as `@hasna/skills`.
Compositions consume `@hasna/skills` as a normal dependency and keep their
service identity separate. `skills.md` always names the Hasna-operated
multi-tenant customer SaaS (`cloud`); a compatible operator URL is `selfhost`,
even when Hasna operates it internally or it runs in a public cloud.

## Versioning Rules

Use semver for the public package:

- Patch: bug fixes, validation hardening, docs, tests, and non-breaking
  internal refactors.
- Minor before `1.0.0`: new non-breaking CLI commands, MCP tools, public API
  exports, or registry capabilities, and any breaking CLI/MCP/API behavior,
  package export removal, or install-path change.
- Major at `1.0.0` and later: breaking CLI/MCP/API behavior, package export
  removals, or install-path changes.

If publishing manually, inspect `npm view @hasna/skills version` first and use
the smallest correct bump.

## Publishing Workflow For `@hasna/skills`

The release channel is deliberately staged: **next -> platform live proof -> latest**.
The protected manual publish workflow runs only from `main` and publishes exact
version `0.2.0` to `next`; it never updates `latest`. The operator must supply
the exact version and the explicit `publish-0.2.0-to-next` confirmation. The job
uses the `production` GitHub environment because its npm credential is protected
there, while provenance remains enabled. A tag is release metadata, not the
authorization or execution trigger for npm publication.
After the platform proves the exact `next` artifact against the live Skills SaaS,
an operator may run the manual `Promote npm prerelease to latest` workflow. That
workflow compares npm integrity metadata, installs the exact artifact into an
isolated directory, runs CLI smoke checks, and moves only the dist-tag. It does
not rebuild or republish the package.

The promotion job uses the existing `production` GitHub environment. Its
operator supplies the exact platform commit SHA, live platform version, and
client pin expected from the deployed service. The job requires the public
version and health documents to report that same immutable commit SHA; this is
the deployment identity proof and does not require a cross-repository GitHub
token. `SKILLS_PROMOTION_API_KEY` is a dedicated
least-privilege production-environment secret used only for read-only contract
proof. The gate validates catalog, detail, quote, run, and usage responses
with the same strict endpoint schemas used by the SDK, including nested tool
and connector metadata, the live client pin, availability, and the credits-only
contract before touching `latest`.
The dedicated promotion identity must expose the platform-seeded, provider-free
credit lifecycle: a completed `logo-design` run with `creditsUsed: 1` and its
linked `amountCredits: -1` debit receipt. The platform seeder proves the bounded
grant, deterministic pre-provider failure and refund, exact balance restoration,
and no-provider invariant; those internal markers remain private. The client
validator searches the bounded public run and usage pages for the linked
completed-run/debit pair, so empty arrays or unrelated historical records cannot
satisfy the gate and the proof itself never invokes a provider.
Any missing proof or mismatch refuses promotion.

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
11. Run the protected manual `Publish npm prerelease (next)` workflow from
    `main` with version `0.2.0` and confirmation `publish-0.2.0-to-next`; the
    workflow publishes with `npm publish --tag next --provenance`.
12. Complete platform live proof against that exact npm artifact.
13. Use the protected manual promotion workflow to move that same artifact to
    `latest`; never rebuild between proof and promotion.
14. Refresh the local global install with `bun install -g @hasna/skills`.
15. Verify `skills --version`, `skills --help`, `skills setup --mode local
    --json`, and `skills-mcp --help`.

Do not publish private cloud dependencies, protected hosted source, Hasna
customer-account or organization topology, Hasna billing implementation,
commercial tenancy policy, managed production operations, provider credentials,
or private deployment configuration in the public npm package. Generic auth,
API-key, tenant-isolation, observability, and provider-neutral opt-in selfhost
contracts belong in the open package when they are reusable and independently
deployable.

Customer catalog, quote, run, usage, and receipt surfaces describe execution in
credits only. They never expose fiat amounts, provider economics, margins, or
execution-vendor routing. Currency belongs only on the checkout and legal
receipt for purchasing credits; market-research skills may still analyze the
domain concept of competitor pricing.

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
