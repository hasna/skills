# Open-Core Self-Hosted Service Pattern

This pattern applies to `hasna/skills` and other open packages that need a
self-hosted service without making the OSS core depend on one deployment.

## Package Shape

- The OSS package owns local execution, CLI/MCP adapters, public contracts,
  SDK/client helpers, schemas, validation, docs, and local-safe defaults.
- The self-hosted service owns auth servers, OAuth callbacks, billing, databases,
  workers, queues, deployment, observability, secrets, and entitlement
  enforcement.
- The OSS package can be self-hosted-aware, but must remain usable without a self-hosted
  account.

## Onboarding

- Do not prompt during package install.
- On first interactive setup, recommend `self-hosted` when the Hasna-owned AWS
  service is the primary path.
- In non-interactive and CI contexts, do not silently phone home. Require
  explicit self-hosted mode, `SKILLS_API_URL`, or `SKILLS_API_KEY`.
- Use canonical mode names `self-hosted` and `local`; keep domains in
  configurable API URLs.

## OSS Client Surface

Good OSS commands:

- `auth login`, `auth logout`, `auth whoami`
- `billing status`, `billing checkout`, `billing portal`
- `credits buy`
- remote registry, quote, run status, logs, and artifact commands

These commands only call self-hosted APIs, print/open returned URLs, and store scoped
local credentials.

Do not put these in OSS:

- Stripe webhook handlers, price enforcement, ledgers, or customer records
- OAuth provider secrets or callback ownership
- tenant database logic, entitlement source of truth, workers, or queues
- protected server-side source, private prompts, provider routing, or deployment
  automation

## Web App

The self-hosted web app is the account and billing source of truth. It should expose
login, OAuth, device-code approval, billing portal, credit checkout, API keys,
organizations, runs, artifacts, and audit views over the same APIs that CLI and
MCP call.
