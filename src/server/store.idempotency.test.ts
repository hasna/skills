import { describe, expect, test } from "bun:test";
import {
  MemorySkillsStore,
  PostgresSkillsStore,
  createRunRequestFingerprint,
  type SkillsSqlTag,
} from "./store.js";
import { IdempotencyKeyReuseError, type ApiPrincipal, type CreateRunInput } from "./types.js";

const principal: ApiPrincipal = {
  apiKeyId: "key_probe",
  orgId: "org_probe",
  orgSlug: "probe",
  orgName: "Probe",
  userId: "user_probe",
  email: "probe@example.com",
  role: "owner",
  scopes: ["runs:write"],
};

const baseInput: CreateRunInput = {
  principal,
  slug: "audio-transcript-pack",
  requestedSlug: "audio-transcript-pack",
  input: { prompt: "exact", nested: { z: 2, a: 1 } },
  args: ["--format", "md"],
  idempotencyKey: "postgres-probe-key",
  approved: true,
  quoteToken: "quote_exact",
};

function rowFor(input: CreateRunInput, fingerprint: string): Record<string, unknown> {
  return {
    id: "run_existing",
    org_id: input.principal.orgId,
    user_id: input.principal.userId,
    skill_slug: input.slug,
    requested_slug: input.requestedSlug ?? input.slug,
    status: "queued",
    input_json: input.input,
    args_json: input.args,
    idempotency_key: input.idempotencyKey,
    request_fingerprint: fingerprint,
    correlation_id: "correlation_existing",
    created_at: "2026-07-22T12:00:00.000Z",
  };
}

function sqlProbe(
  handler: (query: string, values: unknown[]) => Promise<Record<string, unknown>[]>,
): SkillsSqlTag {
  const tag = ((strings: TemplateStringsArray, ...values: unknown[]) => (
    handler(strings.join("?"), values)
  )) as SkillsSqlTag;
  tag.unsafe = async () => [];
  return tag;
}

describe("PostgresSkillsStore request-bound idempotency", () => {
  test("inserts the canonical request fingerprint with the run", async () => {
    let insertQuery = "";
    let insertValues: unknown[] = [];
    const expected = createRunRequestFingerprint(baseInput);
    const sql = sqlProbe(async (query, values) => {
      insertQuery = query;
      insertValues = values;
      return [rowFor(baseInput, expected)];
    });

    const result = await new PostgresSkillsStore("postgres://unused", sql).createRun(baseInput);

    expect(result).toMatchObject({ created: true, run: { requestFingerprint: expected } });
    expect(insertQuery).toContain("request_fingerprint");
    expect(insertValues).toContain(expected);
    expect(expected).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("replays only an exact fingerprint and rejects a mismatched conflict", async () => {
    const originalFingerprint = createRunRequestFingerprint(baseInput);
    const queries: string[] = [];
    const sql = sqlProbe(async (query) => {
      queries.push(query);
      if (query.includes("INSERT INTO skills_runs")) return [];
      if (query.includes("SELECT * FROM skills_runs")) return [rowFor(baseInput, originalFingerprint)];
      throw new Error(`unexpected SQL probe query: ${query}`);
    });
    const store = new PostgresSkillsStore("postgres://unused", sql);

    await expect(store.createRun({
      ...baseInput,
      input: { nested: { a: 1, z: 2 }, prompt: "exact" },
    })).resolves.toMatchObject({ created: false, run: { id: "run_existing" } });

    const conflict = store.createRun({ ...baseInput, args: ["--format", "json"] });
    await expect(conflict).rejects.toBeInstanceOf(IdempotencyKeyReuseError);
    await expect(conflict).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(queries.filter((query) => query.includes("SELECT * FROM skills_runs"))).toHaveLength(2);
  });

  test("upgrades only a recoverable legacy replay without authorization fields", async () => {
    const legacyInput: CreateRunInput = {
      ...baseInput,
      approved: undefined,
      quoteToken: undefined,
    };
    const upgradedFingerprint = createRunRequestFingerprint(legacyInput);
    const queries: string[] = [];
    const sql = sqlProbe(async (query) => {
      queries.push(query);
      if (query.includes("INSERT INTO skills_runs")) return [];
      if (query.includes("SELECT * FROM skills_runs")) return [rowFor(legacyInput, "legacy:0123456789abcdef")];
      if (query.includes("UPDATE skills_runs")) return [rowFor(legacyInput, upgradedFingerprint)];
      throw new Error(`unexpected SQL probe query: ${query}`);
    });

    await expect(new PostgresSkillsStore("postgres://unused", sql).createRun(legacyInput)).resolves.toMatchObject({
      created: false,
      run: { requestFingerprint: upgradedFingerprint },
    });
    expect(queries.find((query) => query.includes("UPDATE skills_runs"))).toContain("org_id =");

    const authorizationSql = sqlProbe(async (query) => {
      if (query.includes("INSERT INTO skills_runs")) return [];
      if (query.includes("SELECT * FROM skills_runs")) return [rowFor(legacyInput, "legacy:0123456789abcdef")];
      throw new Error("legacy replay with authorization must not upgrade");
    });
    await expect(new PostgresSkillsStore("postgres://unused", authorizationSql).createRun({
      ...legacyInput,
      approved: true,
    })).rejects.toBeInstanceOf(IdempotencyKeyReuseError);
  });
});

describe("MemorySkillsStore tenant-scoped idempotency", () => {
  test("does not collide when organization IDs and keys contain the same delimiter", async () => {
    const store = new MemorySkillsStore();
    const first = await store.createRun({
      ...baseInput,
      principal: { ...principal, orgId: "org:a" },
      idempotencyKey: "b",
    });
    const second = await store.createRun({
      ...baseInput,
      principal: { ...principal, orgId: "org" },
      idempotencyKey: "a:b",
      input: { prompt: "different tenant" },
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(second.run.id).not.toBe(first.run.id);
  });
});
