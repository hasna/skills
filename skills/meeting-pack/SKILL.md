---
name: meeting-pack
description: Generate meeting artifact packs from transcripts or notes with summaries, decisions, action items, owner/deadline tables, follow-up email, project export, timeline, and manifest metadata.
kind: instruction
---

# Meeting Pack

Generate a complete meeting artifact package from transcripts, notes, call summaries, or rough bullets.

## Requirements

None. This is an instruction skill: it is prose an agent follows, so it needs no
credentials, no network access, and no local runtime.

## Usage

Ask an agent for the deliverables below and give it the inputs. Reading this file
IS the invocation; `skills run` refuses instruction skills on purpose.

## Inputs

| Input | Description | Default |
|--------|-------------|---------|
| `notes` | Meeting transcript, rough notes, or summary. Positional text also works. | required unless `--source` is used |
| `source` | Read notes or transcript from a file. | none |
| `meeting` | Meeting title. | Meeting |
| `participants` | Comma-separated participant names. | Team |
| `format` | `project`, `executive`, `sales`, or `standup`. | project |

## Deliverables

- `meeting-summary.md`
- `decisions.md`
- `action-items.csv`
- `follow-up-email.md`
- `project-export.json`
- `timeline.md`
- `manifest.json`

## Method

1. Read the transcript fully before summarizing; decisions are often reversed
   later in the same meeting.
2. Separate decisions from discussion. A decision has an owner and a resolution;
   everything else is context.
3. Extract action items with owner, deadline, and the acceptance condition. An
   action item without an owner will not happen.
4. Flag anything explicitly deferred, and anything raised but never resolved —
   the second category is what meetings routinely lose.
5. Build the timeline from what was said, not from what you expect the process to be.
6. Draft the follow-up email so a non-attendee can act on it without the transcript.
