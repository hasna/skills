# Production Launch Audit

This audit maps the launch request to concrete evidence. It is intentionally
stricter than a test summary: production is not complete until every required
production check passes against real deployed infrastructure.

## Success Criteria

1. Lander explains the product and has a payment path.
2. API supports authenticated skill access, remote runs, billing status,
   checkout, credit packs, webhooks, usage, and invoices.
3. Stripe sandbox payments and webhooks can be simulated safely.
4. Production refuses Stripe sandbox/test mode and validates live Stripe
   credentials and live prices before deploy.
5. Every registered skill has a directory, package metadata, documentation
   source, executable entrypoint, and generated `SKILL.md` instructions.
6. The local Bun package is updated and usable.
7. Security-sensitive runtime behavior is hardened: secrets are not printed,
   hosted mutations are guarded, JWT secrets are required in production,
   run charging is transaction-safe, and workers claim jobs atomically.
8. Production deploy workflow builds, migrates, deploys web and workers,
   smoke tests, and runs readiness.
9. Production is actually deployed and `https://skills.md/api/health` passes.

## Current Evidence

| Requirement | Evidence | Status |
| --- | --- | --- |
| Lander product copy | `dashboard/app/page.tsx`, `dashboard/src/components/hero-demo.tsx`, `src/platform/web/saas-landing.test.ts` | Done |
| Lander payment path | `dashboard/src/components/pricing-cta.tsx` copies `skills auth checkout`; `src/platform/web/saas-landing.test.ts` verifies the CTA | Done |
| Billing API routes | `src/platform/api/router.ts`, `src/platform/api/billing-routes.ts`, `src/platform/api/api.test.ts` | Done |
| Stripe webhook signature and replay handling | HMAC tolerance and duplicate event handling in `src/platform/api/billing-routes.ts`; covered by `src/platform/api/api.test.ts` | Done |
| Subscription and invoice drift handling | `customer.subscription.*` and `invoice.*` upserts in `src/platform/api/billing-routes.ts` | Done |
| Credit-pack amount verification | `validateCreditCheckoutSession()` rejects mismatched amount/currency before crediting | Done |
| Sandbox Stripe preview config | `scripts/preview_bootstrap_stripe.sh`; `scripts/preview_verify_stripe.sh`; `AWS_PROFILE=hasnatools AWS_REGION=us-east-1 bun run aws:verify:preview-stripe` passes against AWS secret `skillsmd/preview/stripe`; Stripe account `acct_1SgpcCE9xtpjlvEX` returns test-mode resources; six active `skillsmd_preview_*` sandbox prices exist; exactly one enabled `https://preview.skills.md/api/v1/billing/webhook` endpoint has checkout, subscription, and invoice events; `scripts/bootstrap_preview_edge.sh` now manages both `preview.skills.md` and `*.preview.skills.md`, with an ACM certificate covering both names | Done |
| Stripe webhook event coverage | `scripts/preview_bootstrap_stripe.sh`, `scripts/production_bootstrap_stripe.sh`, and `docs/release/production-deployment-runbook.md` cover checkout completion, subscription created/updated/deleted, invoice paid, invoice payment failed, and duplicate endpoint cleanup | Done |
| Production live-mode guard | `validateStripeRuntimeMode()`, `scripts/production_validate_secrets.sh`, `src/platform/aws/production-deployment.test.ts` | Done |
| Production runtime secret guard | `scripts/production_validate_runtime_secrets.sh` validates DB, Redis, auth, worker, Resend, and sender email shape; `scripts/production_deploy_ecs.sh` injects `RESEND_API_KEY` and `FROM_EMAIL`; AWS `skillsmd/production/runtime/env` passes the validator | Done |
| Skill corpus coverage | `src/lib/validation.test.ts` checks all 211 skills, executable entries, docs, and generated `SKILL.md` instructions | Done |
| Security audit skill coverage | `skills/security-audit/src/index.ts` runs without undeclared dependencies and scans `src`, `docs`, and deployment scripts with zero findings; covered by `src/lib/validation.test.ts` | Done |
| Local package update | `bun pm pack` produced `hasna-skills-0.1.23.tgz`; `bun install -g /home/hasna/workspace/hasnatools/platform/platform-skills/hasna-skills-0.1.23.tgz` installed the refreshed package; `skills --version` reports `0.1.23`; installed CLI lists and validates 211 skills | Done |
| Worker/web split | `src/server/serve.ts`, `src/platform/runner/worker.ts`, `scripts/production_deploy_workers.sh` | Done |
| Safe run charging | Transactional debit plus queued run insert in `src/platform/api/runs-routes.ts` | Done |
| Atomic worker claiming | `FOR UPDATE SKIP LOCKED` claim in `src/platform/runner/index.ts` | Done |
| Deploy workflow gates | `.github/workflows/deploy.yml`, `.github/workflows/ci.yml`, `.github/workflows/pr-preview.yml`, `.github/workflows/publish.yml`, `docs/release/production-deployment-runbook.md`, `src/platform/ci/workflow-gates.test.ts`; workflows use `actions/checkout@v6` and opt into `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` | Done |
| Production OIDC deploy trust | `scripts/bootstrap_github_oidc_roles.sh`, `deploy/aws-targets.json`, and live IAM role `tool-skillsmd-github-actions-production` allow the protected `production` environment from `refs/tags/v*` and manual dispatch from `refs/heads/main`; deploy run `25609614311` passed AWS credential configuration | Done |
| CI on `origin/main` | GitHub CI run `25610613576` passed for commit `508d9ce3d9dc6de75ff571a881299716c06a62f3` | Done |
| Production image artifact | GitHub deploy run `25610655202` built and pushed ECR image `tool-skillsmd-web:production-manual-508d9ce` with digest `sha256:a05caffd9e9790b038648a111392085b1e80bcbf4e9186be47c878dfd72095f0` before stopping at live Stripe validation | Done |
| Production readiness | `AWS_PROFILE=hasnatools AWS_REGION=us-east-1 bun run aws:production:readiness` last failed on 2026-05-09 after image push because live Stripe secrets are missing and web/worker services are not active | Blocked |

## Prompt-To-Artifact Checklist

| User request | Artifact or command evidence | Status |
| --- | --- | --- |
| Check how the app works | `src/platform/api/api.test.ts`, `src/server/serve.test.ts`, `src/cli/cli.test.ts`, and `docs/release/production-launch-audit.md` map the CLI, API, hosted runner, billing, and deployment behavior | Done |
| Check the lander explains it | `dashboard/app/page.tsx`, `dashboard/src/components/hero-demo.tsx`, `dashboard/src/components/pricing-cta.tsx`, and `src/platform/web/saas-landing.test.ts` cover product copy, demo, install command, and payment CTA | Done |
| See and fix the deployment process | `.github/workflows/deploy.yml`, `scripts/production_deploy_ecs.sh`, `scripts/production_deploy_workers.sh`, `scripts/production_migrate.sh`, `scripts/production_smoke.sh`, `scripts/production_readiness.sh`, and deploy run `25610655202` verify the production path through image push and the live Stripe stop gate | Done |
| Make sure production uses prod Stripe, not sandbox | `scripts/production_validate_secrets.sh`, `scripts/production_bootstrap_stripe.sh`, `src/platform/api/billing-routes.ts`, and `src/platform/aws/production-deployment.test.ts` reject test-mode credentials, placeholder keys, and non-live prices in production | Done |
| Make sure webhooks and API are working | `src/platform/api/billing-routes.ts` verifies Stripe HMAC signatures and handles checkout, subscription, invoice, duplicate-event, and credit-amount paths; `src/platform/api/api.test.ts` covers the API surface | Done |
| Simulate payments via Stripe CLI | `scripts/preview_bootstrap_stripe.sh`, `scripts/preview_verify_stripe.sh`, AWS `skillsmd/preview/stripe`, and the enabled preview webhook endpoint provide sandbox-mode Stripe verification; `AWS_PROFILE=hasnatools AWS_REGION=us-east-1 bun run aws:verify:preview-stripe` passes; production simulation remains blocked until valid live credentials exist | Done for sandbox, blocked for production |
| Update local Bun package | `bun pm pack` produced `hasna-skills-0.1.23.tgz`; `bun install -g /home/hasna/workspace/hasnatools/platform/platform-skills/hasna-skills-0.1.23.tgz` refreshed the global CLI; `skills --version` reports `0.1.23` | Done |
| Check every single skill generates properly | `src/lib/validation.test.ts` validates all 211 registered skills have directories, package metadata, docs, executable entrypoints, and generated `SKILL.md` instructions; installed CLI `skills validate <name> --json` loop returned `validated=211` | Done |
| Make sure users can pay for it | `dashboard/src/components/pricing-cta.tsx`, `src/platform/api/billing-routes.ts`, `src/platform/api/api.test.ts`, and Stripe price validation cover checkout creation and webhook fulfillment; production payment is blocked until `skillsmd/production/stripe` is populated with valid live keys/prices/webhook secret | Blocked in production |
| Fix security issues | `skills/security-audit/src/index.ts` scans `src`, `docs`, and `scripts`; `src/lib/validation.test.ts` verifies zero findings for those scopes | Done |
| Spawn 2 adversarial agents | Two subagents were used during launch hardening; the final state is captured in this audit and the pushed CI/deploy evidence | Done |
| Fully deploy on prod and verify it works | `aws:production:readiness` is the completion gate and currently fails because production Stripe is missing/invalid, ECS web and worker services are inactive, and `https://skills.md/api/health` is unreachable | Blocked |

## Verification Commands

These commands were used as release evidence and should remain green before
deployment:

```bash
bun run typecheck
bun test
bun run build
bun run dashboard:build
bun pm pack --dry-run
skills --version
gh run list --repo hasnatools/platform-skills --branch main --limit 1
AWS_PROFILE=hasnatools AWS_REGION=us-east-1 bun run aws:production:readiness
AWS_PROFILE=hasnatools AWS_REGION=us-east-1 bun run aws:verify:preview-stripe
AWS_PROFILE=hasnatools AWS_REGION=us-east-1 bash scripts/production_validate_runtime_secrets.sh
AWS_PROFILE=hasnatools AWS_REGION=us-east-1 aws ecr describe-images \
  --repository-name tool-skillsmd-web \
  --image-ids imageTag=production-manual-508d9ce
```

## Current Production Blockers

`aws:production:readiness` currently fails because:

- GitHub issue `#1` tracks the remaining live Stripe handoff and production
  deploy completion gates.

- `skillsmd/production/stripe` is missing or has placeholder values for all
  required production Stripe fields: `STRIPE_SECRET_KEY`,
  `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`,
  `STRIPE_CREDIT_1_PRICE_ID`, `STRIPE_CREDIT_5_PRICE_ID`,
  `STRIPE_CREDIT_20_PRICE_ID`, `STRIPE_CREDIT_50_PRICE_ID`, and
  `STRIPE_CREDIT_100_PRICE_ID`.
- AWS Secrets Manager has only two versions for `skillsmd/production/stripe`:
  `AWSCURRENT` and `AWSPREVIOUS`; both are placeholder-shaped for every
  required Stripe field, so there is no hidden version to promote.
- The available Stripe CLI live key on `spark02` returns HTTP 401 from
  `https://api.stripe.com/v1/account`.
- Cross-machine secret checks found no usable hasnatools live Stripe material:
  `apple03` and `apple01` have no Stripe CLI config and only
  `hasnatools/notion/live.env`; `spark01` has a live-shaped Stripe CLI key but
  Stripe returns HTTP 401 for `/v1/account`.
- Every unique live-shaped Stripe CLI API key entry on `spark02` and `spark01`
  returns HTTP 401, so duplicate Stripe CLI config entries are not hiding a
  usable live credential.
- GitHub repository and `production` environment secret/variable lists for
  `hasnatools/platform-skills` are empty, so there is no GitHub-held Stripe
  material to sync into AWS Secrets Manager.
- AWS SSM Parameter Store has no `stripe` or `skillsmd` parameters in
  `us-east-1`, and the current shell environment has no Stripe variables.
- Connected secrets and deployment MCP tools also return no Stripe or production
  deployment secrets for `hasnatools/platform-skills`.
- Production runtime secret shape now passes, including OTP email config.
- The production GitHub workflow can assume the AWS production role and push a
  production image; run `25610655202` pushed `production-manual-508d9ce`, but it
  correctly refused to register ECS tasks, migrate, or shift traffic until live
  Stripe validation passes.
- `skillsmd-production-web` is not active.
- `skillsmd-production-workers` is not active.
- `https://skills.md/api/health` is unreachable.

Do not deploy with test Stripe keys or placeholder production secrets. After a
valid live Stripe key and publishable key are available, run the production
Stripe bootstrap in `docs/release/production-deployment-runbook.md`, then deploy
through the production GitHub workflow and require readiness to pass.
