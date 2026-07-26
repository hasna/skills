---
name: contract-review-report
description: Generate contract review reports with clause summaries, risk register, negotiation points, redline-style suggestions, counterparty email draft, and manifest metadata.
kind: instruction
---

# Contract Review Report

Generate a structured contract review package from an agreement, terms sheet, statement of work, vendor contract, or customer contract.

## Requirements

None. This is an instruction skill: it is prose an agent follows, so it needs no
credentials, no network access, and no local runtime.

## Usage

Ask an agent for the deliverables below and give it the inputs. Reading this file
IS the invocation; `skills run` refuses instruction skills on purpose.

## Inputs

| Input | Description | Default |
|--------|-------------|---------|
| `contract` | Contract text. Positional text also works. | required unless `--source` is used |
| `source` | Read contract text from a file. | none |
| `party` | Your company or client name. | Our company |
| `counterparty` | Other party name. | Counterparty |
| `jurisdiction` | Governing context for notes. | Not specified |
| `focus` | Comma-separated focus areas. | liability,payment,termination,privacy |

## Deliverables

- `contract-review-report.md`
- `risk-register.csv`
- `clause-summary.json`
- `redline-suggestions.md`
- `negotiation-email.md`
- `manifest.json`

## Method

1. Read the whole agreement before commenting on any clause; obligations are
   frequently defined in one section and modified in another.
2. Build a clause inventory: what it says, in plain language, per section.
3. Score each risk on likelihood and impact, and say which party it favours.
   A risk register with no counterparty attribution is not useful.
4. Draft redlines as concrete replacement wording, not "consider revising".
5. Separate deal-breakers from negotiable points, and rank the negotiables.
6. Write the negotiation email so it opens with agreement, raises the top three
   items only, and proposes specific alternatives.
7. State clearly that this is not legal advice and name what a lawyer must review.
