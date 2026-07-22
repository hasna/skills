\set ON_ERROR_STOP on

BEGIN;

CREATE SCHEMA migration_0003_fixture;
SET LOCAL search_path TO migration_0003_fixture, public;

\ir ../../migrations/0001_open_skills_self_hosted.sql

INSERT INTO organizations (id, slug, name)
VALUES ('org_fingerprint', 'fingerprint', 'Fingerprint fixture');

INSERT INTO users (id, email, name)
VALUES ('user_fingerprint', 'fingerprint@example.com', 'Fingerprint fixture');

INSERT INTO skills_runs (
  id,
  org_id,
  user_id,
  skill_slug,
  requested_slug,
  status,
  input_json,
  args_json,
  idempotency_key,
  correlation_id
)
VALUES
  (
    'run_legacy_idempotent',
    'org_fingerprint',
    'user_fingerprint',
    'audio-transcript-pack',
    'audio-transcript-pack',
    'queued',
    '{"prompt":"legacy"}'::jsonb,
    '["--format","md"]'::jsonb,
    'legacy-key',
    'correlation-legacy'
  ),
  (
    'run_without_key',
    'org_fingerprint',
    'user_fingerprint',
    'audio-transcript-pack',
    'audio-transcript-pack',
    'queued',
    '{}'::jsonb,
    '[]'::jsonb,
    NULL,
    'correlation-no-key'
  );

\ir ../../migrations/0003_run_request_fingerprint.sql

DO $$
DECLARE
  rejected_missing_fingerprint boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM skills_runs
    WHERE id = 'run_legacy_idempotent'
      AND request_fingerprint ~ '^legacy:[0-9a-f]{64}$'
  ) THEN
    RAISE EXCEPTION 'legacy idempotent row was not safely marked for compatibility';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM skills_runs
    WHERE id = 'run_without_key'
      AND request_fingerprint IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'non-idempotent legacy row received a request fingerprint';
  END IF;

  BEGIN
    INSERT INTO skills_runs (
      id, org_id, user_id, skill_slug, requested_slug, status,
      input_json, args_json, idempotency_key, correlation_id
    )
    VALUES (
      'run_invalid_new', 'org_fingerprint', 'user_fingerprint',
      'audio-transcript-pack', 'audio-transcript-pack', 'queued',
      '{}'::jsonb, '[]'::jsonb, 'new-key-without-fingerprint', 'correlation-invalid'
    );
  EXCEPTION WHEN check_violation THEN
    rejected_missing_fingerprint := true;
  END;

  IF NOT rejected_missing_fingerprint THEN
    RAISE EXCEPTION 'idempotent row without a request fingerprint was accepted';
  END IF;

  INSERT INTO skills_runs (
    id, org_id, user_id, skill_slug, requested_slug, status,
    input_json, args_json, idempotency_key, request_fingerprint, correlation_id
  )
  VALUES (
    'run_valid_new', 'org_fingerprint', 'user_fingerprint',
    'audio-transcript-pack', 'audio-transcript-pack', 'queued',
    '{}'::jsonb, '[]'::jsonb, 'new-key-with-fingerprint',
    'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    'correlation-valid'
  );
END
$$;

ROLLBACK;
