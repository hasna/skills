---
name: social-content-calendar
description: Generate social content calendars with daily posts, channel strategy, asset briefs, publishing schedule, and repurposing map.
kind: instruction
---

# Social Content Calendar

Generate a 14 to 45 day campaign calendar for launch, nurture, hiring, community, or thought-leadership campaigns.

## Requirements

None. This is an instruction skill: it is prose an agent follows, so it needs no
credentials, no network access, and no local runtime.

## Usage

Ask an agent for the deliverables below and give it the inputs. Reading this file
IS the invocation; `skills run` refuses instruction skills on purpose.

## Inputs

| Input | Description | Default |
|--------|-------------|---------|
| `campaign` | Campaign, product, or content brief. Positional text also works. | required |
| `audience` | Target segment. | software teams |
| `goal` | Campaign goal. | build qualified demand |
| `days` | Calendar length, 14-45 days. | 30 |
| `channels` | Comma-separated channels. | LinkedIn, X, Newsletter |
| `tone` | `direct`, `premium`, `friendly`, or `technical`. | direct |

## Deliverables

- `calendar.md`
- `posts.csv`
- `channel-plan.json`
- `asset-briefs.md`
- `hooks.md`
- `publishing-schedule.csv`
- `repurposing-map.md`
- `manifest.json`

## Method

1. Fix the campaign goal and the two or three content pillars everything maps to.
2. Adapt per channel rather than cross-posting: length, format and tone differ,
   and an unadapted post reads as spam on at least one network.
3. Write the hook as the first line, because on most networks it is the only line
   guaranteed to be read.
4. Schedule with real dates from the requested start, and balance the pillars
   across the week rather than batching them.
5. Build the repurposing map explicitly: which long-form asset each post derives
   from, so production cost stays bounded.
6. Include asset briefs for anything needing design, with dimensions per channel.
