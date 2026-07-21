# V1 Acceptance Criteria

`@hasna/skills` v1 is accepted when an agent can discover, configure, pin, run,
and validate skills through the CLI and MCP server from the public npm package,
with self-hosted execution kept behind explicit setup and auth.

## Product Acceptance

- `hasna/skills` is the canonical open repository.
- `@hasna/skills` is the public npm package.
- Local-only setup works without API credentials.
- Compatible self-hosted APIs such as `https://skills.hasna.xyz` are optional
  API targets over public contracts.
- Provider secrets, billing, tenant, database, and deployment state stay outside
  local projects and source packages unless explicitly part of the deployable
  service.

## CLI Acceptance

- User can run `skills setup --mode local` and get local-only config.
- User can run `skills setup --mode self-hosted --api-url <url>` for
  self-hosted mode.
- Interactive setup recommends self-hosted mode; non-interactive setup remains
  local-safe unless self-hosted mode is explicit.
- User can run `skills auth login --api-key <key>` to verify and store a
  provisioned self-hosted API key.
- User can inspect the bundled self-hosted service status with
  `skills billing status`; commercial billing and checkout/portal behavior are
  operator extensions, not bundled acceptance claims.
- User can list, search, inspect, pin, unpin, quote, validate, and run skills.
- Premium or self-hosted skills fail closed without self-hosted credentials.
- CLI errors are structured and scriptable with `--json`.

## MCP Acceptance

- Agent can list/search/pin skills through MCP tools.
- Agent can inspect docs, requirements, tags, categories, and registry
  resources.
- Agent can inspect primitive tool dependencies and validate primitive coverage
  through MCP tools.
- Agent can request self-hosted execution and receive structured auth or run
  errors.
- MCP tests cover success, error, and remote-only fail-closed behavior.

## Primitive Tool Acceptance

- Public exports expose the primitive tool catalog and per-skill primitive
  dependency APIs.
- `skills tools list`, `skills tools deps <skill>`, and `skills tools validate`
  provide JSON output for agents and launch checks.
- The bundled catalog maps every official skill to at least one primitive tool.
- Gateway-backed and self-hosted runtime skills are marked explicitly so the
  service can route model calls through its configured gateway without
  leaking provider keys into local OSS usage.

## Package Acceptance

- `package.json` has no dependency on private cloud packages or itself.
- Built entrypoints contain no private package, private path, or deployment
  markers.
- Packed output includes public docs, schemas, and local skill source where
  allowed.
- Packed output excludes protected implementation source and secrets.
- Public exports expose reusable registry, config, validation, discovery,
  pricing, feedback, scheduler, and remote-run contract APIs.

## Security Acceptance

- Self-hosted skill source is never installed locally unless the public contract
  explicitly allows it.
- Config validation rejects unknown keys and malformed self-hosted API URLs.
- Remote-only skills do not use test mode as a local execution bypass.
- Package-boundary tests scan metadata, lockfile, packed output, and built
  entrypoints.

## Self-Hosted Service Acceptance

- The self-hosted service exposes health, auth, registry, quote, run, log, and
  artifact APIs.
- Registry availability and quotes come from the executable handler registry,
  not from package catalog metadata.
- The bundled provider-free handlers quote `0 credits`; unsupported handlers
  are unavailable and rejected before queue creation.
- API keys enforce `skills:read`, `runs:read`, `runs:write`, and
  `artifacts:read` at their respective routes.
- Queued and retrying cancellation is terminal, while running cancellation is
  observed atomically before a worker can commit a terminal result.
- The service owns generic account, worker, queue, artifact, secret-reference,
  and deployment state. Credit ledgers, commercial billing, and approval policy
  require an explicit operator extension and are not bundled V1 capabilities.
- Compatible API URLs remain explicit configuration and do not force local users
  onto the self-hosted service.

## Required Gates

All gates must pass from a clean checkout:

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run src/cli/index.tsx -- tools validate --json
bun run build
npm pack --dry-run --json --ignore-scripts
```

On Linux, long test runs should use `systemd-run --user --scope` or an
equivalent memory guard when available.
