---
name: product-mockup
description: Generate parametric SVG product mockup frames — browser chrome, phone and laptop devices, or an analytics dashboard — plus a scene plan, asset metadata, usage notes, and written image prompts.
---

# Product Mockup

Draw real product mockup frames locally as SVG geometry. Browser chrome with a
tab bar and URL pill, a phone or laptop bezel, or a full dashboard layout with
KPI cards, charts, and a table — all composed from parameters, not from an image
model.

The package also ships `image-prompts.md`: written prompts you can paste into
whichever image tool you use. This skill deliberately does not call one, so it
needs no keys and no network.

## Requirements

- Bun (the skill runs as `bun run src/index.ts`).
- No API keys, no network access, no environment variables.
- No runtime dependencies. `bun install` in this directory only pulls dev types.
- Optional for raster export: any SVG renderer on your machine
  (`rsvg-convert`, `inkscape`, or a browser's print-to-PNG).

## Usage

```bash
# browser frame, three variants
skills run product-mockup -- "Usage-based billing dashboard" --scene browser -n 3

# dashboard scene with a locked brand accent
skills run product-mockup -- --product "MeterKit" --scene dashboard --accent "#2E86C1"

# phone and laptop from one run (device + auto alternates)
skills run product-mockup -- -p "AI meeting assistant" --scene device -n 2

# dark style, custom headline and address bar
skills run product-mockup -- -p "Relay" --title "Ship faster with Relay" --style noir --url https://relay.dev

# machine-readable summary
skills run product-mockup -- -p "MeterKit" --scene dashboard --json
```

Run it directly from the skill directory with `bun run src/index.ts --help`.

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--product <text>`, `-p` | Product, feature, or campaign. A positional string also works. | required |
| `--title <text>` | Headline rendered inside the frame. | the product text |
| `--scene <name>`, `-s` | `browser`, `device`, or `dashboard`. | `browser` |
| `--device <kind>` | `auto`, `phone`, or `laptop`. Only used when `--scene device`. `auto` alternates per variant. | `auto` |
| `--variants <1-4>`, `-n` | Number of mockup variants. | `3` |
| `--style <text>` | Style direction. Matched against keyword presets (below). | `polished SaaS, crisp product UI` |
| `--audience <text>` | Target audience, recorded in the brief and the prompts. | `software buyers` |
| `--accent <hex>` | Force the accent color instead of deriving it. | derived from style |
| `--url <text>` | URL shown in the browser address pill. | `https://example.com` |
| `--output <dir>`, `-o` | Output directory. | `./product-mockup` |
| `--json` | Print the run summary as JSON on stdout. | off |
| `--help` | Show help and exit 0. | |
| `--version` | Print the version. | |

### Style presets

`--style` is free text; the first matching keyword wins.

| Preset | Triggers on | Look |
|--------|-------------|------|
| `polished` (default) | polished, quiet, refined, saas, crisp, restrained, clean | Light neutral, blue accent, 12px radii |
| `noir` | dark, noir, midnight, night, black | Dark surfaces, violet accent |
| `warm` | warm, sunset, amber, friendly, human | Light warm neutrals, amber accent, soft radii |
| `editorial` | editorial, sharp, print, serif, magazine | Light, near-square corners, red accent |
| `technical` | technical, terminal, developer, mono, engineering | Dark, tight radii, teal accent |
| `vivid` | vivid, bold, playful, loud, energetic | Light, large radii, magenta accent |

The accent hue rotates 26 degrees per variant so a set reads as a family. Pass
`--accent` to lock it.

## Scenes

| Scene | Canvas | What is drawn |
|-------|--------|---------------|
| `browser` | 1280x800 | Window with traffic lights, three-tab bar, URL pill with lock glyph and toolbar buttons, two-column page body with eyebrow, headline, CTA pair, and a side panel of cards. |
| `device` + `phone` | 720x1000 | Rounded body with side buttons, notch, status bar, headline, primary button, three content cards, four-item tab bar and home indicator. |
| `device` + `laptop` | 1280x840 | Bezelled lid with camera dot, in-screen app window with title bar, headline and CTA, bar-chart panel, tapered base with trackpad edge. |
| `dashboard` | 1440x900 | Six-item sidebar, header with search and avatar, four KPI cards with deltas, bar chart, line chart, and a four-row account table. |

## Outputs

| File | Contents |
|------|----------|
| `variants/variant-NN.svg` | The mockup frame. Named `<g>` layers, `<title>`/`<desc>` for accessibility. |
| `scene-plan.json` | Scene, resolved design tokens, seed, and notes for every variant. |
| `asset-metadata.json` | Per file: format, width, height, viewBox, aspect ratio, layer names, accent. |
| `image-prompts.md` | Prompt plus negative prompt per variant, and a compositing recipe. |
| `mockup-brief.md` | Product, audience, style interpretation, and what was generated. |
| `usage-notes.md` | How to edit layers, drop in a real screenshot, and export to PNG. |
| `manifest.json` | Every file written, with byte sizes and the run inputs. |

## Working with the output

- Delete the `canvas` layer for a transparent-background export.
- Replace `page-content` / `app-content` with a real screenshot clipped to the
  `screen` rect; keep the frame hardware on top.
- Variant geometry is seeded from the product text, scene, style, and index, so
  re-running the same command reproduces the same files exactly.
