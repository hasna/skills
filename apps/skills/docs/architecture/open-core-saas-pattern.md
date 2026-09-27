# Open-Core Hosted Service Pattern

This pattern applies to `hasna/skills` and other open packages that need a hosted
service without making the OSS core depend on one deployment.

## Package Shape

- The OSS package owns local execution, CLI/MCP adapters, public contracts,
  SDK/client helpers, schemas, validation, docs, and local-safe defaults.
- The hosted service owns auth servers, OAuth callbacks, billing, databases,
  workers, queues, deployment, observability, secrets, and entitlement
  enforcement.
- The OSS package can be server-aware, but must remain usable without a hosted
  account.

## Onboarding

- Do not prompt during package install.
- Do not prompt a user to choose a deployment variant. There is one product and
  one deployment story: you run it. Setup asks for an API origin, or for nothing.
- In non-interactive and CI contexts, do not silently phone home. Talking to a
  server requires a credential the shared ladder can resolve; with none, nothing
  is sent and the CLI says it is running locally.
- Do not introduce names for deployment variants. Running on this machine is not
  a mode; it is the absence of a configured API origin. Keep domains in
  configurable API URLs.

## OSS Client Surface

Good OSS commands:

- `login`, `whoami` (also `auth login`, `auth signup`, `auth whoami`) — the
  API-backed auth commands; they call the selected Skills API, print/open
  returned URLs, and store scoped local credentials. With nothing configured,
  sign-in targets the product default (`src/lib/product-default.ts`, owner
  rulings 2026-09-23); a credential that already resolves keeps its own server
- `logout` / `auth logout` — local credential removal (`src/cli/commands/auth.ts`,
  `signOut()` in `src/lib/sign-in.ts`), following Instructions rule
  global-cli-logout-semantics; the only API call is a best-effort revoke of a
  key this CLI's own sign-in minted (or an added key with `--revoke`), sent
  only to the server that issued it
- `run`, `runs list`, `runs show`, `exports open` — local execution and local
  run records (`src/cli/commands/runtime.ts`); they require no API origin
- `runs status`, `exports download` — the remote-client run subcommands; they
  require API access
- `list`/`ls`, `search`/`s`, `categories`, `tags` — the browse surface;
  `getBrowseRegistry()` (`src/lib/read-access.ts`) shares the same authority
  selection with MCP discovery. A configured API is authoritative: these
  commands read only its remote registry, including with `--all` or `--remote`.
  Local drafts and extension folders cannot shadow or join hosted metadata.
  Local authoring discovery requires `HASNA_SKILLS_LOCAL=1` with no authority
  or credential environment variables configured; that explicit local mode
  reads the on-machine registry without HTTP. Configured authority or credential
  environment variables outrank the local opt-in. Missing configuration without
  the opt-in, authentication failures, and network failures fail closed; they
  never fall back to local content. `--remote` requires a configured origin.
- `push`, `pull` — send and fetch corpus skills to/from the configured Skills
  instance (`src/cli/commands/publish.ts`, `src/lib/pull.ts`); they require a
  configured origin
- `registry sync` — generates a deterministic registry sync artifact from the
  local corpus (instance-local)

The CLI ships no billing or credits command namespaces: `no-billing-surface.test.ts`
pins the CLI `--help` surface, the MCP contract, and the server route table to zero
billing/payments vocabulary. Billing, credits, checkout, and portal are the hosted
wrapper's surface, never the OSS package's.

Do not put these in OSS:

- Stripe webhook handlers, price enforcement, ledgers, or customer records
- OAuth provider secrets or callback ownership
- tenant database logic, entitlement source of truth, workers, or queues
- protected server-side source, private prompts, provider routing, or deployment
  automation

## Web App

The hosted web app is the account and billing source of truth. It should expose
login, OAuth, device-code approval, billing portal, credit checkout, API keys,
organizations, runs, artifacts, and audit views over the same APIs that CLI and
MCP call.
