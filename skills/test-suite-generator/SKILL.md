---
name: test-suite-generator
description: Generate API, unit, and browser test suite packages with runnable tests and coverage notes.
kind: instruction
---

# Test Suite Generator

Generate a test package for SaaS apps from routes, specs, or user flows.

## Requirements

None. This is an instruction skill: it is prose an agent follows, so it needs no
credentials, no network access, and no local runtime.

## Usage

Ask an agent for the deliverables below and give it the inputs. Reading this file
IS the invocation; `skills run` refuses instruction skills on purpose.

## Inputs

| Input | Description | Default |
|--------|-------------|---------|
| `spec` | Routes, specs, or user flows. Positional text also works. | required |
| `framework` | Application framework. | generic SaaS app |
| `runner` | Test runner style: `bun`, `vitest`, or `playwright`. | bun |
| `include-browser` | Include browser flow tests. | false |

## Deliverables

- `tests/api.test.ts`
- `tests/unit.test.ts`
- `tests/browser.spec.ts`
- `test-plan.md`
- `coverage-notes.md`
- `manifest.json`

## Method

1. Turn the natural-language spec into an explicit list of behaviours with their
   expected outcomes before writing any test code.
2. Cover the boundaries first — empty, maximum, malformed, unauthorized,
   concurrent. Happy-path-only suites give false confidence.
3. Write assertions against observable behaviour, not implementation detail, so
   the suite survives refactoring.
4. Keep tests independent and order-agnostic; shared mutable fixtures are the
   most common source of flakiness.
5. Match the project's existing framework and conventions — detect them from the
   repo rather than imposing your own.
6. Note explicitly what you did NOT cover and why, so the gaps are visible.
