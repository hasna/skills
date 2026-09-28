import { SQL } from "bun";
import { validOperatorScopeList } from "./types.js";

export interface EnrollmentInspectionInput {
  keyId: string;
  orgId: string;
  enrollmentOperationId: string;
  enrollmentManifestDigest: string;
}

export interface EnrollmentInspectionResult {
  status: "inspected";
  target: { state: "found"; scopes: string[] } | { state: "absent" | "revoked" | "mismatched" | "ambiguous" };
  audit: { state: "absent" | "matching" | "mismatched" | "ambiguous" };
}

type InspectionCode = "INVALID_INSPECTION_INPUT" | "POSTGRES_REQUIRED" | "INVALID_INSPECTION_RESULT" | "INSPECTION_FAILED"
  | "INSPECTION_SCHEMA_UNAVAILABLE" | "INSPECTION_ACCESS_DENIED" | "INSPECTION_WRITE_REFUSED"
  | "INSPECTION_TIMEOUT" | "INSPECTION_CONNECTION_FAILED";

export class EnrollmentInspectionError extends Error {
  constructor(readonly code: InspectionCode) {
    super(code);
    this.name = "EnrollmentInspectionError";
  }
}

const refuse = (code: InspectionCode): never => { throw new EnrollmentInspectionError(code); };
const boundedId = (value: unknown): value is string => typeof value === "string"
  && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);

/** Inspect metadata only. Deliberately does not import or initialize the application store. */
export async function inspectEnrollment(databaseUrl: string, input: EnrollmentInspectionInput): Promise<EnrollmentInspectionResult> {
  if (!input || !boundedId(input.keyId) || !boundedId(input.orgId) || !boundedId(input.enrollmentOperationId)
      || typeof input.enrollmentManifestDigest !== "string" || !/^[a-f0-9]{64}$/.test(input.enrollmentManifestDigest)) {
    refuse("INVALID_INSPECTION_INPUT");
  }
  try {
    const url = new URL(databaseUrl);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) refuse("POSTGRES_REQUIRED");
  } catch {
    refuse("POSTGRES_REQUIRED");
  }

  let sql: SQL | undefined;
  try {
    sql = new SQL(databaseUrl, { max: 1, connectionTimeout: 5, idleTimeout: 5 });
    return await sql.begin("ISOLATION LEVEL REPEATABLE READ READ ONLY", async (tx): Promise<EnrollmentInspectionResult> => {
      await tx.unsafe("SET LOCAL statement_timeout = '5s'");
      await tx.unsafe("SET LOCAL lock_timeout = '1s'");
      const mode = await tx`SELECT current_setting('transaction_read_only') AS read_only,
        current_setting('transaction_isolation') AS isolation`;
      if (mode.length !== 1 || mode[0].read_only !== "on" || mode[0].isolation !== "repeatable read") refuse("INSPECTION_FAILED");

      // Select neither credentials nor foreign identifiers; two rows suffice to refuse ambiguity.
      const targets = await tx`SELECT org_id = ${input.orgId} AS org_matches,
        revoked_at IS NOT NULL AS revoked,
        CASE WHEN org_id = ${input.orgId} AND revoked_at IS NULL
          AND octet_length(scopes_json::text) <= 8192 THEN scopes_json::text ELSE NULL END AS scopes_json
        FROM api_keys WHERE id = ${input.keyId} LIMIT 2`;
      let target: EnrollmentInspectionResult["target"];
      if (targets.length > 1) target = { state: "ambiguous" };
      else if (!targets.length) target = { state: "absent" };
      else {
        const row = targets[0];
        if (typeof row.org_matches !== "boolean" || typeof row.revoked !== "boolean") refuse("INVALID_INSPECTION_RESULT");
        if (!row.org_matches) target = { state: "mismatched" };
        else if (row.revoked) target = { state: "revoked" };
        else {
          let scopes: unknown;
          try { scopes = typeof row.scopes_json === "string" ? JSON.parse(row.scopes_json) : null; }
          catch { refuse("INVALID_INSPECTION_RESULT"); }
          if (!validOperatorScopeList(scopes)) return refuse("INVALID_INSPECTION_RESULT");
          target = { state: "found", scopes: [...scopes] };
        }
      }

      const audits = await tx`SELECT org_id = ${input.orgId} AS org_matches,
        target_type = 'api_key' AND target_id = ${input.keyId} AS target_matches,
        jsonb_typeof(metadata_json) = 'object'
          AND jsonb_typeof(metadata_json->'target_manifest_digest') = 'string'
          AND (metadata_json->>'target_manifest_digest') ~ '^[a-f0-9]{64}$' AS digest_valid,
        metadata_json->>'target_manifest_digest' = ${input.enrollmentManifestDigest} AS digest_matches
        FROM skills_audit_events WHERE action = 'api_key_scopes_added'
          AND operator_operation_id = ${input.enrollmentOperationId} LIMIT 2`;
      let audit: EnrollmentInspectionResult["audit"];
      if (audits.length > 1) audit = { state: "ambiguous" };
      else if (!audits.length) audit = { state: "absent" };
      else {
        const row = audits[0];
        if (row.digest_valid !== true || [row.org_matches, row.target_matches, row.digest_matches].some(value => typeof value !== "boolean")) {
          refuse("INVALID_INSPECTION_RESULT");
        }
        audit = { state: row.org_matches && row.target_matches && row.digest_matches ? "matching" : "mismatched" };
      }
      return { status: "inspected", target, audit };
    });
  } catch (error) {
    if (error instanceof EnrollmentInspectionError) throw error;
    // Never retain a driver message, cause, query, URL or unrecognized code.
    const state = error instanceof SQL.PostgresError ? error.errno : undefined;
    const code: InspectionCode = state === "42P01" || state === "42703" ? "INSPECTION_SCHEMA_UNAVAILABLE"
      : state === "42501" ? "INSPECTION_ACCESS_DENIED"
      : state === "25006" ? "INSPECTION_WRITE_REFUSED"
      : state === "57014" || state === "55P03" ? "INSPECTION_TIMEOUT"
      : ["08000", "08001", "08003", "08004", "08006", "08007", "08P01", "28000", "28P01", "57P03"].includes(state ?? "")
        ? "INSPECTION_CONNECTION_FAILED" : "INSPECTION_FAILED";
    throw new EnrollmentInspectionError(code);
  } finally {
    try { await sql?.close({ timeout: 1 }); }
    catch { throw new EnrollmentInspectionError("INSPECTION_FAILED"); }
  }
}
