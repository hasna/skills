---
name: Audio Cleanup Lab
version: 0.1.0
description: Generate professional audio cleanup recipes and mastering guidelines for noisy recordings
author: skills.md
category: Design & Creative
tags:
  - audio-engineering
  - post-production
  - podcasting
  - sound-design
  - eq
  - compression
  - ai-consultant
credits: 4
---

# Audio Cleanup Lab

Your personal audio engineering consultant. Describe your recording issues (background noise, echo, uneven levels), and this skill generates a detailed "cleanup recipe" with specific EQ settings, compression parameters, and plugin recommendations tailored to your DAW.

> **Note:** This skill generates *instructions* for you to apply, not processed audio files.

## Features

- **Diagnostic Analysis**: Identifies likely frequency clashes and sonic issues based on your description.
- **Tailored Recipes**: Provides specific cut/boost frequencies (e.g., "Cut 3dB at 400Hz to remove mud").
- **Chain Recommendations**: Suggests the optimal order of operations (De-noise -> EQ -> Compress).
- **DAW Agnostic**: Works with Logic Pro, Pro Tools, Audition, Audacity, or any standard editor.
- **Mastering Targets**: Gives loudness specs (LUFS) for your specific deliverable (Podcast, TV, Web).

## Usage

```bash
# Get a recipe for a noisy cafe recording
skills run audio-cleanup-lab -- "Podcast interview recorded in a busy cafe" \
  --issues "background chatter, clinking cups, low vocal level" \
  --deliverable "podcast"

# Get settings for a specific DAW
skills run audio-cleanup-lab -- "Voiceover recorded in a closet" \
  --issues "boomy bass, clothing rustle" \
  --software "Adobe Audition"
```

## Options

| Option          | Description                                       | Default                  |
| --------------- | ------------------------------------------------- | ------------------------ |
| `--project`     | Description of the recording context              | (Required)               |
| `--issues`      | Specific problems to fix (comma separated)        | general background noise |
| `--deliverable` | Final output format (podcast, video, film)        | podcast episode          |
| `--software`    | Your preferred DAW or audio editor                | generic                  |
| `--format`      | Output format (`markdown` or `json`)              | markdown                 |
| `--output`      | Custom filename for the recipe                    | Auto-generated           |

## Output

- **Recipe**: A step-by-step guide saved as Markdown or JSON.
- **Checklist**: A quick reference summary for your mixing session.

## Examples

### Zoom Call Rescue
```bash
skills run audio-cleanup-lab -- "Panel discussion recorded on Zoom" \
  --issues "digital artifacts, echo, uneven levels" \
  --software "Izotope RX"
```

### Film Dialogue Match
```bash
skills run audio-cleanup-lab -- "ADR matching location sound" \
  --issues "too clean, needs room tone matching" \
  --deliverable "short film"
```

## Requirements

- `OPENAI_API_KEY` environment variable.
- Bun runtime.