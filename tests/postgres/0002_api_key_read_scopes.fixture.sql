\set ON_ERROR_STOP on

BEGIN;

CREATE SCHEMA migration_0002_fixture;
SET LOCAL search_path TO migration_0002_fixture, public;

\ir ../../migrations/0001_open_skills_self_hosted.sql

INSERT INTO organizations (id, slug, name)
VALUES ('org_dev', 'dev', 'Development');

INSERT INTO users (id, email, name)
VALUES ('user_dev', 'dev@skills.hasna.xyz', 'Legacy development user');

INSERT INTO organization_members (org_id, user_id, role)
VALUES ('org_dev', 'user_dev', 'owner');

INSERT INTO api_keys (id, org_id, user_id, name, key_hash, scopes_json)
VALUES
  (
    'key_dev',
    'org_dev',
    'user_dev',
    'bootstrap',
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    '["skills:read","runs:write"]'::jsonb
  ),
  (
    'key_other',
    'org_dev',
    'user_dev',
    'operator-created',
    'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    '["skills:read"]'::jsonb
  );

INSERT INTO skills_audit_events (
  org_id,
  user_id,
  api_key_id,
  action,
  target_type,
  target_id,
  metadata_json
)
VALUES
  ('org_dev', 'user_dev', 'key_dev', 'legacy.bootstrap', 'api_key', 'key_dev', '{"fixture":"legacy"}'::jsonb),
  ('org_dev', 'user_dev', 'key_other', 'operator.audit', 'api_key', 'key_other', '{"fixture":"unrelated"}'::jsonb);

\ir ../../migrations/0002_api_key_read_scopes.sql

DO $$
DECLARE
  legacy_event skills_audit_events%ROWTYPE;
  unrelated_event skills_audit_events%ROWTYPE;
BEGIN
  SELECT * INTO STRICT legacy_event
  FROM skills_audit_events
  WHERE action = 'legacy.bootstrap';

  IF legacy_event.org_id IS DISTINCT FROM 'org_self_hosted'
     OR legacy_event.user_id IS DISTINCT FROM 'user_operator'
     OR legacy_event.api_key_id IS DISTINCT FROM 'key_0123456789abcdef0123' THEN
    RAISE EXCEPTION 'legacy audit event was not remapped exactly: %', row_to_json(legacy_event);
  END IF;

  SELECT * INTO STRICT unrelated_event
  FROM skills_audit_events
  WHERE action = 'operator.audit';

  IF unrelated_event.org_id IS DISTINCT FROM 'org_self_hosted'
     OR unrelated_event.user_id IS DISTINCT FROM 'user_operator'
     OR unrelated_event.api_key_id IS DISTINCT FROM 'key_other' THEN
    RAISE EXCEPTION 'unrelated audit-event API key reference was changed: %', row_to_json(unrelated_event);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM api_keys
    WHERE id = 'key_other'
      AND org_id = 'org_self_hosted'
      AND user_id = 'user_operator'
      AND scopes_json = '["skills:read"]'::jsonb
  ) THEN
    RAISE EXCEPTION 'unrelated API key was not preserved';
  END IF;

  IF EXISTS (SELECT 1 FROM organizations WHERE id = 'org_dev')
     OR EXISTS (SELECT 1 FROM users WHERE id = 'user_dev') THEN
    RAISE EXCEPTION 'legacy organization or user remains after remap';
  END IF;
END
$$;

ROLLBACK;
