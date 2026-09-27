import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { ApiPrincipal } from "./types.js";
import type {
  ExecutionGrant,
  ExecutionGrantPolicy,
} from "../lib/execution-grants.js";

export interface ExecutionGrantStore {
  get(
    principal: ApiPrincipal,
    profileId: string,
    revision?: string
  ): Promise<ExecutionGrantPolicy | null>;
  /** Atomically change the current revision and append immutable history. Null is a CAS conflict. */
  save(
    principal: ApiPrincipal,
    profileId: string,
    grants: ExecutionGrant[],
    expected: string | null
  ): Promise<ExecutionGrantPolicy | null>;
}
function next(
  p: ApiPrincipal,
  id: string,
  grants: ExecutionGrant[],
  expected: string | null
): ExecutionGrantPolicy {
  return {
    schema: "hasna.skills-execution-grants.v1",
    profileId: id,
    workspaceId: p.orgId,
    revision: randomUUID(),
    previousRevision: expected,
    updatedAt: new Date().toISOString(),
    actorId: p.userId,
    grants: structuredClone(grants),
  };
}
type Row = Record<string, unknown>;
function document(row: Row | undefined | null): ExecutionGrantPolicy | null {
  return row
    ? ((typeof row.document_json === "string"
        ? JSON.parse(row.document_json)
        : structuredClone(row.document_json)) as ExecutionGrantPolicy)
    : null;
}
export class MemoryExecutionGrantStore implements ExecutionGrantStore {
  private current = new Map<string, ExecutionGrantPolicy>();
  private history = new Map<string, ExecutionGrantPolicy>();
  async get(p: ApiPrincipal, id: string, revision?: string) {
    return structuredClone(
      (revision
        ? this.history.get(JSON.stringify([p.orgId, id, revision]))
        : this.current.get(JSON.stringify([p.orgId, id]))) ?? null
    );
  }
  async save(
    p: ApiPrincipal,
    id: string,
    grants: ExecutionGrant[],
    expected: string | null
  ) {
    const key = JSON.stringify([p.orgId, id]);
    if ((this.current.get(key)?.revision ?? null) !== expected) return null;
    const value = next(p, id, grants, expected);
    this.current.set(key, value);
    this.history.set(JSON.stringify([p.orgId, id, value.revision]), value);
    return structuredClone(value);
  }
}
export class SqliteExecutionGrantStore implements ExecutionGrantStore {
  constructor(private db: Database) {}
  async get(p: ApiPrincipal, id: string, revision?: string) {
    return document(
      (revision
        ? this.db
            .query(
              "SELECT document_json FROM skills_execution_grant_revisions WHERE org_id=? AND profile_id=? AND revision=?"
            )
            .get(p.orgId, id, revision)
        : this.db
            .query(
              "SELECT document_json FROM skills_execution_grants WHERE org_id=? AND profile_id=?"
            )
            .get(p.orgId, id)) as Row | null
    );
  }
  async save(
    p: ApiPrincipal,
    id: string,
    grants: ExecutionGrant[],
    expected: string | null
  ) {
    return this.db.transaction(() => {
      const value = next(p, id, grants, expected),
        json = JSON.stringify(value);
      const row =
        expected === null
          ? this.db
              .query(
                "INSERT INTO skills_execution_grants(org_id,profile_id,revision,document_json) VALUES(?,?,?,?) ON CONFLICT(org_id,profile_id) DO NOTHING RETURNING document_json"
              )
              .get(p.orgId, id, value.revision, json)
          : this.db
              .query(
                "UPDATE skills_execution_grants SET revision=?,document_json=? WHERE org_id=? AND profile_id=? AND revision=? RETURNING document_json"
              )
              .get(value.revision, json, p.orgId, id, expected);
      if (!row) return null;
      this.db
        .query(
          "INSERT INTO skills_execution_grant_revisions(org_id,profile_id,revision,document_json) VALUES(?,?,?,?)"
        )
        .run(p.orgId, id, value.revision, json);
      return document(row as Row);
    })();
  }
}
type Sql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Row[]>;
export class PostgresExecutionGrantStore implements ExecutionGrantStore {
  constructor(private sql: Sql) {}
  async get(p: ApiPrincipal, id: string, revision?: string) {
    const rows = revision
      ? await this
          .sql`SELECT document_json FROM skills_execution_grant_revisions WHERE org_id=${p.orgId} AND profile_id=${id} AND revision=${revision}`
      : await this
          .sql`SELECT document_json FROM skills_execution_grants WHERE org_id=${p.orgId} AND profile_id=${id}`;
    return document(rows[0]);
  }
  async save(
    p: ApiPrincipal,
    id: string,
    grants: ExecutionGrant[],
    expected: string | null
  ) {
    const value = next(p, id, grants, expected),
      json = JSON.stringify(value);
    const rows =
      expected === null
        ? await this
            .sql`WITH changed AS (INSERT INTO skills_execution_grants(org_id,profile_id,revision,document_json) VALUES(${p.orgId},${id},${value.revision},${json}::jsonb) ON CONFLICT(org_id,profile_id) DO NOTHING RETURNING *) INSERT INTO skills_execution_grant_revisions(org_id,profile_id,revision,document_json) SELECT org_id,profile_id,revision,document_json FROM changed RETURNING document_json`
        : await this
            .sql`WITH changed AS (UPDATE skills_execution_grants SET revision=${value.revision},document_json=${json}::jsonb WHERE org_id=${p.orgId} AND profile_id=${id} AND revision=${expected} RETURNING *) INSERT INTO skills_execution_grant_revisions(org_id,profile_id,revision,document_json) SELECT org_id,profile_id,revision,document_json FROM changed RETURNING document_json`;
    return document(rows[0]);
  }
}
