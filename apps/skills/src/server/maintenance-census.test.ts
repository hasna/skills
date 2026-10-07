import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSchemaCensusManifest } from "./maintenance-entry.js";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function files(overrides: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "census-input-"));
  const manifest: Record<string, unknown> = {
    app: "skills", operation: "inspect-schema", manifestVersion: 1,
    operationId: "census-1", stationId: "test-station", keyId: "test-key", orgId: "test-org",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "manifestDigest").sort(([a], [b]) => a.localeCompare(b))));
  manifest.manifestDigest = hash(canonical);
  const bytes = JSON.stringify(manifest);
  const receipt = {
    manifestBytesSha256: hash(bytes), operatorJobId: "test-job",
    operatorTaskArn: "test-task", taskDefinitionArn: "test-definition",
    verifiedAt: new Date().toISOString(),
  };
  const manifestPath = join(dir, "manifest.json");
  const receiptPath = join(dir, "receipt.json");
  writeFileSync(manifestPath, bytes);
  writeFileSync(receiptPath, JSON.stringify(receipt));
  return { manifest, manifestPath, receiptPath, receipt, dir, bytes };
}

test("a distinct fresh census authorization binds the exact manifest and wrapper-verified bytes", () => {
  const f = files();
  expect(JSON.stringify(readSchemaCensusManifest(f.manifestPath, f.receiptPath))).toBe(f.bytes);
  // Whitespace does not alter the canonical digest, but does alter the wrapper binding.
  writeFileSync(f.manifestPath, f.bytes + "\n");
  expect(() => readSchemaCensusManifest(f.manifestPath, f.receiptPath)).toThrow("INVALID_OPERATOR_RECEIPT");
});

test("census refuses enrollment and inspection authorizations, target selection and surplus fields", () => {
  for (const input of [
    { app: "other" }, { operation: "enroll-publish" }, { operation: "inspect-enrollment" }, { manifestVersion: 2 },
    { operationId: " " }, { stationId: "bad\nvalue" }, { keyId: " " }, { orgId: "x".repeat(257) },
    { expiresAt: "2000-01-01T00:00:00Z" }, { expiresAt: "bad" },
    { apply: true }, { sql: "SELECT 1" }, { query: "SELECT 1" }, { database: "other" }, { schema: "other" }, { target: "other" },
    { enrollmentOperationId: "prior-enrollment" }, { enrollmentManifestDigest: "a".repeat(64) },
  ]) {
    const f = files(input);
    expect(() => readSchemaCensusManifest(f.manifestPath, f.receiptPath)).toThrow("INVALID_CENSUS_MANIFEST");
  }
});

test("census refuses manifest tampering and non-object, oversized or symlink input", () => {
  for (const body of ["null", "[]", '"text"', "{", " ".repeat(33 * 1024)]) {
    const f = files();
    writeFileSync(f.manifestPath, body);
    expect(() => readSchemaCensusManifest(f.manifestPath, f.receiptPath)).toThrow("INVALID_CENSUS_MANIFEST");
  }
  const f = files();
  writeFileSync(f.manifestPath, JSON.stringify({ ...f.manifest, keyId: "different-key" }));
  expect(() => readSchemaCensusManifest(f.manifestPath, f.receiptPath)).toThrow("INVALID_CENSUS_MANIFEST");
  const original = files();
  const link = join(original.dir, "symlink.json");
  symlinkSync(original.manifestPath, link);
  expect(() => readSchemaCensusManifest(link, original.receiptPath)).toThrow("INVALID_CENSUS_MANIFEST");
});

test("census requires the protected wrapper receipt and valid provenance", () => {
  for (const replacement of [null, {}, { operatorJobId: "" }, { verifiedAt: "invalid" }, { taskDefinitionArn: "" }, { manifestBytesSha256: "b".repeat(64) }]) {
    const f = files();
    writeFileSync(f.receiptPath, JSON.stringify(replacement === null ? null : { ...f.receipt, ...replacement, ...(Object.keys(replacement).length ? {} : { operatorTaskArn: "" }) }));
    expect(() => readSchemaCensusManifest(f.manifestPath, f.receiptPath)).toThrow("INVALID_OPERATOR_RECEIPT");
  }
});

test("native census refuses --apply, arbitrary SQL, alternate targets and an implicit target", async () => {
  const entry = join(import.meta.dir, "maintenance.ts");
  const invalid = files({ operation: "enroll-publish" });
  const valid = files();
  const invoke = async (input: ReturnType<typeof files>, extra: string[], env: Record<string, string | undefined> = {}) => {
    const child = Bun.spawn([process.execPath, entry, "maintenance", "inspect-schema", "--manifest", input.manifestPath, "--operator-receipt", input.receiptPath, "--json", ...extra], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ...env },
      stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, code };
  };

  const invalidResult = await invoke(invalid, []);
  expect(invalidResult.code).toBe(1);
  expect(JSON.parse(invalidResult.stdout)).toEqual({ status: "failed", code: "INVALID_CENSUS_MANIFEST" });
  expect(invalidResult.stderr).toBe("");

  for (const option of ["--apply", "--sql", "--query", "--database", "--schema", "--target"]) {
    const refused = await invoke(invalid, [option, "value"]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain(`unknown option '${option}'`);
    expect(refused.stdout).toBe("");
  }

  // No implicit localhost or environment target: an absent or non-PostgreSQL URL refuses before connecting.
  const noTarget = await invoke(valid, []);
  expect(noTarget.code).toBe(1);
  expect(JSON.parse(noTarget.stdout)).toEqual({ status: "failed", code: "CENSUS_POSTGRES_REQUIRED" });
  const wrongTarget = await invoke(valid, [], { HASNA_SKILLS_DATABASE_URL: "sqlite://fixture.db" });
  expect(wrongTarget.code).toBe(1);
  expect(JSON.parse(wrongTarget.stdout)).toEqual({ status: "failed", code: "CENSUS_POSTGRES_REQUIRED" });
});
