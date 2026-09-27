# Private catalog migration

A skill corpus is operator data, independent of the public software repository.
Each account publishes its own versioned instruction or executable bundles to its
authenticated Skills API. S3 is optional; operators may use supported database
bundle storage instead. Server startup never seeds or merges a local corpus.

Before removing a legacy source, preserve its files, metadata and executable
modes in private storage and verify a fresh restore. Audit exact duplicates,
canonical names, required secrets, executable entrypoints and source provenance.
Keep conflicting variants until their owner has resolved them. Do not silently
delete an unpreserved skill or import every old variant into a live selection.

Publish reviewed versions with the Skills CLI, verify bundle digests and private
account visibility, then update the selection profile and sync each station.
Retire native agent copies only after preservation and verified CLI loading.
Ordinary discovery does not auto-import ~/.skills, ~/.skillsrc, flat app-home
folders or the old custom/ directory. Explicit source imports remain available.

Run `bun run check:skill-content` from the monorepo to prevent content returning
to Git. The legacy `scripts/check_skill_corpus_drift.sh --base HEAD` spelling now
runs that boundary check; it no longer compares a public corpus against Git.
Deleting current files does not remove historical Git commits or already
published package artifacts.
