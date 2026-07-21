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
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string; files?: string[] };
  const compact = (value: string) => value.replace(/\s+/g, " ");
  const compactPattern = compact(pattern);
  const compactContract = compact(contract);
  const compactOwnership = compact(ownership);
  const compactReadme = compact(readme);

  test("keeps the universal client and provider-neutral server in OSS while cloud composition stays in platform", () => {
    expect(pattern).toContain("The public npm package is the install surface for both local and hosted users");
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
    expect(compactContract).toContain("3. the legacy storage environment bridge");
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
    expect(compactContract).toContain("The provider-neutral server and migration binary resolve their authoritative database URL in this exact order: 1. `HASNA_SKILLS_DATABASE_URL` 2. `DATABASE_URL`");
    expect(compactContract).toContain("The server database pool resolves independently in this exact order: 1. `HASNA_SKILLS_DATABASE_POOL_MAX` 2. `SKILLS_DATABASE_POOL_MAX` 3. `4`");
    expect(compactContract).toContain("Never migrate a client-sync fallback into the server namespace or vice versa");
    expect(compactOwnership).toContain("| `HASNA_SKILLS_DATABASE_URL` / `DATABASE_URL` | Provider-neutral server authoritative database reference |");
    expect(compactOwnership).toContain("`HASNA_SKILLS_DATABASE_POOL_MAX` over `SKILLS_DATABASE_POOL_MAX` over the default `4`");
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
    expect(compactContract).toContain("operator-issued opaque tenant selector and a fresh public challenge");
    expect(compactContract).toContain("must not disclose a raw tenant id, email, account name, membership, or credential");
    expect(compactContract).toContain("Service identity is pinned before any credential lookup or release");
    expect(compactContract).toContain("`(product, origin, service identity, tenant)` tuple");
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
    expect(contract).toContain("`@hasna/skills@0.1.58` artifact is SaaS-capable");
    expect(compactContract).toContain("package, source, and API compatibility must be reconciled");
    expect(compactReadme).toContain("`local-first` means the package remains useful without an account");
    expect(readme).toContain("Hasna-internal infrastructure or another operator deployment");
    expect(readme).not.toContain("This PR");
    expect(contract).not.toContain("The PR that introduced");
  });

  test("pins the unreleased source candidate separately from published provenance", () => {
    expect(packageJson.version).toBe("0.1.59");
    expect(compactContract).toContain("The candidate is `@hasna/skills@0.1.59` and is explicitly unreleased");
    expect(compactContract).toContain("It has not been published or tagged; npm remains at `0.1.58`");
    expect(compactReadme).toContain("The package/lock/source candidate is explicitly `0.1.59` and unreleased; npm remains at `0.1.58`");
    expect(compactReadme).toContain("No publish or tag is part of this candidate change");
  });

  test("distinguishes current legacy auth and npm behavior from the target architecture", () => {
    for (const phrase of [
      "npm `@hasna/skills@0.1.58` predates the agent-first bare-command behavior",
      "bare `skills` still selects the implicit `interactive` command",
      "a release later than 0.1.58",
      "one legacy global credential record",
      "does not bind that credential to the configured remote origin",
      "does not perform the target operator identity and capability enrollment handshake",
      "Origin-, service-, and tenant-scoped credentials",
      "configured remote registry",
    ]) {
      expect(compactReadme).toContain(phrase);
    }
    expect(compactReadme).not.toContain("stores local configuration and scoped client credentials");
    expect(compactReadme).not.toContain("selected verified service operator");
    expect(compactReadme).not.toContain("configured self-hosted registry");
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
