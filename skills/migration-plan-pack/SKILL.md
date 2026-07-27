---
name: migration-plan-pack
description: Generate migration planning packs for framework, library, database, infrastructure, or architecture upgrades with risk matrix, checklist, rollout plan, and test strategy.
kind: instruction
---

# Migration Plan Pack

Generate a migration package from current state, target state, system context, and operating constraints. Hosted runs can inspect richer project inputs, while local direct execution produces deterministic artifacts for validation.

## Requirements

None. This is an instruction skill: it is prose an agent follows, so it needs no
credentials, no network access, and no local runtime.

## Usage

Ask an agent for the deliverables below and give it the inputs. Reading this file
IS the invocation; `skills run` refuses instruction skills on purpose.

## Inputs

| Input | Description | Default |
|--------|-------------|---------|
| `system` | Product, repo, app, or service being migrated. | Migration Target |
| `from` | Current framework, library, database, infrastructure, or architecture state. | current state |
| `to` | Desired target state. | target state |
| `scope` | Comma-separated systems or workstreams in scope. | app, data, deploy, tests |
| `constraints` | Risk, downtime, compliance, billing, or operational constraints. | optional |
| `deadline` | Date, release train, or migration window. | optional |
| `strategy` | `phased`, `big-bang`, or `parallel-run`. | phased |

## Deliverables

- `migration-plan.md`
- `risk-matrix.csv`
- `ordered-checklist.md`
- `test-strategy.md`
- `dependency-map.json`
- `rollout-plan.md`
- `manifest.json`

## Method

1. Establish the from/to states precisely, including versions, and list what is
   explicitly out of scope.
2. Map dependencies before sequencing. The order is forced by the dependency
   graph, not by preference.
3. Identify the irreversible steps. These dominate the plan: everything else can
   be retried.
4. Build the risk matrix with a concrete mitigation and a rollback for each row.
   "Monitor closely" is not a mitigation.
5. Define the cutover checklist as ordered, individually verifiable steps with an
   explicit go/no-go gate.
6. Specify the test strategy per phase, including how you prove parity between
   old and new rather than merely that the new one starts.
