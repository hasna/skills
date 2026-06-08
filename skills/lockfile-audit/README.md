# lockfile-audit

Validate lockfiles, detect missing pins, and flag risky dependency patterns. Windows / PowerShell / cmd

## When to use

- audit package-lock.json
- bun.lock security
- pnpm lockfile review
- unpinned dependencies
- check bun.lock for security

Search terms: security, lockfile, npm, dependencies, audit, hardening, package-lock, developer-tools

## Usage

```bash
skills run lockfile-audit --help
skills run lockfile-audit --json
```

## Development

```bash
bun run src/index.ts --help
bun run typecheck
```
