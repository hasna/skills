import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("open-core product service pattern", () => {
  const root = process.cwd();
  const pattern = readFileSync(join(root, "docs/architecture/open-core-saas-pattern.md"), "utf8");
  const contract = readFileSync(join(root, "docs/architecture/open-product-three-mode-contract.md"), "utf8");
  const ownership = readFileSync(join(root, "docs/architecture/package-ownership-sync-strategy.md"), "utf8");
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { files?: string[] };
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
  });

  test("makes capabilities credential-free and externally anchored rather than a trust root", () => {
    expect(contract).toContain("Capabilities discovery is credential-free");
    expect(contract).toContain("The discovery document is untrusted input, not a trust root");
    expect(contract).toContain("pinned to Hasna-signed product metadata");
    expect(compactContract).toContain("operator-supplied bundle or service fingerprint");
    expect(compactContract).toContain("expected product, operator, deployment mode, authentication issuer, credential audience, and tenant binding");
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

  test("ships every canonical architecture document linked by the package", () => {
    const files = packageJson.files ?? [];
    expect(files).toContain("docs/architecture/open-core-saas-pattern.md");
    expect(files).toContain("docs/architecture/open-product-three-mode-contract.md");
    expect(files).toContain("docs/architecture/package-ownership-sync-strategy.md");
    expect(files).toContain("docs/architecture/reusable-skills-engine.md");
  });
});
