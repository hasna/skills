# V1 Acceptance Criteria

`@hasna/skills` v1 is accepted when an agent can discover, configure, pin, run,
and validate skills through the CLI and MCP server from the public npm package,
with hosted execution kept behind explicit setup and auth.

## Product Acceptance

- `hasna/skills` is the canonical open repository.
- `@hasna/skills` is the public npm package.
- Local-only setup works without API credentials.
- Compatible hosted APIs such as skills.md are optional wrappers over public
  contracts.
- Private worker, billing, tenant, database, and deployment state stay outside
  the OSS package.

## CLI Acceptance

- User can run `skills setup --mode local` and get local-only config.
- User can run `skills setup --mode hosted --api-url <url>` for hosted mode.
- Interactive setup recommends hosted mode; non-interactive setup remains
  local-safe unless hosted mode is explicit.
- User can run `skills auth login` for browser/device-code auth.
- User can inspect hosted account state with `skills billing status` and create
  hosted checkout/portal URLs with billing or credit commands.
- User can list, search, inspect, pin, unpin, quote, validate, and run skills.
- Premium or hosted skills fail closed without hosted credentials.
- CLI errors are structured and scriptable with `--json`.

## MCP Acceptance

- Agent can list/search/pin skills through MCP tools.
- Agent can inspect docs, requirements, tags, categories, and registry
  resources.
- Agent can inspect primitive tool dependencies and validate primitive coverage
  through MCP tools.
- Agent can request hosted execution and receive structured auth or remote-run
  errors.
- MCP tests cover success, error, and remote-only fail-closed behavior.

## Primitive Tool Acceptance

- Public exports expose the primitive tool catalog and per-skill primitive
  dependency APIs.
- `skills tools list`, `skills tools deps <skill>`, and `skills tools validate`
  provide JSON output for agents and launch checks.
- The bundled catalog maps every official skill to at least one primitive tool.
- Gateway-backed and hosted-runtime skills are marked explicitly so hosted
  wrappers can route model calls through their configured gateway without
  leaking provider keys into local OSS usage.

## Package Acceptance

- `package.json` has no dependency on private cloud packages or itself.
- Built entrypoints contain no private package, private path, or deployment
  markers.
- Packed output includes public docs, schemas, and local skill source where
  allowed.
- Packed output excludes protected hosted implementation source.
- Public exports expose reusable registry, config, validation, discovery,
  pricing, feedback, scheduler, and remote-run contract APIs.

## Security Acceptance

- Hosted skill source is never installed locally unless the public contract
  explicitly allows it.
- Config validation rejects unknown keys and malformed hosted API URLs.
- Remote-only skills do not use test mode as a local execution bypass.
- Package-boundary tests scan metadata, lockfile, packed output, and built
  entrypoints.

## Hosted Wrapper Acceptance

- Hosted wrappers consume public package APIs rather than importing CLI or MCP
  internals.
- Hosted wrappers own account state, billing, approvals, workers, secrets, and
  deployments.
- Hosted wrappers can expose compatible API URLs without forcing OSS users onto
  a single hosted service.

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
