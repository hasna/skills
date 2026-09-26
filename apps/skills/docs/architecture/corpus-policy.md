# Private corpus policy

The public repository owns the Skills software. Skill instructions, executable
skill source, catalog entries, aliases and selection profiles are operator data.
They belong in private account storage, independently of software releases.
This supersedes the earlier bundled-corpus and fixed dual-runtime-set policy.

A new account and a fresh local installation start with an empty catalog.
Operators create drafts outside the software checkout, validate and publish
versioned bundles to their authenticated Skills API, then pull or sync verified
versions through the CLI. S3 is optional; supported database bundle storage can
serve the same account APIs. Publishing a skill never publishes it to npm or
this GitHub repository.

Runtime eligibility belongs to the published version and deployment policy.
An unavailable hosted route or missing credential fails closed. It cannot
substitute a bundled implementation, a native agent folder or a local source.
Explicit local execution remains available for the owner's eligible executable
skills, with declared requirements and secret references.

The public CI content gate rejects operational skill documents and corpus
folders. Software tests generate synthetic fixtures in temporary private
folders. No operational corpus is retained for tests or seeded at server boot.
See [private catalog migration](./skill-corpus-migration.md) for preservation,
curation, rollout and the separate treatment of historical artifacts.
