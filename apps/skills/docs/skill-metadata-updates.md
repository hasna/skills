# Correct category and tags

Preview a correction and preserve its complete original privately:

```sh
skills metadata preview my-skill --category "Development Tools" --tags '["review"]' --save /private/review-plan.json
skills metadata apply --file /private/review-plan.json
```

Preview performs reads only. The saved plan includes the original instruction
body; keep it private. Output shows only the category/tags change, revision and
preserved version/bundle identity. Existing plan files are never overwritten.

Apply requires the same API authority and organization, explicit publish
permission, the exact current metadata revision and a matching server ETag.
Only category and tags are sent. Body, kind, version and bundle identity must
remain unchanged. Conflicts refuse; prepare a new plan after inspecting the
current record. An uncertain PATCH is read back once, never submitted again.
An unconfirmed readback is reported as `METADATA_UPDATE_UNCONFIRMED`.

SDK users call `RemoteSkillsClient.prepareSkillMetadataUpdate` and then
`applySkillMetadataUpdate` with the preserved plan. `metadataPlanSummary`
provides a body-free review view. The server remains the final scope and
revision authority. These operations do not change selections or session pins.
