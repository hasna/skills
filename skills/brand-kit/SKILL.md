---
name: brand-kit
description: Generate brand kits with logo usage, palette, typography, brand voice, sample applications, Markdown guide, and PDF guide.
kind: instruction
---

# Brand Kit

Generate a production-ready brand guide package for a startup, product, internal tool, or campaign.

## Requirements

None. This is an instruction skill: it is prose an agent follows, so it needs no
credentials, no network access, and no local runtime.

## Usage

Ask an agent for the deliverables below and give it the inputs. Reading this file
IS the invocation; `skills run` refuses instruction skills on purpose.

## Inputs

| Input | Description | Default |
|--------|-------------|---------|
| `brand` | Brand, product, or company name. Positional text also works. | required |
| `category` | Market category or product type. | software product |
| `audience` | Primary audience. | software teams |
| `personality` | Brand personality words. | clear, capable, direct |
| `tone` | `direct`, `premium`, `friendly`, or `technical`. | direct |

## Deliverables

- `brand-guide.md`
- `palette.json`
- `typography.md`
- `voice-guide.md`
- `logo-usage.md`
- `sample-applications.md`
- `brand-assets.svg`
- `manifest.json`

## Method

1. Establish positioning first — audience, category, and the one adjective the
   brand must own. Every later choice is judged against it.
2. Build the palette with roles, not just hex values: primary, surface, text,
   accent, semantic states. Record contrast ratios for text pairs.
3. Choose type by role (display, body, mono) with fallbacks, and give a scale.
4. Write voice as do/don't pairs with example sentences; adjectives alone are
   not actionable.
5. Specify logo usage: clear space, minimum size, permitted and forbidden
   treatments, and behaviour on light and dark backgrounds.
6. Show the system applied to at least two real surfaces (a landing hero, a
   social card) so the rules are demonstrated rather than asserted.
