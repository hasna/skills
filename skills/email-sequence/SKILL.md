---
name: email-sequence
description: Generate email campaigns with subject lines, preview text, body copy, segmentation notes, CTA variants, and HTML exports.
kind: instruction
---

# Email Sequence

Generate a 5 to 10 email campaign package for launch, nurture, onboarding, or reactivation.

## Requirements

None. This is an instruction skill: it is prose an agent follows, so it needs no
credentials, no network access, and no local runtime.

## Usage

Ask an agent for the deliverables below and give it the inputs. Reading this file
IS the invocation; `skills run` refuses instruction skills on purpose.

## Inputs

| Input | Description | Default |
|--------|-------------|---------|
| `campaign` | Campaign, product, or offer brief. Positional text also works. | required |
| `audience` | Target segment. | software teams |
| `goal` | Conversion goal. | book demos |
| `emails` | Number of emails, 5-10. | 5 |
| `tone` | `direct`, `premium`, `friendly`, or `technical`. | direct |

## Deliverables

- `sequence.md`
- `emails/email-XX.md`
- `emails/email-XX.html`
- `subject-lines.csv`
- `segmentation-notes.md`
- `cta-variants.csv`
- `send-plan.csv`
- `manifest.json`

## Method

1. Fix the sequence goal and the single action each email drives, then map the
   arc across the whole sequence before writing any email.
2. Write subject lines and preview text as a pair — preview text that repeats the
   subject wastes the strongest real estate in the inbox.
3. Keep one idea per email. If an email needs two CTAs, it is two emails.
4. Vary structure across the sequence (story, proof, objection, direct offer) so
   it does not read as one message sent five times.
5. Add segmentation notes: who should be excluded, and what behaviour triggers
   the next send.
6. Provide plain-text alongside HTML; many recipients will only see the former.
