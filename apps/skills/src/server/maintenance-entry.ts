import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { createHash } from "node:crypto";
import { Command } from "commander";
import { createStore } from "./store.js";
import { validOperatorScopeEnrollmentInput, validOperatorScopeList, type OperatorScopeEnrollmentInput } from "./types.js";
import { EnrollmentInspectionError, inspectEnrollment, type EnrollmentInspectionInput } from "./enrollment-inspection.js";

type EnrollmentManifest = OperatorScopeEnrollmentInput & {
  operation: "enroll-publish";
  manifestVersion: 1;
  expiresAt: string;
};

type VerifiedOperatorReceipt = Pick<OperatorScopeEnrollmentInput, "operatorJobId" | "operatorTaskArn"> & {
  manifestBytesSha256: string;
  taskDefinitionArn: string;
  verifiedAt: string;
};

type InspectionManifest = EnrollmentInspectionInput & {
  app: "skills";
  operation: "inspect-enrollment";
  manifestVersion: 1;
  operationId: string;
  stationId: string;
  expiresAt: string;
  manifestDigest: string;
};

class InspectionInputError extends Error {
  constructor(readonly code: "INVALID_INSPECTION_MANIFEST" | "INVALID_OPERATOR_RECEIPT") {
    super(code);
  }
}

const MAX_MANIFEST_BYTES = 32 * 1024;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).filter(([key]) => key !== "manifestDigest").sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

function readBoundedJson(path: string): { value: Record<string, unknown>; bytesSha256: string } {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) throw new Error("maintenance input must be a bounded regular file");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const current = fstatSync(fd);
    if (!current.isFile() || current.size !== stat.size || current.size > MAX_MANIFEST_BYTES) throw new Error("maintenance input changed or is not bounded");
    const bytes = Buffer.alloc(current.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      if (count === 0) throw new Error("maintenance input ended early");
      offset += count;
    }
    return { value: JSON.parse(bytes.toString("utf8")) as Record<string, unknown>, bytesSha256: sha256(bytes.toString("utf8")) };
  } finally {
    closeSync(fd);
  }
}

function verifyOperatorReceipt(
  manifestInput: ReturnType<typeof readBoundedJson>,
  receipt: Partial<VerifiedOperatorReceipt>,
): Pick<OperatorScopeEnrollmentInput, "operatorJobId" | "operatorTaskArn"> {
  if (typeof receipt.operatorJobId !== "string" || !receipt.operatorJobId.trim() || typeof receipt.operatorTaskArn !== "string" || !receipt.operatorTaskArn.trim()) throw new Error("verified operator receipt is incomplete");
  if (typeof receipt.manifestBytesSha256 !== "string" || !/^[a-f0-9]{64}$/.test(receipt.manifestBytesSha256)) throw new Error("verified operator receipt digest is invalid");
  if (manifestInput.bytesSha256 !== receipt.manifestBytesSha256) throw new Error("manifest bytes are not the bytes verified by the operator wrapper");
  if (typeof receipt.taskDefinitionArn !== "string" || !receipt.taskDefinitionArn.trim() || typeof receipt.verifiedAt !== "string" || !Number.isFinite(Date.parse(receipt.verifiedAt))) throw new Error("verified operator receipt provenance is invalid");
  return { operatorJobId: receipt.operatorJobId, operatorTaskArn: receipt.operatorTaskArn };
}

function readManifest(path: string, receiptPath: string): EnrollmentManifest {
  const manifestInput = readBoundedJson(path);
  const receiptInput = readBoundedJson(receiptPath);
  const parsed = manifestInput.value as Partial<EnrollmentManifest>;
  const receipt = receiptInput.value as Partial<VerifiedOperatorReceipt>;
  if (parsed.operation !== "enroll-publish") throw new Error("maintenance manifest operation must be enroll-publish");
  if (parsed.manifestVersion !== 1) throw new Error("unsupported maintenance manifest version");
  for (const field of ["keyId", "stationId", "orgId", "operationId", "manifestDigest", "expiresAt"] as const) {
    if (typeof parsed[field] !== "string" || !parsed[field]!.trim()) throw new Error(`maintenance manifest is missing ${field}`);
  }
  if (!Array.isArray(parsed.expectedScopes) || parsed.expectedScopes.length === 0 || parsed.expectedScopes.length > 32 || parsed.expectedScopes.some((scope) => typeof scope !== "string" || !scope.trim() || scope.length > 128 || !/^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/.test(scope))) {
    throw new Error("maintenance manifest expectedScopes must be a non-empty string array");
  }
  if (parsed.expectedScopes.includes("skills:publish")) throw new Error("maintenance manifest must describe current scopes without skills:publish");
  const expiry = Date.parse(parsed.expiresAt!);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error("maintenance manifest has an invalid or expired expiry");
  if (!/^[a-f0-9]{64}$/.test(parsed.manifestDigest!)) throw new Error("maintenance manifest digest must be SHA-256");
  if (sha256(canonical(parsed)) !== parsed.manifestDigest) throw new Error("maintenance manifest digest does not match its bytes");
  return { ...parsed, ...verifyOperatorReceipt(manifestInput, receipt) } as EnrollmentManifest;
}

/** Inspection has its own authorization; a failed enrollment manifest cannot authorize it. */
export function readInspectionManifest(path: string, receiptPath: string): InspectionManifest {
  let input: ReturnType<typeof readBoundedJson>;
  let parsed: InspectionManifest;
  try {
    input = readBoundedJson(path);
    const value = input.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const fields = ["app", "operation", "manifestVersion", "operationId", "stationId", "keyId", "orgId", "enrollmentOperationId", "enrollmentManifestDigest", "expiresAt", "manifestDigest"];
    if (Object.keys(value).length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))) throw new Error();
    if (value.app !== "skills" || value.operation !== "inspect-enrollment" || value.manifestVersion !== 1) throw new Error();
    for (const field of ["operationId", "stationId", "keyId", "orgId", "enrollmentOperationId"] as const) {
      const item = value[field];
      if (typeof item !== "string" || item.trim().length === 0 || item.length > 256 || /[\u0000-\u001f\u007f]/.test(item)) throw new Error();
    }
    if (value.operationId === value.enrollmentOperationId) throw new Error();
    for (const field of ["manifestDigest", "enrollmentManifestDigest"] as const) {
      if (typeof value[field] !== "string" || !/^[a-f0-9]{64}$/.test(value[field])) throw new Error();
    }
    if (typeof value.expiresAt !== "string" || value.expiresAt.length > 64 || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) throw new Error();
    if (sha256(canonical(value)) !== value.manifestDigest) throw new Error();
    parsed = value as unknown as InspectionManifest;
  } catch {
    throw new InspectionInputError("INVALID_INSPECTION_MANIFEST");
  }
  try {
    verifyOperatorReceipt(input, readBoundedJson(receiptPath).value as Partial<VerifiedOperatorReceipt>);
  } catch {
    throw new InspectionInputError("INVALID_OPERATOR_RECEIPT");
  }
  return parsed;
}

export function registerMaintenance(parent: Command): void {
  const maintenance = parent.command("maintenance").description("Run protected, metadata-only Skills maintenance operations");
  maintenance.command("inspect-enrollment")
    .description("Inspect one enrollment with a database-enforced read-only snapshot")
    .requiredOption("--manifest <path>", "Fresh inspection authorization supplied by the protected task wrapper")
    .requiredOption("--operator-receipt <path>", "Verified actor receipt written by the protected task wrapper")
    .option("--json", "Output a safe JSON receipt", false)
    .action(async (options: { manifest: string; operatorReceipt: string; json?: boolean }) => {
      try {
        const manifest = readInspectionManifest(options.manifest, options.operatorReceipt);
        const result = await inspectEnrollment(process.env.HASNA_SKILLS_DATABASE_URL ?? "", manifest);
        console.log(JSON.stringify({
          ...result,
          operationId: manifest.operationId,
          enrollmentOperationId: manifest.enrollmentOperationId,
          enrollmentManifestDigest: manifest.enrollmentManifestDigest,
          keyId: manifest.keyId,
          orgId: manifest.orgId,
          stationId: manifest.stationId,
        }));
      } catch (error) {
        const code = error instanceof InspectionInputError || error instanceof EnrollmentInspectionError ? error.code : "INSPECTION_FAILED";
        if (options.json || !process.stdout.isTTY) console.log(JSON.stringify({ status: "failed", code }));
        else console.error(code);
        process.exitCode = 1;
      }
    });
  maintenance.command("enroll-publish")
    .requiredOption("--manifest <path>", "Bounded target manifest supplied by the protected task wrapper")
    .requiredOption("--operator-receipt <path>", "Verified actor receipt written by the protected task wrapper")
    .option("--apply", "Commit the bounded scope update; defaults to dry-run", false)
    .option("--json", "Output a safe JSON receipt", false)
    .action(async (options: { manifest: string; operatorReceipt: string; apply?: boolean; json?: boolean }) => {
      let manifest: EnrollmentManifest;
      let store: Awaited<ReturnType<typeof createStore>> | undefined;
      try {
        manifest = readManifest(options.manifest, options.operatorReceipt);
        if (!validOperatorScopeEnrollmentInput(manifest)) throw new Error("maintenance manifest fields are invalid or unbounded");
        const databaseUrl = process.env.HASNA_SKILLS_DATABASE_URL;
        if (!databaseUrl) throw new Error("maintenance requires HASNA_SKILLS_DATABASE_URL");
        store = await createStore({ databaseUrl });
        const snapshot = await store.inspectOperatorScopeTarget?.(manifest.keyId, manifest.orgId);
        if (!snapshot) throw new Error("configured store does not support operator maintenance");
        if (snapshot.kind !== "found") throw new Error(`operator target ${snapshot.kind}`);
        if (!validOperatorScopeList(snapshot.scopes)) throw new Error("store returned invalid scope metadata");
        const base = { status: "dry-run", operationId: manifest.operationId, keyId: manifest.keyId, stationId: manifest.stationId, orgId: manifest.orgId, expectedScopes: manifest.expectedScopes, currentScopes: snapshot.scopes, addScopes: ["skills:publish"] };
        if (!options.apply) {
          console.log(JSON.stringify(base));
          return;
        }
        const result = await store.enrollPublishScopeByOperator?.(manifest);
        if (!result) throw new Error("configured store does not support operator maintenance");
        if ("scopes" in result && !validOperatorScopeList(result.scopes)) throw new Error("store returned invalid scope metadata");
        console.log(JSON.stringify({ ...base, status: result.kind, scopes: "scopes" in result ? result.scopes : undefined }));
        if (result.kind === "updated" || result.kind === "already_applied") return;
        process.exitCode = 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const code = message.includes("expired") || message.includes("expiry") ? "INVALID_EXPIRY" : message.includes("receipt") || message.includes("operator") ? "INVALID_OPERATOR_RECEIPT" : message.includes("manifest") || message.includes("input") ? "INVALID_MANIFEST" : message.includes("database") || message.includes("store") ? "STORE_UNAVAILABLE" : "MAINTENANCE_FAILED";
        if (options.json || !process.stdout.isTTY) console.log(JSON.stringify({ status: "failed", code }));
        else console.error(code);
        process.exitCode = 1;
      } finally {
        await store?.close?.();
      }
    });
}
