---
name: market-research-report
description: Generate a market research report with competitor, audience, pricing, source, Markdown, and PDF artifacts.
kind: instruction
---

# Market Research Report

Generate a market research report package for SaaS, developer tools, and business planning work.

## Requirements

None. This is an instruction skill: it is prose an agent follows, so it needs no
credentials, no network access, and no local runtime.

## Usage

Ask an agent for the deliverables below and give it the inputs. Reading this file
IS the invocation; `skills run` refuses instruction skills on purpose.

## Inputs

| Input | Description | Default |
|--------|-------------|---------|
| `topic` | Market, product category, or research question. Positional text also works. | required |
| `audience` | Target audience or buyer segment. | Operators and founders |
| `competitors` | Comma-separated competitor names. | inferred examples |
| `region` | Geographic or commercial scope. | Global |
| `format` | `strategic`, `investor`, or `product`. | strategic |

## Deliverables

- `market-research-report.md`
- `competitors.csv`
- `sources.json`
- `manifest.json`

## Method

1. State the question, the market boundary, and the date. A market report without
   an explicit as-of date decays silently.
2. Map competitors by the dimension that actually differentiates them, not by
   feature checklist. Say what each one is genuinely best at.
3. Segment the audience by job-to-be-done and note which segments are underserved.
4. Analyse pricing as packaging: what is metered, what is gated, where the
   upgrade pressure sits.
5. Separate what you verified from what you inferred, and record every source
   with its URL and access date. Use your own web tools or sources the user
   supplied; do not invent citations.
6. Close with the two or three findings that would change a decision, and say
   what evidence would falsify each.
