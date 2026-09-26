import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { ApiPrincipal } from "./types.js";
import type {
  SkillProfile,
  SkillSelection,
  StationSkillState,
  StationSkillStateInput,
} from "../types/skill-selection.js";

export interface SkillSelectionStore {
  profilesReferencingSkill(principal: ApiPrincipal, slug: string): Promise<string[]>;
  getProfile(principal: ApiPrincipal, id: string): Promise<SkillProfile | null>;
  /** null expected revision means create-only; null result means CAS conflict. */
  saveProfile(
    principal: ApiPrincipal,
    id: string,
    selections: SkillSelection[],
    expected: string | null,
  ): Promise<SkillProfile | null>;
  getStationState(
    principal: ApiPrincipal,
    id: string,
  ): Promise<StationSkillState | null>;
  /** Refuses an obsolete profile revision atomically with storing the receipt. */
  saveStationState(
    principal: ApiPrincipal,
    id: string,
    input: StationSkillStateInput,
  ): Promise<StationSkillState | null>;
}
type Row = Record<string, unknown>;
function selections(value: unknown): SkillSelection[] {
  return typeof value === "string"
    ? JSON.parse(value)
    : (structuredClone(value) as SkillSelection[]);
}
function time(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
function profile(row: Row): SkillProfile {
  return {
    id: String(row.profile_id),
    workspaceId: String(row.org_id),
    revision: String(row.revision),
    selections: selections(row.selections_json),
    updatedAt: time(row.updated_at),
  };
}
function state(row: Row): StationSkillState {
  return {
    stationId: String(row.station_id),
    workspaceId: String(row.org_id),
    actorId: String(row.actor_id),
    profileId: String(row.profile_id),
    profileRevision: String(row.profile_revision),
    selections: selections(row.selections_json),
    appliedAt: time(row.applied_at),
  };
}

export class MemorySkillSelectionStore implements SkillSelectionStore {
  private profiles = new Map<string, SkillProfile>();
  private states = new Map<string, StationSkillState>();
  private key(...values: string[]) {
    return JSON.stringify(values);
  }
  async getProfile(p: ApiPrincipal, id: string) {
    return structuredClone(this.profiles.get(this.key(p.orgId, id)) ?? null);
  }
  async profilesReferencingSkill(p: ApiPrincipal, slug: string) {
    return [...this.profiles.values()].filter((profile) => profile.workspaceId === p.orgId && profile.selections.some((selection) => selection.slug === slug)).map((profile) => profile.id).sort();
  }
  async saveProfile(
    p: ApiPrincipal,
    id: string,
    selected: SkillSelection[],
    expected: string | null,
  ) {
    const key = this.key(p.orgId, id),
      previous = this.profiles.get(key);
    if ((previous?.revision ?? null) !== expected) return null;
    const next: SkillProfile = {
      id,
      workspaceId: p.orgId,
      revision: randomUUID(),
      selections: structuredClone(selected),
      updatedAt: new Date().toISOString(),
    };
    this.profiles.set(key, next);
    return structuredClone(next);
  }
  async getStationState(p: ApiPrincipal, id: string) {
    return structuredClone(
      this.states.get(this.key(p.orgId, p.userId, id)) ?? null,
    );
  }
  async saveStationState(
    p: ApiPrincipal,
    id: string,
    input: StationSkillStateInput,
  ) {
    if (
      this.profiles.get(this.key(p.orgId, input.profileId))?.revision !==
      input.profileRevision
    )
      return null;
    const next: StationSkillState = {
      ...structuredClone(input),
      stationId: id,
      workspaceId: p.orgId,
      actorId: p.userId,
      appliedAt: new Date().toISOString(),
    };
    this.states.set(this.key(p.orgId, p.userId, id), next);
    return structuredClone(next);
  }
}

export class SqliteSkillSelectionStore implements SkillSelectionStore {
  constructor(private db: Database) {}
  async profilesReferencingSkill(p: ApiPrincipal, slug: string) {
    const rows = this.db.query("SELECT profile_id,selections_json FROM skills_profiles WHERE org_id=?").all(p.orgId) as Row[];
    return rows.filter((row) => selections(row.selections_json).some((selection) => selection.slug === slug)).map((row) => String(row.profile_id)).sort();
  }
  async getProfile(p: ApiPrincipal, id: string) {
    const row = this.db
      .query("SELECT * FROM skills_profiles WHERE org_id=? AND profile_id=?")
      .get(p.orgId, id) as Row | null;
    return row ? profile(row) : null;
  }
  async saveProfile(
    p: ApiPrincipal,
    id: string,
    selected: SkillSelection[],
    expected: string | null,
  ) {
    return this.db.transaction(() => {
      // The registry rows are the lifecycle fence. A profile write locks every
      // selected skill before checking/writing the profile, so archive and
      // profile selection cannot pass each other's precondition concurrently.
      for (const selection of [...selected].sort((a, b) => a.slug.localeCompare(b.slug))) {
        const skill = this.db.query("SELECT lifecycle FROM skills_registry WHERE org_id=? AND slug=?").get(p.orgId, selection.slug) as Row | null;
        if (skill?.lifecycle === "archived") return null;
      }
      const revision = randomUUID(), timestamp = new Date().toISOString();
      const row = expected === null
        ? this.db.query("INSERT INTO skills_profiles(org_id,profile_id,revision,selections_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(org_id,profile_id) DO NOTHING RETURNING *").get(p.orgId, id, revision, JSON.stringify(selected), timestamp)
        : this.db.query("UPDATE skills_profiles SET revision=?,selections_json=?,updated_at=? WHERE org_id=? AND profile_id=? AND revision=? RETURNING *").get(revision, JSON.stringify(selected), timestamp, p.orgId, id, expected);
      return row ? profile(row as Row) : null;
    }).immediate();
  }
  async getStationState(p: ApiPrincipal, id: string) {
    const row = this.db
      .query(
        "SELECT * FROM skills_station_state WHERE org_id=? AND actor_id=? AND station_id=?",
      )
      .get(p.orgId, p.userId, id) as Row | null;
    return row ? state(row) : null;
  }
  async saveStationState(
    p: ApiPrincipal,
    id: string,
    input: StationSkillStateInput,
  ) {
    const row = this.db
      .query(
        `INSERT INTO skills_station_state(org_id,actor_id,station_id,profile_id,profile_revision,selections_json,applied_at)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM skills_profiles WHERE org_id=? AND profile_id=? AND revision=?)
      ON CONFLICT(org_id,actor_id,station_id) DO UPDATE SET profile_id=excluded.profile_id,profile_revision=excluded.profile_revision,selections_json=excluded.selections_json,applied_at=excluded.applied_at RETURNING *`,
      )
      .get(
        p.orgId,
        p.userId,
        id,
        input.profileId,
        input.profileRevision,
        JSON.stringify(input.selections),
        new Date().toISOString(),
        p.orgId,
        input.profileId,
        input.profileRevision,
      );
    return row ? state(row as Row) : null;
  }
}

type Sql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Row[]>;
type SqlTransaction = Sql;
// The product and selection stores share the same pooled transaction so the
// registry-row lifecycle fence is held while a profile is written.
interface SqlWithTransaction extends Sql {
  begin<T>(fn: (tx: SqlTransaction) => Promise<T>): Promise<T>;
}
export class PostgresSkillSelectionStore implements SkillSelectionStore {
  constructor(private sql: SqlWithTransaction) {}
  async profilesReferencingSkill(p: ApiPrincipal, slug: string) {
    const rows = await this.sql`SELECT profile_id,selections_json FROM skills_profiles WHERE org_id=${p.orgId}`;
    return rows.filter((row) => selections(row.selections_json).some((selection) => selection.slug === slug)).map((row) => String(row.profile_id)).sort();
  }
  async getProfile(p: ApiPrincipal, id: string) {
    const rows = await this
      .sql`SELECT * FROM skills_profiles WHERE org_id=${p.orgId} AND profile_id=${id}`;
    return rows[0] ? profile(rows[0]) : null;
  }
  async saveProfile(
    p: ApiPrincipal,
    id: string,
    selected: SkillSelection[],
    expected: string | null,
  ) {
    return this.sql.begin(async (tx) => {
      // Lock registry rows as the shared lifecycle fence. Archive takes the
      // same row locks before checking profiles, eliminating the read/write
      // race between selection and archival.
      for (const selection of [...selected].sort((a, b) => a.slug.localeCompare(b.slug))) {
        const rows = await tx`SELECT lifecycle FROM skills_registry WHERE org_id=${p.orgId} AND slug=${selection.slug} FOR UPDATE`;
        if (rows[0]?.lifecycle === "archived") return null;
      }
      const revision = randomUUID(), timestamp = new Date().toISOString();
      const rows = expected === null
        ? await tx`INSERT INTO skills_profiles(org_id,profile_id,revision,selections_json,updated_at) VALUES(${p.orgId},${id},${revision},${JSON.stringify(selected)}::jsonb,${timestamp}) ON CONFLICT(org_id,profile_id) DO NOTHING RETURNING *`
        : await tx`UPDATE skills_profiles SET revision=${revision},selections_json=${JSON.stringify(selected)}::jsonb,updated_at=${timestamp} WHERE org_id=${p.orgId} AND profile_id=${id} AND revision=${expected} RETURNING *`;
      return rows[0] ? profile(rows[0]) : null;
    });
  }
  async getStationState(p: ApiPrincipal, id: string) {
    const rows = await this
      .sql`SELECT * FROM skills_station_state WHERE org_id=${p.orgId} AND actor_id=${p.userId} AND station_id=${id}`;
    return rows[0] ? state(rows[0]) : null;
  }
  async saveStationState(
    p: ApiPrincipal,
    id: string,
    input: StationSkillStateInput,
  ) {
    const rows = await this
      .sql`INSERT INTO skills_station_state(org_id,actor_id,station_id,profile_id,profile_revision,selections_json,applied_at)
      SELECT ${p.orgId},${p.userId},${id},${input.profileId},${input.profileRevision},${JSON.stringify(input.selections)}::jsonb,${new Date().toISOString()}
      WHERE EXISTS(SELECT 1 FROM skills_profiles WHERE org_id=${p.orgId} AND profile_id=${input.profileId} AND revision=${input.profileRevision})
      ON CONFLICT(org_id,actor_id,station_id) DO UPDATE SET profile_id=excluded.profile_id,profile_revision=excluded.profile_revision,selections_json=excluded.selections_json,applied_at=excluded.applied_at RETURNING *`;
    return rows[0] ? state(rows[0]) : null;
  }
}
