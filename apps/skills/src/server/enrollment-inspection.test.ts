import { expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
import { inspectEnrollment } from "./enrollment-inspection.js";
useDefaultTestTimeout();

const input = { keyId: "fixture-key", orgId: "fixture-org", enrollmentOperationId: "fixture-operation", enrollmentManifestDigest: "a".repeat(64) };

test("inspection refuses invalid identities and non-PostgreSQL targets before connecting", async () => {
  for (const value of ["", "memory:", "file:fixture.db", "sqlite://fixture.db", "https://example.invalid", "postgres:"]) {
    await expect(inspectEnrollment(value, input)).rejects.toMatchObject({ name: "EnrollmentInspectionError", code: "POSTGRES_REQUIRED", message: "POSTGRES_REQUIRED" });
  }
  for (const change of [{ keyId: "" }, { keyId: "x".repeat(257) }, { orgId: "bad\norg" }, { enrollmentOperationId: "" }, { enrollmentManifestDigest: "not-a-digest" }]) {
    await expect(inspectEnrollment("postgres://127.0.0.1/unused", { ...input, ...change })).rejects.toMatchObject({ code: "INVALID_INSPECTION_INPUT", message: "INVALID_INSPECTION_INPUT" });
  }
});
