# Renewing immutable session pins

Managed cached context expires after 24 hours. A renewal checks the authenticated
profile again; it does not automatically migrate the session to newly selected
skill versions. When the server advertises `skills.session-pin-renewal`, a pin
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

Removing a selection, changing its aliases or triggers, deleting or archiving
a skill, losing access, or failing integrity checks still refuses renewal.
Deletion and archive transitions rotate the server's per-skill epoch. Restoring
or recreating a skill can authorize new sessions, but cannot silently revive a
known older epoch. Ordinary publishing leaves the epoch unchanged.

## Compatibility and intentional migration

Existing clients and servers keep the exact-current-selection path. An older
receipt without epochs can acquire genuine current epochs only if every old
selection still matches the authoritative current version, digest and policy.
This is fresh authorization now, not evidence of historical continuity. A
legacy receipt whose selected version has already changed requires one reviewed
migration. No bulk receipt rewrite is needed; new sessions acquire current
epochs normally. Known epoch mismatches always require intentional migration,
even when the selected bytes match again.

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
