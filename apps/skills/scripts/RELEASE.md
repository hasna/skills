# Skills release checks

## Releasing @hasna/skills

The only publish path is the repository-root workflow
`.github/workflows/release-skills.yml`. It runs for a pushed annotated tag named
`npm/skills/v<version>` and publishes with npm provenance over OIDC in the
skills-only `npm-publish-skills` environment. There is no npm token on that path.

A dispatch (with or without a `tag`) runs as the workflow's `candidate` job in the
`skills-candidate` environment, with no `id-token` permission and nothing that can
publish. Only a pushed `npm/skills/v*` tag runs the `publish` job in
`npm-publish-skills`. That environment is configured to admit those tags alone
and to require no reviewer, and the repository ruleset `npm-skills-release-tags`
lets only the hasna-identity App create, update or delete them. Before checkout,
a tag run refuses unless the tag is annotated by `hasna-identity[bot]` and the
publishing environment, the retired environment and the ruleset read back as
recorded. The tagger name is a consistency check, not proof; the ruleset is the
control.

`npm-release-skills` is retired. Every earlier `npm/skills/v*` tag carries a
workflow whose dispatch requested it with `id-token: write`, so it keeps its
required reviewer and admits no ref. Do not delete it: a dispatch naming a
missing environment would recreate it without protection.

To release, the App creates the annotated tag through the API (a tag object with
tagger `hasna-identity[bot]`, then the ref) at the exact release commit on main,
only after the dry-run archive digest, the independent exact-archive GO and the
tag's `Packed-SHA256` agree. No other account can create the tag.

A dispatch without a `tag` runs the source and package gates, packs the built
checkout with the workflow's pinned npm, and verifies that exact archive with
the installed consumer fixture. It uploads `skills-candidate-<commit>-<attempt>`
for seven days: the npm tarball plus source/toolchain/digest and consumer
receipts. Download the artifact and verify the retained tarball digest before
independent release review. Its tarball preserves the member modes; the upload
container's file modes do not establish package modes. This inspection artifact
does not authorize publishing. The annotated release tag must still bind the
independently reviewed archive digest, and the tag workflow must reproduce it.

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
toolchain the workflow selects (node 24.18.0 / npm 11.19.0), after the build.
Create the isolated checkout and build with umask `022`, retaining Git's tracked
file modes (`0644` or `0755`). Keep its enclosing scratch directory private.
An existing private copy with `0600`/`0700` files is not equivalent: npm includes
those mode bits in the archive, even when every file's contents match. Changing
umask only at pack time does not repair permissions of existing build outputs.

In that clean checkout:

```sh
umask 022
cd apps/skills
bun run build
bun run prepublishOnly
bun run prepack
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

The workflow runs the unchanged `prepublishOnly` and `prepack` package gates
before sealing the reviewed archive. It retains that archive with
`verify:release-review --pack-destination <absolute-directory>`, then runs the
complete installed consumer fixture against those exact bytes:

```sh
bun run verify:consumer-types --archive /absolute/hasna-skills-<version>.tgz \
  --sha256 <reviewed-sha256> --receipt /absolute/consumer-archive.json
```

The fixture checks the installed package name, version and all four exports,
runs the strict type and runtime/CLI checks (including actual `./storage` export
loading and pure configuration/URL checks without database or provider access),
and emits a passed receipt only
after both the original archive and its installed input still match. Its
temporary install is removed; the reviewed original and external receipt remain.
Without arguments, the fixture still packs its own archive for normal `prepack`.

The receipt's `mcp-binary-surface` check is static and offline: it reads the
installed `bin/mcp.js` without running it. The file must import only
`@modelcontextprotocol/sdk` and bundle exactly one zod. It must also contain the
package-zod `tools/list` handler (`servePackageZodToolList` from
`src/mcp/package-tool-list.ts`), which is needed because the consumer's SDK may
resolve another zod. The check only looks for that name. The handler's behavior
is covered by `src/mcp/package-tool-list.test.ts`.

Packed MCP consumer acceptance installs and runs floating third-party packages,
so it is not part of `prepack`, `prepublishOnly` or `verify:consumer-types`, and
the publish job does not run it. It runs in the unprivileged
`.github/workflows/skills-consumer-gate.yml` job, which has read-only contents,
no environment, no secrets and no id-token. That job runs on pull requests that
change `apps/skills` and on manual dispatch, with the release toolchain pins. It
installs the locked dependencies, typechecks, builds and runs the prepack gates.
It also runs the unit tests for the `tools/list` handler and the gate helpers.
It then packs the archive and runs `verify:consumer-mcp` on it:
- under bun, with root `zod` at the declared floor and at the declared range;
- under npm, with root `zod` at 4.3.5, 3.25.76 and 4.1.13, below the floor,
  where npm runs the SDK on that older zod.

The tested range comes from the archive's own `package.json`. Each layout runs
`initialize` and `tools/list`, with every fetch refused. It then runs a valid
`tools/call` and three invalid ones, each of which must be refused with -32602:
a wrong type, and `confirm: false` and an unknown key on a `.strict()` tool.
Every layout must list identical tools and schemas. The job uploads only the
gate's summary.

Run the gate locally with
`bun run verify:consumer-mcp [--archive <path> --sha256 <hex>] [--npm-split-zod <version>]...`.
Without `--npm-split-zod` it runs the two bun layouts and only the npm 4.3.5
layout. Each `--npm-split-zod` replaces that npm list, so the workflow passes
4.3.5, 3.25.76 and 4.1.13 explicitly.

Immediately before publication, `scripts/publish-reviewed-archive.ts` requires
the tag-push context, review and consumer receipts, package/version, complete
check set and current archive hashes to agree. It passes the same file to
`npm publish <archive> --provenance --access public`; there is no repack or build
after acceptance. npm does not run package lifecycle hooks for this file input,
which is why the workflow runs them explicitly before sealing. Dispatches cannot
reach publication. Registry readback must match the accepted SHA-512 integrity
and include provenance.

For a dry run, dispatch `Release skills to npm` with the `tag` input. It checks
out `refs/tags/<tag>` (never a branch of the same name) in the `candidate` job and
runs the source, package, review-linkage and consumer steps against it; the
tag-push protection check and the publish steps do not run on a dispatch. The old
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
