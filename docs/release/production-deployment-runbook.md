# Production Deployment Runbook

This runbook is the release checklist for deploying `skills.md` production from
`hasnatools/platform-skills` into AWS account `059898286899`.

## Current Blocker

Production is not deployable until `skillsmd/production/stripe` contains valid
live Stripe material:

- `STRIPE_SECRET_KEY` as `sk_live_...` or `rk_live_...`
- `STRIPE_PUBLISHABLE_KEY` as `pk_live_...`
- `STRIPE_WEBHOOK_SECRET` as `whsec_...`
- `STRIPE_PRO_PRICE_ID`
- `STRIPE_CREDIT_1_PRICE_ID`
- `STRIPE_CREDIT_5_PRICE_ID`
- `STRIPE_CREDIT_20_PRICE_ID`
- `STRIPE_CREDIT_50_PRICE_ID`
- `STRIPE_CREDIT_100_PRICE_ID`

The configured Stripe CLI live key on `spark02` is currently rejected by Stripe,
so the production Stripe bootstrap cannot complete from this machine until a
valid live key is supplied.

AWS Secrets Manager currently has only `AWSCURRENT` and `AWSPREVIOUS` versions
for `skillsmd/production/stripe`; both versions are placeholder-shaped for every
required Stripe field, so there is no hidden version to promote.

GitHub issue `#1` tracks the live Stripe handoff and production deploy
completion gate.

## Production Stripe Handoff

The remaining production handoff is to provide live Stripe material. Do not copy
test-mode values from `skillsmd/preview/stripe`, and do not paste keys into
tickets, chat, logs, or commits.

Required live inputs:

- Live secret key: `sk_live_...` or restricted key: `rk_live_...`
- Live publishable key: `pk_live_...`
- The Stripe account must be able to create products, prices, and webhook
  endpoints.

After those values are available in the shell, run the live bootstrap exactly
once from a trusted machine:

```bash
STRIPE_API_KEY=sk_live_... \
STRIPE_PUBLISHABLE_KEY=pk_live_... \
AWS_PROFILE=hasnatools \
AWS_REGION=us-east-1 \
bun run aws:bootstrap:production-stripe
```

The bootstrap writes the final AWS secret and produces these values in
`skillsmd/production/stripe` without printing them:

- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_ACCOUNT_ID`
- `STRIPE_PRO_PRICE_ID`
- `STRIPE_CREDIT_1_PRICE_ID`
- `STRIPE_CREDIT_5_PRICE_ID`
- `STRIPE_CREDIT_20_PRICE_ID`
- `STRIPE_CREDIT_50_PRICE_ID`
- `STRIPE_CREDIT_100_PRICE_ID`

Then verify the production Stripe gate without deploying traffic:

```bash
AWS_PROFILE=hasnatools AWS_REGION=us-east-1 bash scripts/production_validate_secrets.sh
```

Only after that command passes should the production deploy workflow be rerun.

## One-Time Bootstrap

Run these from the repository root with the `hasnatools` AWS profile:

```bash
bun run aws:bootstrap:data
bun run aws:bootstrap:ecr
bun run aws:bootstrap:ecs
bun run aws:bootstrap:github-oidc
bun run aws:bootstrap:s3
bun run aws:bootstrap:secrets
bun run aws:bootstrap:production-edge
```

Production edge has already been created on `2026-05-09`:

- `skillsmd-production` ALB is active.
- HTTP redirects to HTTPS.
- HTTPS listener exists.
- ACM certificate for `skills.md` and `www.skills.md` is issued.
- Cloudflare DNS validation and application records exist.

Production runtime secret validation also requires OTP email configuration for
CLI login:

- `RESEND_API_KEY`
- `FROM_EMAIL`

As of `2026-05-09`, `skillsmd/production/runtime/env` contains valid runtime
shape for database, Redis, auth, worker, and email settings. Keep
`bash scripts/production_validate_runtime_secrets.sh` green before every deploy.

## Stripe Bootstrap

After a valid live Stripe key is available, run:

```bash
STRIPE_API_KEY=sk_live_... \
STRIPE_PUBLISHABLE_KEY=pk_live_... \
AWS_PROFILE=hasnatools \
AWS_REGION=us-east-1 \
bun run aws:bootstrap:production-stripe
```

The script creates or reuses live Stripe products, prices, and webhook endpoint,
then writes `skillsmd/production/stripe` in AWS Secrets Manager. It refuses test
keys, verifies the key can retrieve a live Stripe account before any mutation,
and does not print secrets. Reruns also update the existing webhook endpoint and
disable duplicate enabled endpoints for the same URL.

The production webhook must be enabled for every event the billing API handles:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

## Stripe Custom Domain

Stripe custom domain `pay.hasna.tools` is active for customer-visible hosted
billing flows. Production smoke tests must verify the hosted URLs returned by
Stripe use these shapes:

- Checkout: `https://pay.hasna.tools/c/...`
- Payment Links: `https://pay.hasna.tools/b/...`
- Customer Portal: `https://pay.hasna.tools/p/...`

Application code must treat Stripe as the source of truth for hosted billing
URLs and return `session.url` unchanged. Do not hardcode or rewrite Stripe
Checkout, Payment Link, or Customer Portal domains in the app, CLI, smoke tests,
or deployment scripts.

For an authenticated production smoke, provide `SKILLS_API_KEY` for a test owner
account. `scripts/production_smoke.sh` then creates checkout and customer portal
sessions and asserts Stripe returns `pay.hasna.tools/c/...` and
`pay.hasna.tools/p/...` URLs. Payment Link `/b/...` validation remains a manual
Stripe Dashboard check until the app exposes a first-party payment-link launch
flow.

## Deploy

Production deploys through `.github/workflows/deploy.yml` on `v*` tags or manual
dispatch. The workflow order is:

1. `bun run typecheck`
2. `bun run test`
3. `bun run build`
4. `bun run dashboard:build`
5. `bash scripts/production_validate_runtime_secrets.sh`
6. Build and push immutable production image.
7. `bash scripts/production_validate_secrets.sh`
8. `PRODUCTION_REGISTER_ONLY=1 bash scripts/production_deploy_ecs.sh` to
   register the new web task definition without shifting live traffic.
9. `bash scripts/production_migrate.sh`
10. `bash scripts/production_deploy_ecs.sh` to update the live web service.
11. `bash scripts/production_deploy_workers.sh`
12. `bash scripts/production_smoke.sh`
13. `bash scripts/production_readiness.sh`

The web ECS service runs with `SKILLS_RUNNER_ENABLED=0`. The worker ECS service
runs `src/platform/runner/worker.ts` with `SKILLS_RUNNER_ENABLED=1`.

The workflow intentionally builds the production image after runtime-secret
validation but before live Stripe validation. This lets GitHub Actions produce a
production-tagged artifact when Stripe is the only blocker, while still refusing
to register task definitions, migrate, or shift traffic until live Stripe
account and price validation passes.

## Required Verification

Before considering production complete, this command must pass:

```bash
AWS_PROFILE=hasnatools AWS_REGION=us-east-1 bun run aws:production:readiness
```

It checks:

- live Stripe secret shape and real Stripe account/price reachability
- runtime secret shape for DB, Redis, auth, worker, and OTP email settings
- production ALB state
- HTTPS listener
- ECS cluster
- web service
- worker service
- S3 bucket privacy, server-side encryption, and versioning for private skill
  artifacts and execution exports
- authenticated artifact routes reject unauthenticated requests before any
  storage metadata or object body is exposed
- `https://skills.md/api/health`

As of the latest verification, readiness fails because live Stripe material is
missing and the web/worker services are not deployed.

## Sandbox Preview Billing

Sandbox preview Stripe is configured in `skillsmd/preview/stripe`.

To refresh it:

```bash
STRIPE_API_KEY=sk_test_... \
STRIPE_PUBLISHABLE_KEY=pk_test_... \
AWS_PROFILE=hasnatools \
AWS_REGION=us-east-1 \
bun run aws:bootstrap:preview-stripe
```

Preview has one enabled sandbox webhook endpoint for:

```text
https://preview.skills.md/api/v1/billing/webhook
```

The enabled preview endpoint has the same six billing events as production:
checkout completion, subscription created/updated/deleted, invoice paid, and
invoice payment failed.
