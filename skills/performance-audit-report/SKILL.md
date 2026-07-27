---
name: performance-audit-report
description: Generate performance audit reports for web apps, APIs, or SaaS surfaces with metrics, findings, budgets, remediation plans, and manifest metadata.
kind: instruction
---

# Performance Audit Report

Generate a performance audit package from a URL, repo notes, trace summary, or product brief. Hosted runs can gather richer measurements, while local direct execution produces deterministic artifacts for validation.

## Requirements

None. This is an instruction skill: it is prose an agent follows, so it needs no
credentials, no network access, and no local runtime.

## Usage

Ask an agent for the deliverables below and give it the inputs. Reading this file
IS the invocation; `skills run` refuses instruction skills on purpose.

## Inputs

| Input | Description | Default |
|--------|-------------|---------|
| `target` | App URL, route, repo path, or service name. | optional |
| `notes` | Performance notes, metrics, trace summary, or constraints. Positional text also works. | optional |
| `app` | Application or product name. | Performance Target |
| `surface` | `web`, `api`, `mobile`, or `worker`. | web |
| `budget` | `strict`, `balanced`, or `growth`. | balanced |

## Deliverables

- `performance-audit-report.md`
- `findings.csv`
- `performance-budget.json`
- `remediation-plan.md`
- `metrics.json`
- `manifest.json`

## Method

1. State what evidence you actually have. If no measurements were supplied, say
   so — an audit that presents guesses as measurements is worse than none.
2. Establish the budget before the findings: target metrics and thresholds.
3. Order findings by user-perceived impact, not by how easy they are to describe.
4. For each finding, give the mechanism (why it is slow), not just the symptom.
5. Attach an estimated saving and a confidence level to each recommendation.
6. Separate quick wins from structural work, and say what must be measured again
   after each change to confirm it worked.
