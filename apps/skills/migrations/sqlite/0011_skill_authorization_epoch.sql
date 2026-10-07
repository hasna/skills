-- Snapshot epochs are server-owned. This baseline does not backfill local receipts.
ALTER TABLE skills_registry ADD COLUMN authorization_epoch text;
UPDATE skills_registry SET authorization_epoch = lower(hex(randomblob(16)));
CREATE TRIGGER skills_registry_authorization_epoch_insert
  AFTER INSERT ON skills_registry
  BEGIN
    UPDATE skills_registry SET authorization_epoch = lower(hex(randomblob(16)))
      WHERE org_id = NEW.org_id AND slug = NEW.slug;
  END;
CREATE TRIGGER skills_registry_authorization_epoch_lifecycle
  AFTER UPDATE OF tombstoned_at, lifecycle ON skills_registry
  WHEN (OLD.tombstoned_at IS NULL AND NEW.tombstoned_at IS NOT NULL)
       OR OLD.lifecycle IS NOT NEW.lifecycle
  BEGIN
    UPDATE skills_registry SET authorization_epoch = lower(hex(randomblob(16)))
      WHERE org_id = NEW.org_id AND slug = NEW.slug;
  END;
