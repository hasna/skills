ALTER TABLE api_keys
  ALTER COLUMN scopes_json
  SET DEFAULT '["skills:read","runs:read","runs:write","artifacts:read"]'::jsonb;

-- Capture only the bootstrap identity emitted by the original public server.
-- A name or scope match alone is not sufficient: operators may legitimately
-- have created other keys with either value.
CREATE TEMP TABLE legacy_skills_bootstrap AS
SELECT
  k.id AS api_key_id,
  k.key_hash,
  'key_' || substr(k.key_hash, 1, 20) AS target_api_key_id,
  o.created_at AS org_created_at,
  u.created_at AS user_created_at
FROM api_keys k
JOIN organizations o ON o.id = k.org_id
JOIN users u ON u.id = k.user_id
WHERE k.id = 'key_dev'
  AND k.org_id = 'org_dev'
  AND k.user_id = 'user_dev'
  AND k.name = 'bootstrap'
  AND k.scopes_json = '["skills:read","runs:write"]'::jsonb
  AND o.slug = 'dev'
  AND o.name = 'Development'
  -- Match the exact historical bootstrap address without shipping the retired
  -- internal service origin in the public package.
  AND md5(u.email) = 'bd437459aededa5b92dd7459452f7b50';

-- Fail closed if a canonical target identifier already belongs to a different
-- record. This migration must never merge the legacy tenant into an arbitrary
-- operator-created organization, user, or API key.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM legacy_skills_bootstrap) THEN
    IF EXISTS (
      SELECT 1 FROM organizations
      WHERE (id = 'org_self_hosted' AND (slug <> 'self-hosted' OR name <> 'Self-hosted operator'))
         OR (slug = 'self-hosted' AND id <> 'org_self_hosted')
    ) THEN
      RAISE EXCEPTION 'cannot migrate legacy Skills bootstrap: self-hosted organization identity is already in use';
    END IF;

    IF EXISTS (
      SELECT 1 FROM users
      WHERE (id = 'user_operator' AND email <> 'operator@localhost.invalid')
         OR (email = 'operator@localhost.invalid' AND id <> 'user_operator')
    ) THEN
      RAISE EXCEPTION 'cannot migrate legacy Skills bootstrap: self-hosted user identity is already in use';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM api_keys k
      JOIN legacy_skills_bootstrap legacy ON k.id = legacy.target_api_key_id
      WHERE k.id <> legacy.api_key_id
    ) THEN
      RAISE EXCEPTION 'cannot migrate legacy Skills bootstrap: derived API key identity is already in use';
    END IF;
  END IF;
END
$$;

INSERT INTO organizations (id, slug, name, created_at)
SELECT 'org_self_hosted', 'self-hosted', 'Self-hosted operator', org_created_at
FROM legacy_skills_bootstrap
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, email, name, created_at)
SELECT 'user_operator', 'operator@localhost.invalid', 'operator@localhost.invalid', user_created_at
FROM legacy_skills_bootstrap
ON CONFLICT (id) DO NOTHING;

-- Preserve membership roles while remapping every reference to the exact
-- legacy organization or user. Canonical placeholder rows may already exist
-- if a newer server started once before migrations ran, so merge deliberately.
CREATE TEMP TABLE legacy_skills_memberships AS
SELECT
  CASE WHEN org_id = 'org_dev' THEN 'org_self_hosted' ELSE org_id END AS org_id,
  CASE WHEN user_id = 'user_dev' THEN 'user_operator' ELSE user_id END AS user_id,
  (array_agg(role ORDER BY (role = 'owner') DESC))[1] AS role,
  min(created_at) AS created_at
FROM organization_members
WHERE (org_id = 'org_dev' OR user_id = 'user_dev')
  AND EXISTS (SELECT 1 FROM legacy_skills_bootstrap)
GROUP BY 1, 2;

DELETE FROM organization_members
WHERE (org_id = 'org_dev' OR user_id = 'user_dev')
  AND EXISTS (SELECT 1 FROM legacy_skills_bootstrap);

INSERT INTO organization_members (org_id, user_id, role, created_at)
SELECT org_id, user_id, role, created_at
FROM legacy_skills_memberships
ON CONFLICT (org_id, user_id) DO UPDATE
SET role = CASE
  WHEN organization_members.role = 'owner' OR EXCLUDED.role = 'owner' THEN 'owner'
  ELSE EXCLUDED.role
END;

UPDATE api_keys
SET org_id = CASE WHEN org_id = 'org_dev' THEN 'org_self_hosted' ELSE org_id END,
    user_id = CASE WHEN user_id = 'user_dev' THEN 'user_operator' ELSE user_id END
WHERE (org_id = 'org_dev' OR user_id = 'user_dev')
  AND EXISTS (SELECT 1 FROM legacy_skills_bootstrap);

UPDATE skills_runs
SET org_id = CASE WHEN org_id = 'org_dev' THEN 'org_self_hosted' ELSE org_id END,
    user_id = CASE WHEN user_id = 'user_dev' THEN 'user_operator' ELSE user_id END
WHERE (org_id = 'org_dev' OR user_id = 'user_dev')
  AND EXISTS (SELECT 1 FROM legacy_skills_bootstrap);

UPDATE skills_run_logs
SET org_id = 'org_self_hosted'
WHERE org_id = 'org_dev'
  AND EXISTS (SELECT 1 FROM legacy_skills_bootstrap);

UPDATE skills_artifacts
SET org_id = 'org_self_hosted'
WHERE org_id = 'org_dev'
  AND EXISTS (SELECT 1 FROM legacy_skills_bootstrap);

UPDATE skills_approvals
SET org_id = CASE WHEN org_id = 'org_dev' THEN 'org_self_hosted' ELSE org_id END,
    approved_by_user_id = CASE WHEN approved_by_user_id = 'user_dev' THEN 'user_operator' ELSE approved_by_user_id END
WHERE (org_id = 'org_dev' OR approved_by_user_id = 'user_dev')
  AND EXISTS (SELECT 1 FROM legacy_skills_bootstrap);

CREATE TEMP TABLE legacy_skills_bootstrap_audit_events AS
SELECT id
FROM skills_audit_events
WHERE api_key_id = 'key_dev'
  AND EXISTS (SELECT 1 FROM legacy_skills_bootstrap);

-- The API-key primary key cannot be updated while the exact legacy key is
-- still referenced by the non-cascading audit-event foreign key. Detach only
-- those exact references; events for any other API key must remain attached.
UPDATE skills_audit_events
SET api_key_id = NULL
WHERE api_key_id = 'key_dev'
  AND EXISTS (SELECT 1 FROM legacy_skills_bootstrap);

-- Organization and user remapping is independent of the exact API-key ID
-- rewrite above. In particular, an operator-created key such as key_other is
-- preserved even when its organization or user is the legacy identity.
UPDATE skills_audit_events
SET org_id = CASE WHEN org_id = 'org_dev' THEN 'org_self_hosted' ELSE org_id END,
    user_id = CASE WHEN user_id = 'user_dev' THEN 'user_operator' ELSE user_id END
WHERE (org_id = 'org_dev' OR user_id = 'user_dev')
  AND EXISTS (SELECT 1 FROM legacy_skills_bootstrap);

UPDATE api_keys k
SET id = legacy.target_api_key_id,
    org_id = 'org_self_hosted',
    user_id = 'user_operator',
    scopes_json = '["skills:read","runs:read","runs:write","artifacts:read"]'::jsonb
FROM legacy_skills_bootstrap legacy
WHERE k.id = legacy.api_key_id;

UPDATE skills_audit_events events
SET api_key_id = legacy.target_api_key_id
FROM legacy_skills_bootstrap legacy
WHERE events.id IN (SELECT id FROM legacy_skills_bootstrap_audit_events);

DELETE FROM users
WHERE id = 'user_dev'
  AND EXISTS (SELECT 1 FROM legacy_skills_bootstrap);

DELETE FROM organizations
WHERE id = 'org_dev'
  AND EXISTS (SELECT 1 FROM legacy_skills_bootstrap);

DROP TABLE legacy_skills_bootstrap_audit_events;
DROP TABLE legacy_skills_memberships;
DROP TABLE legacy_skills_bootstrap;
