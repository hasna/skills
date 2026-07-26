---
name: landing-page-pack
description: Generate landing page copy, wireframes, CTA maps, experiments, and preview artifacts.
kind: instruction
---

# Landing Page Pack

Generate a conversion-focused landing page package for a product, service, or offer.

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
| `audience` | Primary buyer or user segment. | software teams |
| `offer` | Core offer or promise. | derived from product |
| `goal` | Main conversion goal. | book demos |
| `tone` | `direct`, `premium`, `friendly`, or `technical`. | direct |
| `proof` | Proof points, metrics, or trust signals. | case studies and testimonials |
| `sections` | Comma-separated section names. | hero, problem, solution, proof, faq, cta |

## Deliverables

- `landing-page.md`
- `copy-blocks.json`
- `wireframe.md`
- `preview.html`
- `style-guide.md`
- `cta-map.csv`
- `experiment-plan.md`
- `implementation-notes.md`
- `manifest.json`

## Method

1. Lead with the offer: who it is for, what changes for them, and why now.
2. Write the hero before anything else. If the hero does not work, no section
   below it will rescue the page.
3. Order sections by the objections a real buyer raises, in the order they raise
   them. Do not follow a template order by default.
4. Make proof specific — named customers, real numbers, concrete screenshots.
   Generic testimonials reduce credibility rather than adding to it.
5. Keep one primary CTA, repeated; secondary CTAs must be visibly subordinate.
6. Propose experiments as hypotheses with a metric and a decision rule.
