# Changelog

## 0.10.9

Add an exact-version, receipt-backed copyfile runtime update and rollback path for Skills CLI installations across Linux and macOS. The updater validates the npm archive and active launchers before switching, preserves configuration and launcher preimages, and records each recovery transition.

## 0.10.8

Accept native Codex hook trust enrollment with Codex CLI 0.157.0 and 0.157.1 after an isolated native app-server check. Unknown versions remain fail-closed.

## 0.10.7

This release prepares the hosted-first Skills CLI, MCP server, SDK and service for versioned skill publication, selection, synchronization and agent hooks. It adds package release checks that bind an independent review to the exact archive and verify npm provenance and registry integrity.

Earlier package history remains available in the published npm versions and their release records. Operational skill payloads and account catalogs are stored outside this software repository.
