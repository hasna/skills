# Authoring private skills

The public repository contains the Skills software. Operational instructions,
executable skill source and catalog metadata belong to each operator's private
storage. Do not add a skill directory or catalog entry to this repository.

Use `skills new <name> --kind instruction` (or `--kind executable`) to create an
owned draft outside the software checkout. Use `skills validate <name>`, then
`skills push --help` for explicit versioned publication to the authenticated
account. Validate each executable and its secret references before publication.
Publishing to Skills does not publish the skill to GitHub or npm.

The CLI pulls verified bundles into its owned cache. Coding agents consume them
through the Skills CLI bridge and configured hooks. Do not copy operational
payloads into native agent skill directories.

Software tests may create small synthetic fixtures in temporary directories.
`bun run check:skill-content` rejects tracked skill documents and corpus folders
across the monorepo. Build and pack checks cover the published software artifact.
