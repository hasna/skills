import { describe, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
import {
  artifactId,
  dateString,
  normalizeLimit,
  nowIso,
  parseJsonArray,
  parseJsonObject,
  rowToArtifact,
  rowToLog,
  rowToRun,
  rowToSkill,
  rowToSkillBundle,
  runId,
} from "./rows.js";

useDefaultTestTimeout();

describe("server row helpers", () => {
  test("normalizes limits, timestamps, and generated ids", () => {
    expect(normalizeLimit(4.9)).toBe(4);
    expect(normalizeLimit(-2)).toBe(0);
    expect(normalizeLimit(Number.NaN)).toBe(0);
    expect(normalizeLimit(Number.POSITIVE_INFINITY)).toBe(0);

    const timestamp = nowIso();
    expect(new Date(timestamp).toISOString()).toBe(timestamp);
    expect(dateString(new Date("2026-07-29T12:34:56.000Z"))).toBe("2026-07-29T12:34:56.000Z");
    expect(dateString("already-serialized")).toBe("already-serialized");

    const firstRunId = runId();
    const secondRunId = runId();
    expect(firstRunId).toMatch(/^run_[a-z0-9]+_[0-9a-f]{8}$/);
    expect(secondRunId).not.toBe(firstRunId);
    expect(artifactId()).toMatch(/^art_[0-9a-f]{20}$/);
  });

  test("parses driver JSON values and safely defaults malformed shapes", () => {
    const object = { topic: "tests", count: 2 };
    expect(parseJsonObject(object)).toBe(object);
    expect(parseJsonObject('{"ok":true}')).toEqual({ ok: true });
    expect(parseJsonObject("[1,2]")).toEqual({});
    expect(parseJsonObject("{broken")).toEqual({});
    expect(parseJsonObject(null)).toEqual({});

    expect(parseJsonArray(["one", 2, false])).toEqual(["one", "2", "false"]);
    expect(parseJsonArray('["a",3]')).toEqual(["a", "3"]);
    expect(parseJsonArray('{"not":"an array"}')).toEqual([]);
    expect(parseJsonArray("not-json")).toEqual([]);
    expect(parseJsonArray(undefined)).toEqual([]);
  });

  test("maps complete run, log, and artifact rows", () => {
    const createdAt = new Date("2026-07-29T01:00:00.000Z");
    const startedAt = new Date("2026-07-29T01:00:01.000Z");
    const completedAt = new Date("2026-07-29T01:00:02.000Z");
    expect(rowToRun({
      id: "run_1",
      org_id: "org_1",
      user_id: "user_1",
      skill_slug: "canonical-skill",
      requested_slug: "alias-skill",
      status: "succeeded",
      input_json: '{"topic":"testing"}',
      args_json: ["--json"],
      idempotency_key: "idem_1",
      correlation_id: "corr_1",
      cost_cents: "12",
      output_type: "application/json",
      output_preview: "done",
      error_code: "RECOVERED",
      error_message: "retry succeeded",
      created_at: createdAt,
      started_at: startedAt,
      completed_at: completedAt,
    })).toEqual({
      id: "run_1",
      orgId: "org_1",
      userId: "user_1",
      skill: "canonical-skill",
      requestedSlug: "alias-skill",
      status: "succeeded",
      input: { topic: "testing" },
      args: ["--json"],
      idempotencyKey: "idem_1",
      correlationId: "corr_1",
      costCents: 12,
      outputType: "application/json",
      outputPreview: "done",
      errorCode: "RECOVERED",
      errorMessage: "retry succeeded",
      createdAt: createdAt.toISOString(),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    });

    expect(rowToRun({
      id: 2,
      org_id: 3,
      user_id: 4,
      skill_slug: "skill",
      requested_slug: "skill",
      status: "queued",
      input_json: null,
      args_json: null,
      correlation_id: 5,
      created_at: "created",
    })).toEqual({
      id: "2",
      orgId: "3",
      userId: "4",
      skill: "skill",
      requestedSlug: "skill",
      status: "queued",
      input: {},
      args: [],
      correlationId: "5",
      costCents: 0,
      createdAt: "created",
    });

    expect(rowToLog({
      run_id: "run_1",
      sequence: "7",
      level: "warn",
      message: "slow",
      created_at: createdAt,
    })).toEqual({
      runId: "run_1",
      sequence: 7,
      level: "warn",
      message: "slow",
      createdAt: createdAt.toISOString(),
    });

    expect(rowToArtifact({
      id: "art_1",
      run_id: "run_1",
      org_id: "org_1",
      file_name: "report.txt",
      relative_path: "reports/report.txt",
      content_type: "text/plain",
      byte_size: "42",
      sha256: "a".repeat(64),
      storage_kind: "s3",
      storage_key: "bucket/key",
      body_text: "cached",
      created_at: createdAt,
    })).toEqual({
      id: "art_1",
      runId: "run_1",
      orgId: "org_1",
      fileName: "report.txt",
      relativePath: "reports/report.txt",
      contentType: "text/plain",
      byteSize: 42,
      sha256: "a".repeat(64),
      storageKind: "s3",
      storageKey: "bucket/key",
      bodyText: "cached",
      createdAt: createdAt.toISOString(),
    });
  });

  test("maps skill and bundle rows while owning returned binary data", () => {
    const skill = rowToSkill({
      org_id: "org_1",
      slug: "release-notes",
      display_name: "Release Notes",
      description: null,
      category: "Writing",
      tags_json: '["release",2]',
      source: "private",
      kind: "instruction",
      version: "1.2.3",
      skill_md: "# Release Notes",
      bundle_sha256: "b".repeat(64),
      bundle_byte_size: "123",
      published_by_user_id: "user_1",
      created_at: "created",
      updated_at: new Date("2026-07-29T02:00:00.000Z"),
    });
    expect(skill).toEqual({
      orgId: "org_1",
      slug: "release-notes",
      displayName: "Release Notes",
      description: "",
      category: "Writing",
      tags: ["release", "2"],
      source: "private",
      kind: "instruction",
      version: "1.2.3",
      skillMd: "# Release Notes",
      bundleSha256: "b".repeat(64),
      bundleByteSize: 123,
      publishedByUserId: "user_1",
      createdAt: "created",
      updatedAt: "2026-07-29T02:00:00.000Z",
    });

    expect(rowToSkill({
      org_id: "org_2",
      slug: "runner",
      display_name: "Runner",
      description: "Runs",
      category: "Tools",
      tags_json: [],
      source: "official",
      kind: "unexpected",
      bundle_byte_size: null,
      created_at: "created",
      updated_at: "updated",
    })).toMatchObject({ kind: "executable", tags: [] });

    const source = new Uint8Array([1, 2, 3]);
    const bundle = rowToSkillBundle({
      org_id: "org_1",
      sha256: "c".repeat(64),
      byte_size: 3,
      content_type: "application/gzip",
      storage_kind: "db",
      storage_key: "ignored-for-db",
      body_blob: source,
      created_at: "created",
    });
    source[0] = 99;
    expect(Array.from(bundle.bytes!)).toEqual([1, 2, 3]);
    expect(bundle).toMatchObject({
      orgId: "org_1",
      byteSize: 3,
      contentType: "application/gzip",
      storageKind: "db",
      storageKey: "ignored-for-db",
      createdAt: "created",
    });

    const arrayBuffer = new Uint8Array([4, 5]).buffer;
    expect(Array.from(rowToSkillBundle({
      org_id: "org_2",
      sha256: "d".repeat(64),
      byte_size: 2,
      content_type: "application/gzip",
      storage_kind: "db",
      body_blob: arrayBuffer,
      created_at: "created",
    }).bytes!)).toEqual([4, 5]);
    expect(rowToSkillBundle({
      org_id: "org_3",
      sha256: "e".repeat(64),
      byte_size: 0,
      content_type: "application/gzip",
      storage_kind: "s3",
      body_blob: null,
      created_at: "created",
    }).bytes).toBeUndefined();
  });
});
