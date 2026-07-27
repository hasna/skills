---
name: proposal-pack
description: Generate client proposal packages with proposal, SOW, pricing, timeline, assumptions, cover email, Markdown, and PDF artifacts.
kind: instruction
---

# Proposal Pack

Generate a client-ready proposal package for agencies, consultants, SaaS services, and implementation teams.

## Requirements

None. This is an instruction skill: it is prose an agent follows, so it needs no
credentials, no network access, and no local runtime.

## Usage

Ask an agent for the deliverables below and give it the inputs. Reading this file
IS the invocation; `skills run` refuses instruction skills on purpose.

## Inputs

| Input | Description | Default |
|--------|-------------|---------|
| `project` | Project scope or proposal brief. Positional text also works. | required |
| `client` | Client or account name. | Client |
| `budget` | Budget range or fixed price. | To be confirmed |
| `timeline` | Delivery timeline. | 4-6 weeks |
| `services` | Comma-separated services or workstreams. | discovery, implementation, enablement |
| `tone` | `executive`, `friendly`, or `technical`. | executive |

## Deliverables

- `proposal.md`
- `statement-of-work.md`
- `pricing.csv`
- `timeline.csv`
- `assumptions.md`
- `cover-email.md`
- `manifest.json`

## Method

1. Open by restating the client's problem in their words. A proposal that starts
   with your company loses before it is read.
2. Scope by outcome, then by deliverable. Make the exclusions explicit — most
   disputes come from what was never written down.
3. Tie pricing to the scope structure so a scope change has an obvious price
   consequence.
4. Build the timeline with client-side dependencies named, since those are the
   usual cause of slip.
5. List assumptions plainly; each one is a risk you are asking the client to accept.
6. Keep the cover email short: problem, approach, price range, next step.
