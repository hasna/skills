---
name: logo-design
description: Generate premium multi-variant logo packages with transparent PNG exports, vector-style SVGs, usage notes, and a manifest.
---

# Logo Design

Generate professional logo concepts from a text brief. Hosted runs return a downloadable brand exploration package.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only metadata and instructions.

## Usage

```bash
skills run logo-design --brief "minimal geometric owl mark for a developer tool" --brand "Acme"
skills run logo-design "coffee shop logo, vintage badge, warm tones" --variations 4
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--brief <text>` | Logo brief. Positional text also works. | required |
| `--brand <name>` | Brand or product name. | Brand |
| `--style <text>` | Visual style direction. | clean vector mark |
| `--palette <list>` | Comma-separated color direction. | navy,white,accent |
| `--variations <n>` | Number of logo concepts, 1-6. | 3 |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `transparent/logo-*.png`
- `vector/logo-*.svg`
- `concepts.json`
- `logo-brief.md`
- `usage-notes.md`
- `manifest.json`

## Logo Design Tips

1. **Be specific**: "minimalist geometric owl logo, flat vector, navy and gold, white background" beats "owl logo"
2. **Specify style**: flat vector, 3D, vintage, modern, hand-drawn, geometric, abstract
3. **Request white/solid background**: Prevents complex backgrounds bleeding into the mark
4. **Keep it simple**: Logos must work at favicon size (16x16). Ask for clean, minimal designs
5. **Skip text in the logo**: Generators struggle with typography. Generate the icon, add text in Illustrator/Figma
6. **Generate many variations**: Run 4-10 variations with slight prompt tweaks, pick the best

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
