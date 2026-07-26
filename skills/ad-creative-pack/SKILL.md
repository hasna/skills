---
name: ad-creative-pack
description: Generate paid-ad copy, creative concepts, image prompts, audience angles, and test matrices.
kind: instruction
---

# Ad Creative Pack

Generate a paid-ad launch package for Meta, Google, and LinkedIn.

## Requirements

None. This is an instruction skill: it is prose an agent follows, so it needs no
credentials, no network access, and no local runtime.

## Usage

Ask an agent for the deliverables below and give it the inputs. Reading this file
IS the invocation; `skills run` refuses instruction skills on purpose.

## Inputs

| Input | Description | Default |
|--------|-------------|---------|
| `product` | Product, service, or campaign brief. Positional text also works. | required |
| `audience` | Target buyer or segment. | software teams |
| `offer` | Campaign promise or offer. | derived from product |
| `goal` | Conversion goal. | book demos |
| `platforms` | Comma-separated platforms. | Meta, Google, LinkedIn |
| `tone` | `direct`, `premium`, `friendly`, or `technical`. | direct |

## Deliverables

- `platform-copy.md`
- `ad-copy.json`
- `creative-concepts.md`
- `image-prompts.md`
- `audience-angles.csv`
- `test-matrix.csv`
- `launch-checklist.md`
- `manifest.json`

## Method

1. Restate the offer, audience and platform mix in one line, and name the single
   conversion action every asset drives toward.
2. Draft 3-5 distinct creative concepts. Each needs a different *angle* (pain,
   aspiration, proof, novelty, objection), not a different adjective.
3. For each platform, write copy to that platform's real limits — headline and
   primary text lengths differ, so do not reuse one block everywhere.
4. Write image prompts as briefs a designer or an image model could act on:
   subject, composition, mood, colour, text placement.
5. Build the test matrix so exactly one variable changes per row; a matrix that
   varies two things at once cannot attribute a win.
6. Close with a launch checklist covering tracking, naming, and budget split.
