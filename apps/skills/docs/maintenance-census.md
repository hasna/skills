# Census the Skills schema and migration ledger

The protected maintenance entrypoint can census the fixed Skills database
surface without changing anything:

```sh
skills-maintenance maintenance inspect-schema --manifest census.json --operator-receipt receipt.json --json
```

The deployment's protected wrapper supplies both files. A census requires its
own unexpired authorization and operation ID; it cannot reuse an enrollment or
enrollment-inspection authorization. The manifest binds the acting key and
organization, the operation and station, and its own canonical digest. The
operator receipt binds the manifest's raw bytes to the running protected task.
Neither file contains a credential.

The operation has no target, query, schema or table argument. It accepts only an
explicitly configured PostgreSQL database through the server's database URL
environment variable, and it refuses to run unless the connection resolves to
the fixed public schema the Skills store uses. Every owned-table read is
qualified to `public`, so a connection whose search path falls through to a
later schema cannot substitute another schema's tables: a public table that is
missing refuses with `CENSUS_SCHEMA_UNAVAILABLE` instead of counting rows that
do not belong to the fixed target. There is no `--apply` option and no
arbitrary SQL option.

The census opens a separate connection and a repeatable-read, read-only
transaction with a five-second statement timeout and a one-second lock timeout.
It does not initialize the application store, run migrations or backfill
registry revisions.

The closed result contains:

- `database`, `role`, `serverVersion` and `schema` for the connection;
- `transaction`: read-only, repeatable-read, and both observed timeouts;
- `migrations`: the count and the ordered `schema_migrations.version` ledger;
- `registry.rows` and `versions.rows`: row counts for `skills_registry` and
  `skills_versions`;
- `lifecycle`: `active` and `archived`, each split into `live` and `tombstoned`
  counts;
- `authorizationEpoch`: `{ "exists": false }` before the epoch migration, or
  `{ "exists": true, "nullCount": n }` after it.

Row content, foreign identifiers, credentials and database error text are never
included. The receipt also echoes the authorization identity (`operationId`,
`keyId`, `orgId`, `stationId`) so the wrapper can bind a census to its
manifest. Output bounds are closed: more than 128 migration rows, an oversized
version or identifier string, or a serialized result over 16 KiB refuses with
`CENSUS_OUTPUT_UNBOUNDED` rather than truncating.

Invalid input, database refusal or malformed stored metadata exits nonzero with
a fixed error code. A census is observation only: it does not authorize a
migration, deployment or any other change. Enrollment and enrollment
inspection are unchanged and keep their own authorizations.
