import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readInspectionManifest } from "./maintenance-entry.js";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function files(overrides: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "inspection-input-"));
  const manifest: Record<string, unknown> = {
    app: "skills", operation: "inspect-enrollment", manifestVersion: 1,
    operationId: "inspection-1", stationId: "test-station", keyId: "test-key", orgId: "test-org",
    enrollmentOperationId: "failed-enrollment", enrollmentManifestDigest: "a".repeat(64),
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

test("a distinct fresh authorization binds exact enrollment and wrapper-verified bytes", () => {
  const f = files();
  expect(JSON.stringify(readInspectionManifest(f.manifestPath, f.receiptPath))).toBe(f.bytes);
  // Whitespace does not alter the canonical digest, but does alter the wrapper binding.
  writeFileSync(f.manifestPath, f.bytes + "\n");
  expect(() => readInspectionManifest(f.manifestPath, f.receiptPath)).toThrow("INVALID_OPERATOR_RECEIPT");
});

test("inspection refuses enrollment authorization, operation reuse, expired and surplus fields", () => {
  for (const input of [
    { app: "other" }, { operation: "enroll-publish" }, { manifestVersion: 2 }, { operationId: "failed-enrollment" },
    { expiresAt: "2000-01-01T00:00:00Z" }, { expiresAt: "bad" },
    { apply: true }, { expectedScopes: ["skills:read"] }, { keyId: " " }, { orgId: "x".repeat(257) },
    { enrollmentOperationId: "bad\nvalue" }, { enrollmentManifestDigest: "not-a-digest" },
  ]) {
    const f = files(input);
    expect(() => readInspectionManifest(f.manifestPath, f.receiptPath)).toThrow("INVALID_INSPECTION_MANIFEST");
  }
});

test("inspection refuses manifest tampering and non-object, oversized or symlink input", () => {
  for (const body of ["null", "[]", '"text"', "{", " ".repeat(33 * 1024)]) {
    const f = files();
    writeFileSync(f.manifestPath, body);
    expect(() => readInspectionManifest(f.manifestPath, f.receiptPath)).toThrow("INVALID_INSPECTION_MANIFEST");
  }
  const f = files();
  writeFileSync(f.manifestPath, JSON.stringify({ ...f.manifest, keyId: "different-key" }));
  expect(() => readInspectionManifest(f.manifestPath, f.receiptPath)).toThrow("INVALID_INSPECTION_MANIFEST");
  const original = files();
  const link = join(original.dir, "symlink.json");
  symlinkSync(original.manifestPath, link);
  expect(() => readInspectionManifest(link, original.receiptPath)).toThrow("INVALID_INSPECTION_MANIFEST");
});

test("inspection requires the protected wrapper receipt and valid provenance", () => {
  for (const replacement of [null, {}, { operatorJobId: "" }, { verifiedAt: "invalid" }, { taskDefinitionArn: "" }, { manifestBytesSha256: "b".repeat(64) }]) {
    const f = files();
    writeFileSync(f.receiptPath, JSON.stringify(replacement === null ? null : { ...f.receipt, ...replacement, ...(Object.keys(replacement).length ? {} : { operatorTaskArn: "" }) }));
    expect(() => readInspectionManifest(f.manifestPath, f.receiptPath)).toThrow("INVALID_OPERATOR_RECEIPT");
  }
});

test("native inspection refuses --apply and emits only a fixed failure code on invalid input", async () => {
  const entry = join(import.meta.dir, "maintenance.ts");
  const invalid = files({ operation: "enroll-publish" });
  const invoke = async (extra: string[]) => {
    const child = Bun.spawn([process.execPath, entry, "maintenance", "inspect-enrollment", "--manifest", invalid.manifestPath, "--operator-receipt", invalid.receiptPath, "--json", ...extra], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
      stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, code };
  };
  const invalidResult = await invoke([]);
  expect(invalidResult.code).toBe(1);
  expect(JSON.parse(invalidResult.stdout)).toEqual({ status: "failed", code: "INVALID_INSPECTION_MANIFEST" });
  expect(invalidResult.stderr).toBe("");
  const applyResult = await invoke(["--apply"]);
  expect(applyResult.code).toBe(1);
  expect(applyResult.stderr).toContain("unknown option '--apply'");
});
