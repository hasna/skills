-- Hosted pins: the cloud becomes a source of truth for what the user selected.
--
-- Today a pin lives only in local project state (.skills/project.json); an
-- instance has no pins surface, so nothing a user selected is ever visible to
-- the server, to a second machine, or to another operator of the same org.
-- This table is that surface.
--
-- Row identity is (org_id, principal, slug): one org, one API key, one slug -
-- a pin is a fact about a specific principal's selection. `principal` stores
-- the api_keys.id of the API key that pinned (ApiPrincipal.apiKeyId), so two
-- API keys in the same org each have their own pin set, and two organizations
-- can pin the same slug without colliding. The task's UNIQUE(org,principal,slug)
-- is expressed as the composite primary key, which implies the same uniqueness
-- and is the row's natural identity - there is no separate id to mint.
--
-- Pins are metadata-only: slug plus a free-form metadata object. Nothing here
-- references skills_registry, so a pin may name a skill the org has not
-- published (a bundled skill, or one that will exist later) without a
-- foreign-key constraint choosing which of those futures is allowed.

CREATE TABLE IF NOT EXISTS skills_pins (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  principal text NOT NULL,
  slug text NOT NULL,
  pinned_at timestamptz NOT NULL DEFAULT now(),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (org_id, principal, slug)
);
