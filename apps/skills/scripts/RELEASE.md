# Skills release checks

## Releasing @hasna/skills

The only publish path is the repository-root workflow
`.github/workflows/release-skills.yml`. It runs for a pushed annotated tag named
`npm/skills/v<version>` and publishes with npm provenance over OIDC in the
skills-only `npm-release-skills` environment. There is no npm token on that path.

A release is refused, before the registry is touched, unless the annotated tag
message carries the linkage for the candidate. The four fields are required
EXACTLY once each; the linkage namespace is closed, so an extra
`Release-Review-*`, `Git-Publishing-*` or `Packed-*` field is a failure:

```
@hasna/skills 0.10.10

<release notes>

Release-Review-Agent: <registered coding-agent identity that reviewed this candidate>
Git-Publishing-Thread: <git-publishing release intent thread id>
Git-Prs-GO: <message id of the independent GO in git-prs for this candidate>
Packed-SHA256: <64 lowercase hex>
```

`Packed-SHA256` is the SHA-256 of the tarball the release toolchain packs at the
exact release commit. Produce it in a clean checkout of that commit, with the
toolchain the workflow selects (node 24.18.0 / npm 11.19.0), after the build:

```sh
cd apps/skills
bun run build
destination="$(mktemp -d)"
npm pack --ignore-scripts --json --pack-destination "$destination"
shasum -a 256 "$destination/hasna-skills-<version>.tgz"
```

A digest taken from a different toolchain, a different commit or a differently
built tree does not match, and the mismatch is the gate doing its job.

`bun run verify:release-review` is the gate. Record the review verdict in
`#git-prs` and link it in the `#git-publishing` release intent thread before
tagging. The release operator checks the actual channel messages; the gate
checks the tag's linkage shape and packed digest, but does not query Conversations.
It reads the annotated tag at the
exact commit, requires the linkage fields above, packs this checkout and refuses
on any missing, duplicated, malformed or mismatched field. It runs with no
fallback path, it is fail-closed, and the workflow's `npm publish` step cannot run
unless this step succeeded. An unpublished version must also not already exist in
the registry.

For a dry run, dispatch `Release skills to npm` with the `tag` input: every step
except publishing runs against that tag. The old
`apps/skills/.github/workflows/publish.yml` was retired by the same change:
GitHub Actions only discovers workflows from the repository root, so it never
ran, and it published on a bare `v*` tag with no review linkage.

## Producer checks

Build release archives with the package's standalone `bun.lock`. Install the exact
`package.json` and lock in a separate directory with
`bun install --frozen-lockfile --ignore-scripts`, using a clean HOME and cache.
Use that complete `node_modules` graph for the package in its isolated versioned
worktree; retain the repository metadata used by the existing consumer type
check. Do not substitute or mix older workspace dependency folders.

Run `bun run verify:producer` before building and before packing a release.
`prepublishOnly` also enforces this gate before an actual npm publication.
The release workflow installs the selected standalone lock directly in
`apps/skills` with a clean runner and copyfile backend before the package build.
A symlink to an external graph or a dependency graph outside this installation
fails the producer verifier. Ordinary `npm pack` does not establish standalone
producer attestation by itself; retain the producer, build, release and consumer
checks from the exact release checkout.
It checks declared root dependencies, actual resolved package versions and
recursive dependency edges against the selected lock, including optional-peer
absence. Every resolved package must remain inside the selected `node_modules`
graph. An intentional `zod/v3` import from the locked Zod4 package and a separately
locked nested Zod3 dependency are valid.

The result binds package/lock hashes and resolved package manifest hashes. It is
not a package payload integrity attestation: retain the clean frozen-install
receipt, build evidence and installed-archive acceptance separately. Recheck the
graph before packing and verify the actual published archive after publication.

After installing the selected archive in an isolated consumer directory, run
`bun scripts/checkout-consumer.ts /absolute/consumer/directory`. It imports the
installed SDK and verifies explicit 503/409 recovery and connection-loss recovery
with exactly one checkout POST per call. It intercepts every HTTP request with
synthetic responses and performs no provider operation. This does not replace
the standalone producer graph or live server acceptance checks.

Run `bun scripts/checkout-surface-consumer.ts /absolute/consumer/directory`
against the same installed archive. It starts the archive's actual CLI and stdio
MCP binaries under a synthetic fetch preload, verifies caller-key recovery across
503, 409, success and transport loss, and requires exactly five explicit checkout
POSTs per surface. No automatic retry or provider request is permitted. Use OS
network denial for both checkout fixture commands when the host supports it.
