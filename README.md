# Skills release source

This repository is the public, standalone release source for [`@hasna/skills`](https://www.npmjs.com/package/@hasna/skills). The package source, CLI, MCP server, SDK, service, tests and release checks are in [`apps/skills`](apps/skills/README.md).

This repository contains Skills software. Skill instructions, executable bundles, account catalogs, aliases and selection profiles are user or operator data held outside the software repository. Publishing a package here does not publish anyone's skills.

Development uses Bun 1.3.14 and the lockfile in `apps/skills`:

```sh
cd apps/skills
bun install --frozen-lockfile --ignore-scripts --backend copyfile
bun run typecheck
bun run build
bun test
bun run verify:release
```

The root [release workflow](.github/workflows/release-skills.yml) requires a protected-main commit, an independently reviewed annotated tag bound to the packed archive, and npm provenance with registry integrity readback. See the package's [release procedure](apps/skills/scripts/RELEASE.md) for the linkage format. Package publication remains disabled until the repository protection, required-reviewer environment and npm trusted-publisher binding have been configured and verified.

Licensed under Apache-2.0; see [LICENSE](LICENSE).
