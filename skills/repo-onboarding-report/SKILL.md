---
name: repo-onboarding-report
description: Generate repository onboarding reports with architecture maps, setup guides, first-week plans, code inventory, risk register, and manifest metadata.
kind: instruction
---

# Repo Onboarding Report

Generate a practical onboarding package for a software repository so a new engineer or agent can understand the codebase, setup path, architecture, risks, and first useful tasks quickly.

## Requirements

None. This is an instruction skill: it is prose an agent follows, so it needs no
credentials, no network access, and no local runtime.

## Usage

Ask an agent for the deliverables below and give it the inputs. Reading this file
IS the invocation; `skills run` refuses instruction skills on purpose.

## Inputs

| Input | Description | Default |
|--------|-------------|---------|
| `target` | Repository directory to inspect. | current directory |
| `name` | Project name used in report titles. | package name or folder name |
| `stack` | Stack or product context. | inferred from repository files |
| `focus` | Comma-separated focus areas. | architecture,setup,testing,risks,first-week |

## Deliverables

- `repo-onboarding-report.md`
- `architecture-map.md`
- `setup-quickstart.md`
- `first-week-plan.md`
- `code-inventory.json`
- `risk-register.json`
- `manifest.json`

## Method

1. Explore before you explain. Read the entry points, the build config, the test
   setup, and the largest modules; do not summarize the README back to the user.
2. Draw the architecture as the flow of a real request or command through the
   system, naming the files it passes through.
3. Write setup as a verified sequence — every command you list must be one you
   found evidence for in the repo.
4. Build the code inventory around responsibility ("where auth lives"), not
   directory listing.
5. Record risks concretely: untested paths, stale dependencies, undocumented
   env vars, single points of knowledge.
6. Make the first-week plan a series of increasingly non-trivial real tasks.
