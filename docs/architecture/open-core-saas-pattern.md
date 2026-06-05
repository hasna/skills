# Open-Core SaaS Pattern

This pattern applies to `hasna/skills` and other open packages that need a
hosted product without making the OSS core depend on the hosted product.

## Package Shape

- The OSS package owns local execution, CLI/MCP adapters, public contracts,
  SDK/client helpers, schemas, validation, docs, and local-safe defaults.
- The hosted platform owns auth servers, OAuth callbacks, billing, databases,
  workers, queues, deployment, observability, secrets, and entitlement
  enforcement.
- The OSS package can be hosted-aware, but must remain usable without a hosted
  account.

## Onboarding

- Do not prompt during package install.
- On first interactive setup, recommend `hosted` when the hosted product is the
  primary commercial path.
- In non-interactive and CI contexts, do not silently phone home. Require
  explicit hosted mode, `SKILLS_API_URL`, or `SKILLS_API_KEY`.
- Use generic mode names such as `hosted` and `local`; keep domains in
  configurable API URLs.

## OSS Client Surface

Good OSS commands:

- `auth login`, `auth logout`, `auth whoami`
- `billing status`, `billing checkout`, `billing portal`
- `credits buy`
- remote registry, quote, run status, logs, and artifact commands

These commands only call hosted APIs, print/open returned URLs, and store scoped
local credentials.

Do not put these in OSS:

- Stripe webhook handlers, price enforcement, ledgers, or customer records
- OAuth provider secrets or callback ownership
- tenant database logic, entitlement source of truth, workers, or queues
- protected hosted source, private prompts, provider routing, or deployment
  automation

## Web App

The hosted web app is the account and billing source of truth. It should expose
login, OAuth, device-code approval, billing portal, credit checkout, API keys,
organizations, runs, artifacts, and audit views over the same APIs that CLI and
MCP call.
