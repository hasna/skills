---
name: seo-content-pack
description: Generate SEO content packages with topic clusters, articles, metadata, links, FAQs, and publishing cadence.
kind: instruction
---

# SEO Content Pack

Generate a complete SEO content package from a topic, audience, and product context.

## Requirements

None. This is an instruction skill: it is prose an agent follows, so it needs no
credentials, no network access, and no local runtime.

## Usage

Ask an agent for the deliverables below and give it the inputs. Reading this file
IS the invocation; `skills run` refuses instruction skills on purpose.

## Inputs

| Input | Description | Default |
|--------|-------------|---------|
| `topic` | Core topic or search theme. Positional text also works. | required |
| `brand` | Brand or product name. | Brand |
| `audience` | Target audience. | SaaS buyers |
| `articles` | Supporting article count, 3-8. | 5 |
| `tone` | `practical`, `executive`, or `technical`. | practical |

## Deliverables

- `topic-cluster.md`
- `pillar-article.md`
- `supporting-articles/article-*.md`
- `metadata.csv`
- `internal-linking-plan.md`
- `faqs.md`
- `publishing-cadence.csv`
- `manifest.json`

## Method

1. Build the topic cluster around search intent, with one pillar and supporting
   pages that each own a distinct sub-intent. Overlapping pages cannibalize.
2. For each page, record the primary query, the intent type, and the specific
   question it answers better than the current top results.
3. Write the pillar in full; outline the supporting pages to H2 level with the
   angle each takes.
4. Produce titles and meta descriptions within real pixel limits, front-loading
   the query.
5. Specify internal links in both directions with the anchor text to use.
6. Answer FAQs in the first two sentences of each answer, then elaborate.
7. Set a publishing cadence that matches the team's actual capacity.
