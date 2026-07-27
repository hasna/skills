---
name: security-audit-report
description: Generate a security hardening report covering auth, secrets, headers, webhooks, RLS, permissions, dependency risk, and prioritized fixes.
kind: instruction
---

# Security Audit Report

Generate a security hardening package for SaaS and developer tooling projects.

## Requirements

None. This is an instruction skill: it is prose an agent follows, so it needs no
credentials, no network access, and no local runtime.

## Usage

Ask an agent for the deliverables below and give it the inputs. Reading this file
IS the invocation; `skills run` refuses instruction skills on purpose.

## Inputs

| Input | Description | Default |
|--------|-------------|---------|
| `target` | Directory to inspect. | current directory |
| `scope` | Comma-separated focus areas. | auth,secrets,headers,webhooks,rls,permissions,dependencies |
| `framework` | App stack context for recommendations. | generic web app |

## Deliverables

- `security-audit-report.md`
- `findings.json`
- `findings.csv`
- `remediation-plan.md`
- `manifest.json`

## Method

1. Scope explicitly: what you inspected, what you could not, and the date. An
   audit silently missing a subsystem is dangerous.
2. Work the scope areas in order (auth, secrets, transport and headers, webhooks,
   row-level security, permissions, dependencies) and record a finding or an
   explicit "no issue found" for each.
3. Rate severity by exploitability and blast radius together, and justify the
   rating in one line.
4. For each finding: the vulnerable pattern, where it occurs, what an attacker
   gains, and concrete remediation code or configuration.
5. For dependency risk, run the project's own auditor (`npm audit`,
   `bun audit`, `pip-audit`) and report its real output rather than guessing.
6. Order the remediation plan by risk reduction per unit of effort.
7. State clearly that this is a review, not a penetration test, and name what
   still requires one.
