ALTER TABLE skills_runs
  ADD COLUMN IF NOT EXISTS request_fingerprint text;

-- Historical rows did not retain approval or quote fields, so their exact
-- request cannot be reconstructed. Mark them explicitly and allow the store to
-- upgrade only a request whose recoverable skill/input/args fields match and
-- which supplies no authorization fields. All other legacy retries fail closed.
UPDATE skills_runs
SET request_fingerprint = 'legacy:' || encode(digest(
  concat_ws(
    E'\x1f',
    id,
    org_id,
    idempotency_key,
    skill_slug,
    requested_slug,
    input_json::text,
    args_json::text
  ),
  'sha256'
), 'hex')
WHERE idempotency_key IS NOT NULL
  AND request_fingerprint IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'skills_runs'::regclass
      AND conname = 'skills_runs_idempotency_fingerprint_check'
  ) THEN
    ALTER TABLE skills_runs
      ADD CONSTRAINT skills_runs_idempotency_fingerprint_check
      CHECK (
        (idempotency_key IS NULL AND request_fingerprint IS NULL)
        OR (
          idempotency_key IS NOT NULL
          AND request_fingerprint IS NOT NULL
          AND (
            request_fingerprint ~ '^sha256:[0-9a-f]{64}$'
            OR request_fingerprint ~ '^legacy:[0-9a-f]{64}$'
          )
        )
      ) NOT VALID;
  END IF;
END
$$;

ALTER TABLE skills_runs
  VALIDATE CONSTRAINT skills_runs_idempotency_fingerprint_check;
