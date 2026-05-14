---
name: slide-deck-generator
description: Generate premium slide decks from briefs, docs, or outlines with PPTX/PDF artifacts, speaker notes, theme guidance, structured slide metadata, and manifest metadata.
---

# Slide Deck Generator

Generate an editable slide deck package from a brief, document excerpt, outline, product narrative, training plan, report, or proposal.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only metadata and instructions.

## Usage

```bash
skills run slide-deck-generator --brief "Q2 launch review for AI billing" --title "Q2 Launch Review" --audience executives
skills run slide-deck-generator ./outline.md --format training --slides 12
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--brief <text>` | Brief, outline, or source text. Positional text also works. | required |
| `--source <path>` | Read brief text from a file. | none |
| `--title <text>` | Deck title. | Slide Deck |
| `--audience <type>` | `team`, `customers`, `executives`, or `students`. | team |
| `--format <type>` | `general`, `training`, `sales`, `report`, or `proposal`. | general |
| `--slides <n>` | Number of slides. | 8 |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `deck.md`
- `deck.pdf`
- `deck.pptx`
- `slides.json`
- `speaker-notes.md`
- `theme-guide.md`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
