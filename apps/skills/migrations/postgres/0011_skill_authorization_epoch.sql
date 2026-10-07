-- A new baseline is current authorization, never evidence of historical continuity.
-- Clients lacking a recorded epoch may adopt one only from exact-current selections.
ALTER TABLE skills_registry ADD COLUMN authorization_epoch text NOT NULL
  DEFAULT replace(gen_random_uuid()::text, '-', '')
  CHECK (authorization_epoch ~ '^[a-f0-9]{32}$');

CREATE FUNCTION skills_registry_authorization_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.authorization_epoch := replace(gen_random_uuid()::text, '-', '');
  ELSIF (OLD.tombstoned_at IS NULL AND NEW.tombstoned_at IS NOT NULL)
        OR OLD.lifecycle IS DISTINCT FROM NEW.lifecycle THEN
    NEW.authorization_epoch := replace(gen_random_uuid()::text, '-', '');
  ELSE
    NEW.authorization_epoch := OLD.authorization_epoch;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER skills_registry_authorization_epoch
  BEFORE INSERT OR UPDATE ON skills_registry
  FOR EACH ROW EXECUTE FUNCTION skills_registry_authorization_epoch();
