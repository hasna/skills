# Renewing immutable session pins

Managed cached context expires after 24 hours. A renewal checks the authenticated
profile again and never adopts newly selected skill versions itself. When a
renewal is refused, the managed prompt hook migrates the pin by default, with
the exceptions described in "Automatic migration on the managed hook" below.
Explicit `skills context` without `--auto-migrate-session-pin`, and stations
that turn migration off, keep the refusal. When the server advertises
`skills.session-pin-renewal`, a pin
with a verified authorization epoch can retain its complete old profile across
ordinary version upgrades. Every old selection must still be selected with the
same policy and lifecycle epoch. Historical bundles must pass authenticated
exact-version, epoch, digest and archive verification. A final profile read and
the local receipt's existing generation/hash guard reject concurrent changes.
The whole authorization shares a four-second deadline; failed authorization
never refreshes the receipt or writes downloaded bundles into its cache.

When that deadline is spent, the managed hook reports `SESSION_RENEWAL_TIMEOUT`.
Only a real deadline or abort signal counts: an aborted or timed-out request,
or a bundle inspection timeout or abort. Inner bundle deadlines are rounded up
to the renewal deadline and never fire early. The pin is unchanged and the next
prompt retries the renewal. Other failures keep their own codes even after the
deadline. `SKILLS_API_UNAVAILABLE` still means the authority could not be
reached, answered HTTP 429/5xx, or omitted the lifecycle fences it advertised.
Errors without a Skills code still fail as `SKILLS_CONTEXT_FAILED`.

A definitive refusal (`SESSION_RECONCILIATION_REQUIRED`) is remembered for five
minutes under `selection-cache/session-renewal-refusals/`. The record binds the
exact receipt bytes, profile, authority, workspace and locally synced profile
revision. Within that window the hook repeats the refusal without resolving the
whole profile again. A changed receipt, a newly synced revision or the end of
the window sends the next prompt back to the authority. The record only repeats
a refusal: it never renews, authorizes or writes a pin, a malformed or extended
record is ignored, and explicit `skills sessions reconcile` does not read it.
A record larger than 4 KiB is ignored without being parsed.

There are two kinds of record. A renewal refusal (`managed-hook-renewal-refusal`)
is repeated only while migration is off for that prompt: it says the pin
cannot be renewed as it is, not that it cannot migrate. A migration refusal
(`managed-hook-migration-refusal`) is written when the managed hook's migration
itself refuses deterministically. The causes are a project lock, a rotated
epoch on a loaded skill, a planner refusal or any other failure that is not
transient. Because it implies the renewal refusal, it is repeated in either
mode. A budget timeout, an unavailable authority, write-lock contention, a
concurrent receipt change and I/O failures are never remembered.

Removing a selection, changing its aliases or triggers, deleting or archiving
a skill, losing access, or failing integrity checks still refuses renewal.
Deletion and archive transitions rotate the server's per-skill epoch. Restoring
or recreating a skill can authorize new sessions, but cannot silently revive a
known older epoch. Ordinary publishing leaves the epoch unchanged.

## Automatic migration on the managed hook

Managed prompt hooks for every maintained agent pass
`--auto-migrate-session-pin` to the cached context child. When renewal of an
expired pin is refused after the authenticated profile passed its identity
checks, the child applies the same planner and applier as `skills sessions
reconcile` to that already validated target: same profile, authority and
workspace, no further authority read. Loaded selections with the exact same
bundle are retained; changed or removed loaded selections are retired. The old
receipt is archived under `selection-cache/session-reconciliations/` with an
operation receipt of kind `managed-hook-session-pin-migration`, and the new pin
is written under the existing receipt precondition and write lock.

When loaded skills are retired, a metadata-only notice is written under
`selection-cache/session-pin-migration-notices/`. Only the writer that commits
the pin writes it: it holds the session write lock, the exact receipt
precondition has held, and the notice is written immediately before the pin. A
concurrent migrator that loses the precondition never touches it. The
managed hook prepends it to the first context that succeeds for that session and
reaches the agent (including the authenticated fallback when a new bundle is not
cached yet), then marks it delivered under the same lock. If another writer
holds that lock, the notice stays pending for a later prompt. Cursor shows hook
context only at session start and Sumi only on its context restoration call, so
the notice waits for those. Plain `skills context` never consumes it. It
applies only while the pin holds the migrated profile, revision and generation,
and a malformed or oversized record is ignored.

A project lock (`.skills/selection.lock.json`, written by `skills pin`,
`skills install --project` and `skills sync --project`) is an intentional pin.
A session started in a directory that holds one inherits the lock's pin and
records that provenance in its receipt as `projectLock`: the lock's path and
the SHA-256 of its exact bytes. Its subagent sessions inherit the record. The
hook never migrates such a session automatically, from whatever directory it
later prompts, even after the lock file is changed or removed. For a session
without that record (including every session created before the record existed;
receipts never stored their creation directory), the hook does not migrate
while a lock is present, or cannot be read, in the prompt's `cwd` or any
ancestor up to the filesystem root. A caller that does not name the `cwd` never
migrates. In each case the hook keeps the renewal refusal and its record, and
leaves both the session pin and the lock unchanged. The check runs three times:
before the authority read, after it, and under the session write lock
immediately before the pin is written, so a lock created while the authority
answers still governs. Change the lock explicitly, or review `skills sessions
reconcile`, which preserves the record.

A loaded selection whose known lifecycle epoch changed also keeps the refusal
when its bytes are the same again (deleted or archived, then restored).
Migration would retain it unchanged, so the session would never be told.
Review it with `skills sessions reconcile`. A changed epoch on a selection the
session never loaded does not block migration.

Every failure other than a plain revision move keeps its existing refusal:
identity mismatches, unreadable receipts, integrity checks, an unavailable
authority and planner refusals. Session write-lock contention keeps its own
`SESSION_WRITE_BUSY`, and the next prompt retries. A migration that cannot finish inside the
four-second renewal deadline reports `SESSION_RECONCILIATION_REQUIRED` with a
fixed `migration: "timeout"` marker, which the hook explains; the pin is
unchanged and the next prompt retries. Outcomes that may already have committed
keep `SESSION_RECONCILIATION_INCOMPLETE`. That includes a failure after the
new pin was written, such as releasing the write lock. Renewable pins still
renew without migrating.

Turn migration off station-wide with `skills config set sessionPinMigration off
--global`. Only the global configuration is read, and setting the key without
`--global` is refused. Migration is on in two cases only. Either `lstat` finds
no entry at the configuration path inside an existing data directory, or the
entry is a regular file (read without following links) that holds a JSON object
without the key or with exactly `"auto"`. Every other state keeps the refusal:
a symlink (dangling or not), a directory or other non-regular entry, a missing
or dangling data directory, an unreadable or malformed file, a truncated write,
a non-object document, a retired key, or any other value.

## Compatibility and intentional migration

Existing clients and servers keep the exact-current-selection path. An older
receipt without epochs can acquire genuine current epochs only if every old
selection still matches the authoritative current version, digest and policy.
This is fresh authorization now, not evidence of historical continuity. Renewal
never migrates a legacy receipt whose selected version has already changed, or
a pin with a known epoch mismatch. Under the managed hook's default, such a
refusal is migrated automatically as described above, and the changed loaded
skills are retired and named. Two cases are not migrated: a session that
follows a project lock, and a known epoch mismatch on a loaded skill whose
bytes match again. Those, and every refusal where migration is off, require one
reviewed migration with the steps below. No bulk receipt rewrite is needed; new
sessions acquire current epochs normally.

Use `skills sessions show <session-id> --json`, then plan with
`skills sessions reconcile <session-id> --from-profile <old-id>
--from-revision <old-revision> --receipt-sha256 <old-sha256>
--selection-profile <target-id> --profile-revision <target-revision>`.
`show` returns `selections` with each pinned slug, version, bundle digest and
loaded flag. Preview returns `plan.selectionDelta`: each old selection is
`retained`, `retired` or `unloaded`, with the reason `same-bundle`,
`selection-removed` or `bundle-changed`. Changed bundles name their exact current
`replacement`; `plan.addedSelections` names target selections absent from the
old pin. Retention describes exact bundle identity; the full target profile
digest still binds policy and lifecycle changes. These projections contain no
payloads, aliases, triggers or credentials. The SDK's `inspectSkillSession` and
`reconcileSkillSession` expose the same metadata. Show and preview leave the
receipt unchanged, and the complete projected delta is bound to `planDigest`.

Review the loaded selections retained or retired. Apply only that unchanged
plan with `--apply --plan-digest <digest> --plan-issued-at <time>
--plan-expires-at <time>` within its five-minute window. The supported operation
preserves the original receipt and records the replacement; it does not rewrite
other sessions, running processes, project locks or shared profiles.

## Server migration

Migration `0011_skill_authorization_epoch` adds a current baseline to each
registry row and lifecycle triggers for SQLite and PostgreSQL. It does not
rewrite immutable version rows, profiles or local session receipts. Preserve
and verify the existing store before using the owning migration command. Deploy
the migrated server before relying on historical-pin renewal. A server that does
not advertise the capability never grants relaxed historical renewal; missing
advertised epochs fail closed. Store rollback must restore the preserved store
as a unit, not manufacture prior epochs.

Profile resolution emits lifecycle epochs only when the caller requests
`?pinAuthorization=epoch-v1`. The default response preserves the legacy complete
profile shape, including existing session hashes. New clients opt in explicitly;
old servers ignore the query and retain exact-current renewal only. Historical
continuation still requires the advertised capability and genuine matching epochs.
