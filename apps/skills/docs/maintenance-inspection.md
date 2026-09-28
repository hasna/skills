# Inspect a publication enrollment

The protected maintenance entrypoint can inspect one enrollment without changing
API key scopes, audit records or registry revisions:

```sh
skills-maintenance maintenance inspect-enrollment --manifest inspection.json --operator-receipt receipt.json --json
```

The deployment's protected wrapper supplies both files. An inspection requires
its own unexpired authorization and operation ID; it cannot reuse the enrollment
authorization. The manifest identifies the exact key, organization, prior
enrollment operation and canonical enrollment manifest digest. The operator
receipt binds the manifest's raw bytes to the running protected task. Neither
file contains a credential.

Inspection accepts only an explicitly configured PostgreSQL database through
the server's database URL environment variable. It opens a separate connection
and a repeatable-read, read-only transaction with bounded query and lock
timeouts. It does not initialize the application store, run migrations or
backfill registry revisions. There is no `--apply` option.

The result's `status: "inspected"` means the inspection completed. It does not
mean enrollment succeeded. The target reports `found` with validated ordered
scopes, or `absent`, `revoked`, `mismatched` or `ambiguous`. The audit reports
`absent`, `matching`, `mismatched` or `ambiguous` for the exact prior operation.
Foreign identifiers, credentials, raw audit metadata and database error text are
never included.

Invalid input, database refusal or malformed stored metadata exits nonzero with
a fixed error code. A failed or ambiguous inspection does not authorize an
enrollment retry. Review the result and use the deployment's normal protected
authorization process for any subsequent change.
