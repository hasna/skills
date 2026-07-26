---
name: pitch-deck
description: Generate investor or sales pitch deck packages with PPTX, PDF, notes, and design direction.
kind: instruction
---

# Pitch Deck

Generate investor or sales deck packages from a short brief.

## Requirements

None. This is an instruction skill: it is prose an agent follows, so it needs no
credentials, no network access, and no local runtime.

## Usage

Ask an agent for the deliverables below and give it the inputs. Reading this file
IS the invocation; `skills run` refuses instruction skills on purpose.

## Inputs

| Input | Description | Default |
|--------|-------------|---------|
| `brief` | Company, product, offer, or campaign brief. Positional text also works. | required |
| `company` | Company or product name. | Company |
| `audience` | `investors`, `sales`, or `internal`. | investors |
| `slides` | Number of slides, 5-15. | 10 |
| `tone` | `concise`, `bold`, or `technical`. | concise |

## Deliverables

- `deck.md`
- `slides.json`
- `speaker-notes.md`
- `design-direction.md`
- `manifest.json`

## Method

1. Fix the narrative before the slides: problem, why now, what changes, why you.
   A deck is an argument with pictures, not a list of topics.
2. One idea per slide, stated in the headline. If the headline is a noun phrase
   ("Market"), rewrite it as the claim ("The market reprices every 18 months").
3. Put the number that matters on the slide, with its source and period.
4. Order for a live read: the appendix carries the detail, the body carries the
   argument.
5. Write speaker notes as what to say, including the transition into the next slide.
6. Give design direction (hierarchy, palette, chart style) as instructions a
   designer can follow. For rendered .pdf/.pptx files, hand `slides.json` to the
   `slide-deck-generator` skill, which renders binaries locally.
