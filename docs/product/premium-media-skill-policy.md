# Premium Media Skill Policy

This policy defines the hosted media skills added for the SaaS catalog:
`music-album`, `photo-album`, `short-video-pack`, `voiceover-jingle-pack`, and
`brand-photo-shoot`.

## Pricing

| Skill | Billing mode | Starting price | Quote behavior |
| --- | --- | --- | --- |
| `music-album` | Metered per song | 150 credits per song | Quote required; allowed album sizes are 7, 14, and 21 songs. |
| `photo-album` | Fixed package | 300 credits per run | Quote optional unless custom volume or provider options are added. |
| `short-video-pack` | Fixed package | 500 credits per run | Quote optional unless generated clip count or duration changes. |
| `voiceover-jingle-pack` | Fixed package | 250 credits per run | Quote optional unless voice, jingle, or duration counts change. |
| `brand-photo-shoot` | Fixed package | 600 credits per run | Quote optional unless scene count or resolution changes. |

## Approval And Moderation

- Require account authentication before every hosted run.
- Require human approval for runs estimated above 2,000 credits, requests using
  regulated claims, likeness-sensitive prompts, or brand/legal risk.
- Run prompt and asset moderation before provider submission.
- Do not accept provider API keys from the user for these hosted skills.
- Keep provider credentials, routing, prompts, workers, and storage credentials
  server-side.

## Storage And Retention

- Store generated artifacts behind the authenticated run-artifact API.
- Include `manifest.json` and `receipt.json` in every completed package.
- Default retention is 30 days unless the account plan specifies longer.
- Large generated media should use object storage only; do not place binaries
  into local project state except through explicit `skills exports download`.

## Refunds And Failures

- Failed provider submissions release or refund unused reserved credits.
- Partial packages should mark the run `failed` unless the user explicitly
  accepts partial delivery.
- Receipts must include credits reserved, credits used, provider-family summary,
  artifact count, and run id.
