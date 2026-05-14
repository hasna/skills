---
name: voiceover-jingle-pack
description: Generate hosted voiceover variants and short jingles
---

# Voiceover And Jingle Pack

Create a hosted premium audio package with voiceover variants, short jingles, style direction, duration options, usage notes, audio artifacts, manifests, and receipts.

## Usage

```bash
skills run voiceover-jingle-pack "friendly onboarding voiceover for a SaaS launch" --duration 30
skills run voiceover-jingle-pack --script ./spot.txt --voices 4 --jingles 3
```

## Output

- `voiceovers/variant-*.mp3`
- `jingles/jingle-*.mp3`
- `usage-notes.md`
- `manifest.json`
- `receipt.json`

## Requirements

Hosted premium execution requires `SKILLS_API_KEY` or `skills auth login`.
Provider keys stay server-side.
