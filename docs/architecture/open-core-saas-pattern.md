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
  server requires an explicitly configured origin (`SKILLS_API_URL` or the
  `apiUrl` config key) and `SKILLS_API_KEY`.
- Do not introduce names for deployment variants. Running on this machine is not
  a mode; it is the absence of a configured API origin. Keep domains in
  configurable API URLs.

## OSS Client Surface

Good OSS commands:

- `auth login`, `auth logout`, `auth whoami`
- `billing status`, `billing checkout`, `billing portal`
- `credits buy`
- remote registry, quote, run status, logs, and artifact commands

These commands only call the configured Skills API, print/open returned URLs, and
store scoped local credentials.

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
