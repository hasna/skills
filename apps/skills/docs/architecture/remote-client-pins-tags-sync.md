# Remote client — pins, tags, and incremental sync

`RemoteSkillsClient` (`src/lib/remote-client.ts`) is the one typed HTTP client
for the unified model. This document defines the client-side contract for the
pin, tag, and incremental-sync methods added in T10 of the skills
local+cloud unification plan, and the version-skew guard that keeps them
fail-closed against servers that predate the routes.

## Routes

| Method | Route | Client method | Response contract |
|---|---|---|---|
| GET | `/api/v1/pins` | `listPins()` | `RemotePin[]` |
| PUT | `/api/v1/pins/:slug` | `pin(slug, metadata?)` | `RemotePin` (upsert; body `{ metadata }`; pinning again refreshes) |
| DELETE | `/api/v1/pins/:slug` | `unpin(slug)` | `true` when a pin existed and was deleted; `false` on `404 { code: "PIN_NOT_FOUND" }` |
| GET | `/api/v1/tags` | `listTags()` | `string[]` (tag names) |
| GET | `/api/v1/tags/:tag/skills` | `skillsByTag(tag)` | `RemoteSkillSummary[]` |
| GET | `/api/v1/skills/updated?since=<iso>&cursor=<opaque>&limit=<n>` | `listUpdatedSince(since, {cursor, limit})` | `{ skills: RemoteSkillSummary[], nextCursor: string \| null }` |

The pins wire shape follows the hosted-pins contract defined by the server
lane: `RemotePin` is `{ slug, pinnedAt, metadata }` — `pinnedAt`/`metadata`
are server-reported and may be absent, and a present-but-wrong-typed field is
a contract error, never silently dropped. `metadata` is stored as a JSON
object; a non-object value is refused (`400 INVALID_METADATA` on the server,
contract error on the client).

The updated-since page is deliberately a **distinct path** (`/api/v1/skills/updated`),
not a query flag on `/api/v1/skills`. A server without incremental sync must
404 the new path rather than answer the old one with a cursor-less listing —
a silent full-list-instead-of-page would look like a completed sync and drop
nothing on the next push.

`nextCursor` is opaque to the client: pass the previous page's value back as
`cursor`, and treat `null` (or an absent field) as "listing complete".

## Version-skew guard (fail-closed)

A server that predates these routes answers 404 (unmatched path) or 405
(unmatched method). Every new-route method routes its response through
`requestNewRoute()`, which maps:

- `404` / `405` → **`RemoteRouteUnsupportedError`** (carries the route path and
  status, and names the instance). The caller sees an explicit
  "this instance does not support the route" error — never an empty listing,
  which would read as "no pins / no changes" and silently desynchronize a
  sync caller.
- any other non-ok status → **`RemoteRequestError`** (carries the status).
- a malformed success payload (wrong container shape, missing `slug`,
  non-string `nextCursor`, non-string tag elements, wrong-typed optional
  fields) → a plain contract `Error`. Fail-closed on both sides of the wire.

The one deliberate exception is a domain 404 the server itself answers: the
hosted-pins DELETE returns `404 { error: "pin not found", code: "PIN_NOT_FOUND" }`
when no pin exists. `unpin()` matches that code and resolves `false` — the
absence of a pin is a domain answer, not version skew. Any other 404 body —
including the dispatcher's `{ code: "NOT_FOUND" }` on a route the server
lacks — still throws `RemoteRouteUnsupportedError`.

Existing pre-T10 methods are unchanged: `getSkill`/`getSkillMd` still return
`null` on a missing skill, `getBundle` still returns `null` on 404 — those are
domain semantics, not version skew, and callers depend on them.

Both error classes and the response types are re-exported from
`src/index.ts`, so consumers (the T9 sync reconciliation verb) import them
through the public library surface.

## CLI surface

The CLI verbs that surface these capabilities (`skills sync` push/pull
reconciliation, remote pin/tag listing) are wired in their own tasks of the
same plan (T9 owns the sync verb). This task wires the client and the
documentation the verbs build on; the route table above is the contract a
future server implements.
