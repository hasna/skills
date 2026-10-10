# Runtime activation prerequisites

A target package can declare `skillsRuntimePrerequisites` in its package manifest:

```json
{"version":1,"entry":"dist/runtime-prerequisites.js"}
```

The copyfile updater verifies the installed artifact and dependency closure, preserves its configuration preimages and writes a prepared rollout receipt. It then runs this exact target entry before moving the runtime or replacing any launcher. Unknown declarations, missing entries, unavailable checks and invalid responses refuse activation. A refusal retains the prepared receipt and preimages; the old runtime and launchers stay active.

The target reader uses the existing consumer detector. It checks the dedicated Sumi path resolver only when Sumi is detected or configured, using the same schema, selectors and root conflict/alias checks as normal integration. It never starts native Sumi or reads its settings, credentials, models or sessions. Missing unrelated harnesses do not block activation.

The check receives the actual HOME and caller directory as two positional arguments. Run the exact built target using the existing launcher isolation flags:

```sh
bun --config=/dev/null --no-env-file --no-macros --no-install /absolute/package/dist/runtime-prerequisites.js /absolute/home /absolute/caller-directory
```

Supply the station's PATH and documented Skills/Sumi/XDG path selectors through a scrubbed environment. Preserve the presence of unsupported `SUMI_CONFIG`/`SUMI_CONFIG_CONTENT` without projecting their contents. Credentials and Bun preload options are excluded. The check emits one JSON object with `schema: "skills.runtime-prerequisites.v1"`, `targetVersion`, `ok`, `checked` and `code`. Success exits 0 with `code: null`; a sanitized refusal exits 2. The updater bounds runtime and output, rejects stderr and binds a successful result to the target entry hash in the artifact-bound rollout receipt.

Legacy targets with no declaration remain compatible and report `prerequisites.status: "not-declared"`; this is unverified, not a passed check. Deliberate receipt-based rollback remains separate and does not run the target check.

Skills 0.10.61's installed updater predates this contract. Installing the repaired updater does not retroactively make that older updater check its target. The first installation must independently run the exact candidate reader under the reviewed retained-installer procedure before switching PATH. The new updater enforces declared checks on later updates.
