---
name: customer-feedback-report
description: Generate customer feedback reports from reviews, support tickets, surveys, call notes, or raw feedback with clusters, sentiment, root causes, roadmap recommendations, evidence, and manifest metadata.
kind: instruction
---

# Customer Feedback Report

Generate a structured customer feedback insight package from reviews, support tickets, survey responses, interview notes, sales call notes, or mixed raw feedback.

## Requirements

None. This is an instruction skill: it is prose an agent follows, so it needs no
credentials, no network access, and no local runtime.

## Usage

Ask an agent for the deliverables below and give it the inputs. Reading this file
IS the invocation; `skills run` refuses instruction skills on purpose.

## Inputs

| Input | Description | Default |
|--------|-------------|---------|
| `feedback` | Raw feedback text. Positional text also works. | required unless `--source` is used |
| `source` | Read feedback text from a file. | none |
| `product` | Product, service, or workflow name. | Product |
| `segment` | Customer segment or audience. | All customers |
| `channel` | `reviews`, `tickets`, `calls`, `surveys`, or `mixed`. | mixed |
| `format` | `product`, `support`, or `executive`. | product |

## Deliverables

- `customer-feedback-report.md`
- `feedback-clusters.csv`
- `roadmap-suggestions.md`
- `sentiment-summary.json`
- `evidence.json`
- `manifest.json`

## Method

1. Normalize the raw feedback: dedupe, drop empty entries, and record the total
   you actually analysed versus what you were given.
2. Cluster by underlying problem, not by keyword — "slow" and "times out" are
   often one cluster; "slow" and "sluggish onboarding" are often two.
3. Size each cluster and cite two or three verbatim quotes per cluster. A cluster
   without quotes cannot be checked.
4. Assign sentiment per cluster and note where sentiment and volume disagree.
5. For each top cluster, separate the reported symptom from your inferred root
   cause, and mark the inference as an inference.
6. Turn the top clusters into roadmap candidates with an effort/impact call.
