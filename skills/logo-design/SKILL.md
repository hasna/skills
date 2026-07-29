---
name: logo-design
description: Generate multi-variant geometric logo marks as SVG, with horizontal lockups, concept notes, usage guidelines, and a manifest. Runs entirely offline and deterministically from a text brief.
---

# Logo Design

Compose parametric geometric logo marks locally. The brief, brand name, style,
and palette are hashed into a master seed; every shape, rotation, grid cell, and
color role is derived from that seed. The same inputs always produce
byte-identical SVGs, so a concept you like can be regenerated exactly.

There is no image model in this skill and no network call. If you want a
generative-art or illustrative mark, use this skill for the geometric system and
hand the written brief in `logo-brief.md` to your own image tool.

## Requirements

- Bun (the skill runs as `bun run src/index.ts`).
- No API keys, no network access, no environment variables.
- Optional: `sharp` for `--png` raster exports. It is declared as an optional
  dependency, so `bun install` will try to add it but will not fail without it.
  If `sharp` is missing, `--png` prints a clear notice and the SVG outputs are
  still written. Install it explicitly with `bun add sharp` in this directory.

## Usage

```bash
# three concepts with the default palette
skills run logo-design -- --brief "minimal geometric owl mark for a developer tool" --brand "Acme"

# positional brief, custom hex palette, four variations
skills run logo-design -- "vintage badge for a coffee roaster" --brand "Ember" --palette "#2B1B12,cream,rust" -n 4

# write somewhere specific and rasterize
skills run logo-design -- --brief "ledger app" --brand "Ledgerly" --output ./out/ledgerly --png --png-size 1024

# machine-readable summary
skills run logo-design -- --brief "mesh networking" --brand "Relay" --json
```

Run it directly from the skill directory with `bun run src/index.ts --help`.

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--brief <text>`, `-b` | Logo brief. A positional string also works. | required |
| `--brand <name>` | Brand or product name. Drives the monogram and the lockup wordmark. | `Brand` |
| `--style <text>` | Style direction. Recorded in the brief and used as the lockup tagline. | `clean geometric mark` |
| `--palette <list>` | Comma-separated colors. Accepts hex (`#1B2A4A`, `#abc`) and ~35 named colors (`navy`, `rust`, `mint`). Unknown words are hashed into a stable derived hue. | `navy,white,accent` |
| `--variations <1-6>`, `-n` | Number of concepts. | `3` |
| `--output <dir>`, `-o` | Output directory. | `./logo-design` |
| `--background` | Draw a solid backdrop rect inside each SVG. | off (transparent) |
| `--png` | Also rasterize each mark to PNG. Requires `sharp`. | off |
| `--png-size <px>` | PNG width and height. | `512` |
| `--json` | Print the run summary as JSON on stdout. | off |
| `--help` | Show help and exit 0. | |
| `--version` | Print the version. | |

## Outputs

| File | Contents |
|------|----------|
| `vector/logo-NN.svg` | Standalone mark on a 256x256 viewBox, transparent by default, with `<title>`/`<desc>` for accessibility. |
| `vector/logo-NN-lockup.svg` | 720x200 horizontal lockup: mark, wordmark, and the style line as a tagline. |
| `png/logo-NN.png` | Raster export, only when `--png` is set and `sharp` is available. |
| `concepts.json` | Per-variant seed, geometry name, description, palette roles, rationale. |
| `logo-brief.md` | The brief as interpreted, the resolved palette table, and the reproducibility note. |
| `usage-notes.md` | Clear space, minimum sizes, color roles, do / don't. |
| `manifest.json` | Every file written, with byte sizes and the run inputs. |

## Geometry system

Eight parametric constructions are available; the seed shuffles them and the
first `--variations` are used, so no two variants in a package repeat.

| Construction | What it draws |
|--------------|---------------|
| `monogram` | Brand initials knocked out of a circle, squircle, hexagon, or shield, with an accent underline. |
| `glyph-grid` | 3x3 or 4x4 modular grid of squares, circles, and triangles, mirrored across the vertical axis. |
| `orbit` | Open ring with a seeded aperture, an accent core, and a satellite dot on the ring path. |
| `chevron-stack` | Three to four nested chevrons reading as motion or ascent. |
| `prism` | Two rotated equilateral triangles with a translucent intersection. |
| `aperture` | Five to seven rotating blades around a hollow center. |
| `layer-stack` | Three sheared parallelograms reading as stacked planes. |
| `arc-mark` | Alternating half-arcs of even stroke weight. |

## Notes on picking a direction

1. Judge the mark at 16 px first. Open `vector/logo-01.svg` in a browser and zoom out.
2. Keep the mark and the wordmark separable — the lockup is a convenience, not the identity.
3. Change one input at a time (`--palette`, then `--style`) so you can attribute what improved.
4. Record the seed from `concepts.json` when you find a keeper; it is the only thing needed to reproduce it.
