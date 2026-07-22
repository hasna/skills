import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("open-core product service pattern", () => {
  const root = process.cwd();
  const pattern = readFileSync(join(root, "docs/architecture/open-core-saas-pattern.md"), "utf8");
  const contract = readFileSync(join(root, "docs/architecture/open-product-three-mode-contract.md"), "utf8");
  const ownership = readFileSync(join(root, "docs/architecture/package-ownership-sync-strategy.md"), "utf8");
  const databaseAudit = readFileSync(join(root, "docs/architecture/database-schema-audit.md"), "utf8");
  const moduleAudit = readFileSync(join(root, "docs/architecture/hasna-skills-module-audit.md"), "utf8");
  const upstreamBoundary = readFileSync(join(root, "docs/architecture/upstream-boundary.md"), "utf8");
  const packageNaming = readFileSync(join(root, "docs/architecture/package-naming-publishing-policy.md"), "utf8");
  const reusableEngine = readFileSync(join(root, "docs/architecture/reusable-skills-engine.md"), "utf8");
  const skillProductModel = readFileSync(join(root, "docs/architecture/skill-product-model.md"), "utf8");
  const upstreamSync = readFileSync(join(root, "docs/architecture/upstream-sync.md"), "utf8");
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const publishWorkflow = readFileSync(join(root, ".github/workflows/publish.yml"), "utf8");
  const promotionWorkflow = readFileSync(join(root, ".github/workflows/promote-latest.yml"), "utf8");
  const promotionValidator = readFileSync(join(root, "src/lib/live-public-contract.ts"), "utf8");
  const deployWorkflow = readFileSync(join(root, ".github/workflows/deploy.yml"), "utf8");
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string; files?: string[] };
  const compact = (value: string) => value.replace(/\s+/g, " ");
  const compactPattern = compact(pattern);
  const compactContract = compact(contract);
  const compactOwnership = compact(ownership);
  const compactReadme = compact(readme);

  function mutableExternalActionReferences(workflow: string): string[] {
    return workflow.split("\n").flatMap((line) => {
      const match = line.match(/\buses:\s*([^@\s]+)@([^\s#]+)(?:\s+#\s*(\S+))?/);
      if (!match || match[1]?.startsWith("./")) return [];
      const [, action, reference, versionComment] = match;
      return /^[a-f0-9]{40}$/.test(reference ?? "") && /^v\d/.test(versionComment ?? "")
        ? []
        : [`${action}@${reference}`];
    });
  }

  test("keeps the universal client and provider-neutral server in OSS while cloud composition stays in platform", () => {
    expect(pattern).toContain("The public npm package is the install surface for local, self-hosted, and cloud users");
    expect(compactPattern).toContain("provider-neutral self-hosted server and OCI");
    expect(pattern).toContain("Hasna platform repository");
    expect(pattern).toContain("owns only the cloud");
    expect(pattern).toContain("OAuth provider secrets");
    expect(pattern).toContain("Stripe webhook handlers");
    expect(ownership).toContain("| Provider-neutral server | Open upstream |");
    expect(ownership).toContain("Hasna-internal infrastructure belongs in this row");
    expect(compactOwnership).toContain("generic server, workers, queues, shared contracts, and migrations");
    expect(compactOwnership).toContain("Hasna multi-tenant SaaS composition, commercial policy, private operations, and SaaS-specific runtime extensions");
    expect(compactOwnership).not.toContain("must not expose private provider routing, worker code");
  });

  test("marks older audits as historical and defers conflicting ownership text to the canonical contract", () => {
    for (const historicalDoc of [databaseAudit, moduleAudit, upstreamBoundary]) {
      expect(historicalDoc).toContain("Historical status");
      expect(historicalDoc).toContain("open-product-three-mode-contract.md");
      expect(historicalDoc).toContain("package-ownership-sync-strategy.md");
    }

    expect(compact(databaseAudit)).toContain("generic provider-neutral server schema and migrations");
    const compactModuleAudit = compact(moduleAudit);
    expect(compactModuleAudit.toLowerCase()).toContain("generic server, worker, queue, contract, and migration code remains upstream");
    expect(compactModuleAudit).toContain("Generic run, log, export, artifact, REST, and MCP contracts remain upstream");
    expect(compactModuleAudit).not.toContain("These must live in the private product layer, not upstream");
    expect(compactModuleAudit).not.toContain("Agent API: versioned REST endpoints");
    expect(compact(upstreamBoundary).toLowerCase()).toContain("generic provider-neutral server, worker, queue, contract, and migration code");
  });

  test("defines deployment, execution, and storage as independent axes", () => {
    expect(contract).toContain("## Independent Authority Axes");
    expect(contract).toContain("**Deployment authority:**");
    expect(contract).toContain("**Operation execution:**");
    expect(contract).toContain("**Storage authority:**");
    expect(contract).toContain("## Storage Profile Contract");
    expect(contract).toContain('"mode": "hybrid"');
    expect(compactContract).toContain("`local | remote | hybrid` storage axis");
    expect(compactContract).toContain("`SKILLS_API_URL`, `SKILLS_API_KEY`, deployment mode, and the selected operation never select storage mode");
  });

  test("specifies exact storage precedence and preserves legacy storage variables", () => {
    expect(contract).toContain("### Storage Selection Precedence");
    expect(contract).toContain("1. `--storage-profile <name>`");
    expect(contract).toContain("2. `HASNA_<APP>_STORAGE_PROFILE`");
    expect(compactContract).toContain("3. `storageProfile` on the selected deployment profile");
    expect(compactContract).toContain("6. the legacy storage environment bridge, only when no new named storage profile was selected above");
    expect(contract).toContain("7. the built-in `local` storage profile");
    expect(contract).toContain("`HASNA_SKILLS_STORAGE_MODE`");
    expect(compactContract).toContain("ahead of `SKILLS_STORAGE_MODE`");
    expect(compactOwnership).toContain("| `HASNA_SKILLS_DATABASE_*` / `SKILLS_DATABASE_*` |");
    expect(compactOwnership).toContain("| `HASNA_SKILLS_S3_*` / `SKILLS_S3_*` |");
    for (const precedence of [
      "`HASNA_SKILLS_AWS_REGION` over `SKILLS_AWS_REGION`",
      "`HASNA_SKILLS_SYNC_BATCH_SIZE` over `SKILLS_SYNC_BATCH_SIZE`",
      "`HASNA_SKILLS_SYNC_DRY_RUN` over `SKILLS_SYNC_DRY_RUN`",
    ]) {
      expect(compactContract).toContain(precedence);
      expect(compactOwnership).toContain(precedence);
    }
    expect(compactOwnership).toContain("`HASNA_SKILLS_S3_*` does not include `HASNA_SKILLS_AWS_REGION`");
    expect(compactContract).toContain("## Client-Sync And Server Database Authority");
    expect(compactContract).toContain("`HASNA_SKILLS_DATABASE_URL` wins over `SKILLS_DATABASE_URL`");
    expect(compactContract).toContain("This is a target compatibility contract, not a description of the environment names current source reads");
    expect(compactContract).toContain("their authoritative database URL resolves in this exact order: 1. `HASNA_SKILLS_SERVER_DATABASE_URL` 2. legacy `HASNA_SKILLS_DATABASE_URL` 3. legacy `DATABASE_URL`");
    expect(compactContract).toContain("In that target contract, the server database pool resolves independently in this exact order: 1. `HASNA_SKILLS_SERVER_DATABASE_POOL_MAX` 2. legacy `HASNA_SKILLS_DATABASE_POOL_MAX` 3. legacy `SKILLS_DATABASE_POOL_MAX` 4. `4`");
    expect(compactContract).toContain("`HASNA_SKILLS_SERVER_S3_BUCKET`");
    expect(compactContract).toContain("`HASNA_SKILLS_SERVER_AWS_REGION`");
    expect(compactContract).toContain("Under that target compatibility contract, legacy fallback is a compatibility read, not a shared target namespace");
    expect(compactContract).toContain("must never copy a client-sync value into the server namespace");
    expect(compactOwnership).toContain("| `HASNA_SKILLS_SERVER_DATABASE_URL` plus legacy `HASNA_SKILLS_DATABASE_URL` / `DATABASE_URL` | Provider-neutral server authoritative database reference |");
    expect(compactOwnership).toContain("`HASNA_SKILLS_SERVER_DATABASE_POOL_MAX` plus legacy");
    expect(compactOwnership).toContain("`HASNA_SKILLS_SERVER_S3_*` plus legacy");
  });

  test("makes capabilities credential-free and externally anchored rather than a trust root", () => {
    expect(contract).toContain("Capabilities discovery is credential-free");
    expect(contract).toContain("The discovery document is untrusted input, not a trust root");
    expect(contract).toContain("pinned to Hasna-signed product metadata");
    expect(compactContract).toContain("operator-supplied bundle or service fingerprint");
    expect(compactContract).toContain("A remote profile may be saved in `bootstrap` state");
    expect(compactContract).toContain("A bootstrap profile cannot retrieve credentials");
    expect(compactContract).toContain("`cloud` always requires an explicit tenant binding");
    expect(compactContract).toContain("signed single-tenant default");
    expect(compactContract).toContain("selected opaque selector and a fresh public challenge before any product API credential issuance");
    expect(compactContract).toContain("must not disclose a raw tenant id, email, account name, membership, or credential");
    expect(compactContract).toContain("Service identity is pinned before any credential lookup or release");
    expect(compactContract).toContain("`(product, origin, service identity, issuer, audience, subject, tenant)`");
    expect(compactContract).toContain("RFC 8785 canonical JSON serialization");
    for (const envelopeField of ["`alg`", "`kid`", "`issuedAt`", "`expiresAt`"]) {
      expect(contract).toContain(envelopeField);
    }
    expect(compactContract).toContain("one-time nonce echoed in the signed payload or a strictly monotonic service-identity version");
    expect(compactContract).toContain("allowed clock-skew window");
    expect(compactContract).toContain("rejects replayed or stale envelopes");
    expect(compactContract).toContain("continuity proof signed by both the previously enrolled key and the replacement key");
    expect(compactContract).toContain("rejects discovery signed by an unpinned, prematurely active, or retired key");
    expect(contract).toContain("Trust rotation requires continuity proof");
    expect(contract).toContain("explicit re-enrollment");
    expect(contract).toContain("### First-Time Cloud Authentication And Tenant Selection");
    for (const onboarding of [
      "authorization-code browser flow or device flow",
      "PKCE",
      "unpredictable\n   `state`",
      "OIDC `nonce`",
      "an accepted invitation for an existing member",
      "After OIDC authentication, but before any product API credential is issued",
      "verified new-user\n   enrollment",
      "multi-tenant membership\n   response",
      "normalized origin, service\n   identity, issuer, audience, authenticated subject",
      "short expiry, and unique replay identifier",
      "Only after the client verifies and persists that binding",
      "OIDC authentication may already have completed when tenant selection begins",
      "Lost-device recovery",
    ]) {
      expect(contract).toContain(onboarding);
    }
  });

  test("defines deterministic legacy migration, dual-read exit, downgrade, and rollback", () => {
    expect(contract).toContain("## Legacy Migration Contract");
    expect(contract).toContain("`profile migrate --dry-run --json`");
    expect(compactContract).toContain("first two consecutive minor releases");
    expect(contract).toContain("there is no dual-write");
    expect(compactContract).toContain("Removing legacy reads requires all conformance fixtures");
    expect(contract).toContain("Downgrade is permitted only while the versioned backup exists");
    expect(ownership).toContain("## Legacy-To-Target Mapping");
    expect(compactOwnership).toContain("Ambiguous until enrollment proves `selfhost` or `cloud`");
  });

  test("records current SaaS client status without conflating internal selfhost", () => {
    expect(contract).toContain("## Three Surfaces And Current Terminology");
    expect(compactContract).toContain("live `skills.md` capability and credit-quote responses as authoritative");
    expect(compactReadme).toContain("Hasna's internal AWS deployment is self-hosted, not cloud");
    expect(readme).toContain("Skills cloud");
    expect(readme).not.toContain("This PR");
    expect(contract).not.toContain("The PR that introduced");
  });

  test("pins the source candidate separately from published provenance", () => {
    expect(packageJson.version).toBe("0.2.0");
    expect(compactContract).toContain("`@hasna/skills@0.2.0` implements the quick launch slice");
    expect(compactReadme).toContain("A package is marketable as the new SaaS client only after this version is published");
    expect(compactReadme).toContain("Source readiness is not the same as npm availability");
  });

  test("defines phased protocol negotiation separately from run authorization", () => {
    expect(contract).toContain("## Protocol Negotiation And Run Authorization");
    expect(compactContract).toContain("client version and supported run-authorization capabilities");
    expect(contract).toContain("`X-Skills-Client-Version`");
    expect(contract).toContain("`X-Skills-Run-Authorization: signed-quote-v1`");
    expect(compactContract).toContain("server advertises its supported capabilities and minimum client version");
    expect(compactContract).toContain("Phase A");
    expect(compactContract).toContain("Phase B");
    expect(compactContract).toContain("`426 Upgrade Required`");
    expect(compactContract).toContain("before quote, reservation, debit, or run creation");
    expect(compactContract.toLowerCase()).toContain("protocol negotiation does not authorize a run");
    expect(compactContract).toContain("--allow-unsigned-phase-a");
    expect(compactContract).toContain("allowUnsignedPhaseA: true");
    expect(compactContract).toContain("quoteFingerprint");
    expect(compactContract).toContain("approvedQuoteFingerprint");
    expect(compactContract).toContain("any changed approval field");
  });

  test("uses the protected production token and supported Node runtime for manual next publishing", () => {
    expect(publishWorkflow).toContain("actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6");
    expect(publishWorkflow).toMatch(/node-version:\s*["']?24["']?/);
    expect(publishWorkflow).toContain("registry-url: https://registry.npmjs.org");
    expect(publishWorkflow).toContain("id-token: write");
    expect(publishWorkflow).toContain("npm publish --tag next --provenance --access public");
    expect(publishWorkflow).toContain("workflow_dispatch:");
    expect(publishWorkflow).toContain('test "$(git rev-parse origin/main)" = "$GITHUB_SHA"');
    expect(publishWorkflow).toMatch(/environment:\s*production/);
    expect(publishWorkflow).toContain('GITHUB_REF" = "refs/heads/main');
    expect(publishWorkflow).toContain('RELEASE_VERSION" = "0.2.0');
    expect(publishWorkflow).toContain('RELEASE_CONFIRMATION" = "publish-0.2.0-to-next');
    expect(publishWorkflow).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");
    expect(publishWorkflow).not.toMatch(/\npush:\s*\n/);
  });

  test("pins every external action in secret-bearing release workflows", () => {
    expect(mutableExternalActionReferences(publishWorkflow)).toEqual([]);
    expect(mutableExternalActionReferences(promotionWorkflow)).toEqual([]);
    expect(mutableExternalActionReferences("- uses: actions/checkout@v6")).toEqual([
      "actions/checkout@v6",
    ]);
    expect(mutableExternalActionReferences(
      "- uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
    )).toEqual(["actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803"]);
  });

  test("keeps npm 0.2.0 on next and the internal self-hosted deployment manual-only", () => {
    expect(packageJson.version).toBe("0.2.0");
    expect(publishWorkflow).toContain("Publish npm prerelease (next)");
    expect(publishWorkflow).toContain("--tag next");
    expect(publishWorkflow).toContain("workflow_dispatch:");
    expect(deployWorkflow).toContain("Internal self-hosted deployment (non-cloud)");
    expect(deployWorkflow).toContain("workflow_dispatch");
    expect(deployWorkflow).not.toMatch(/\npush:\s*\n/);
  });

  test("promotes the exact tested prerelease artifact to latest only through a manual gate", () => {
    expect(promotionWorkflow).toContain("workflow_dispatch:");
    expect(promotionWorkflow).toMatch(/environment:\s*production/);
    expect(promotionWorkflow).toContain('GITHUB_REPOSITORY" = "hasna/skills');
    expect(promotionWorkflow).toContain('GITHUB_REF" = "refs/heads/main');
    expect(promotionWorkflow).toContain('test "$(git rev-parse origin/main)" = "$GITHUB_SHA"');
    expect(promotionWorkflow).not.toContain("npm-production");
    expect(promotionWorkflow).not.toContain("platform_deploy_run_id");
    expect(promotionWorkflow).not.toContain("PLATFORM_RELEASE_READ_TOKEN");
    expect(promotionWorkflow).toContain("platform_sha");
    expect(promotionWorkflow).toContain("platform_version");
    expect(promotionWorkflow).toContain("client_pin");
    expect(promotionWorkflow).not.toContain("repos/hasnatools/platform-skills/actions/runs/");
    expect(promotionWorkflow).toContain("validate-live-public-contract.ts");
    expect(promotionValidator).toContain("live version commit SHA mismatch");
    expect(promotionValidator).toContain("live health commit SHA mismatch");
    expect(promotionWorkflow).toContain("https://skills.md/api/version");
    expect(promotionWorkflow).toContain("https://skills.md/api/health");
    expect(promotionWorkflow).toContain("https://skills.md/api/v1/skills/image");
    expect(promotionWorkflow).toContain("https://skills.md/api/v1/skills/image/quote");
    expect(promotionWorkflow).toContain("https://skills.md/api/v1/runs?limit=10");
    expect(promotionWorkflow).toContain("https://skills.md/api/v1/billing/usage");
    expect(promotionWorkflow).not.toContain("https://skills.md/api/v1/billing/usage?");
    expect(promotionWorkflow).toContain("SKILLS_PROMOTION_API_KEY");
    expect(promotionValidator).toContain("currentVersion");
    expect(promotionWorkflow).toContain("@hasna/skills@0.2.0");
    expect(promotionWorkflow).toContain("@hasna/skills@next");
    expect(promotionWorkflow).toContain("dist.integrity");
    expect(promotionValidator).toContain("parsePublicSkillEndpoint");
    expect(promotionValidator).toContain("parsePublicQuoteEndpoint");
    expect(promotionValidator).toContain('const PROMOTION_PROOF_SKILL = "logo-design"');
    expect(promotionValidator).toContain("entry.runId === promotionRun.id");
    expect(promotionValidator).toContain("entry.amountCredits === -promotionRun.creditsUsed");
    expect(promotionValidator).toContain("assertOnlyKeys");
    expect(promotionWorkflow).toContain("mktemp -d");
    expect(promotionWorkflow).toContain("skills --version");
    expect(promotionWorkflow).toContain("npm dist-tag add @hasna/skills@0.2.0 latest");
    expect(packageNaming).toContain("next -> platform live proof -> latest");
  });

  test("keeps scheduled credit approval free of legacy cents flags", () => {
    const schedule = readFileSync(join(root, "src/cli/commands/schedule.ts"), "utf8");
    expect(schedule).toContain("--max-credits <credits>");
    expect(schedule).toContain("--allow-unsigned-phase-a");
    expect(schedule).not.toMatch(/max-paid-cents|paidTotalCents|maxPaidCents/);
  });

  test("records the implemented launch slice and remaining architecture work", () => {
    expect(compactContract).toContain("explicit `local | self-hosted | cloud` routing");
    expect(compactContract).toContain("service-origin-bound stored credentials");
    expect(compactContract).toContain("cloud alone accepts `SKILLS_API_KEY`");
    expect(compactContract).toContain("Named profiles, the common adapter refactor, storage-profile resolver, and the full trust handshake remain target contracts");
    expect(compactReadme).toContain("Named multi-service profiles remain a follow-up");
    expect(compactReadme).toContain("binds its stored credential to that origin");
  });

  test("distinguishes the current one-service selection from the target profile architecture", () => {
    for (const phrase of [
      "Agent-first command discovery; never opens the TUI",
      "skills setup --mode cloud",
      "skills setup --mode self-hosted",
      "skills setup --mode local",
      "Stored credentials include their issuing service origin",
      "A future named-profile layer can retain several enrolled services at once",
    ]) {
      expect(compactReadme).toContain(phrase);
    }
    expect(compactReadme).toContain("one selected service");
  });

  test("ships every canonical architecture document linked by the package", () => {
    const files = packageJson.files ?? [];
    expect(files).toContain("docs/architecture/open-core-saas-pattern.md");
    expect(files).toContain("docs/architecture/open-product-three-mode-contract.md");
    expect(files).toContain("docs/architecture/package-ownership-sync-strategy.md");
    expect(files).toContain("docs/architecture/reusable-skills-engine.md");
  });

  test("keeps supporting architecture docs aligned with canonical ownership and axis semantics", () => {
    for (const doc of [packageNaming, reusableEngine, skillProductModel, upstreamSync]) {
      expect(doc).toContain("open-product-three-mode-contract.md");
      expect(doc).toContain("package-ownership-sync-strategy.md");
    }

    const compactNaming = compact(packageNaming);
    expect(compactNaming).toContain("`skills.md` always names the Hasna-operated multi-tenant customer SaaS (`cloud`)");
    expect(compactNaming).toContain("a compatible operator URL is `selfhost`");
    expect(compactNaming).toContain("Minor before `1.0.0`");
    expect(compactNaming).toContain("breaking CLI/MCP/API behavior");
    expect(compactNaming).toContain("Major at `1.0.0` and later");
    expect(compactNaming).toContain("Generic auth, API-key, tenant-isolation, observability, and provider-neutral opt-in selfhost contracts belong in the open package");

    const compactReusable = compact(reusableEngine);
    expect(compactReusable).toContain("Generic provider-neutral server persistence, workers, queues, and migrations remain OSS-owned surfaces");
    expect(compactReusable).toContain("Hasna customer tenancy, billing providers, managed infrastructure, support tooling, and `skills.md` production configuration belong in the Hasna cloud composition");

    const compactModel = compact(skillProductModel);
    expect(compactModel).toContain("deployment authority is `local | selfhost | cloud`");
    expect(compactModel).toContain("operation execution policy is `local-only | remote-only | either`");
    expect(compactModel).toContain("package storage authority is `local | remote | hybrid`");
    expect(compactModel).toContain("`connector-only` may be a skill capability or implementation kind");
    expect(compactModel).toContain("`hybrid` is storage synchronization with one declared write authority");

    const compactSync = compact(upstreamSync);
    expect(compactSync).toContain("generic server, workers, queues, persistence adapters, migrations, shared contracts, and selfhost deployment artifacts are OSS-owned surfaces");
    expect(compactSync).toContain("customer tenant topology, Hasna billing and entitlements, private provider routing, managed production infrastructure, credentials, support tooling, and cloud-only operational policy");
  });
});
