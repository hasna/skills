---
name: slide-deck-generator
description: Turn a brief or Markdown outline into a real slide deck locally - structured slides.json, deck.md, speaker notes, theme guide, a self-contained keyboard-navigable HTML deck, and a PPTX file.
---

# Slide Deck Generator

Parse a brief, outline, report, or product narrative into a slide model, then render it to several
formats at once. This is the local binary renderer: it does the deterministic parsing, layout, and
file writing so no model call is needed to produce the artifacts.

`pitch-deck` is an instruction skill that decides the narrative and then delegates the actual
rendering to this skill. Anything that needs a real `.pptx` or a shareable HTML deck should call
`slide-deck-generator`.

Everything runs locally. No API keys, no network calls, no accounts.

## Requirements

- [Bun](https://bun.sh) 1.1+.
- `bun install` inside this skill directory. Runtime dependencies:
  - `marked` — Markdown tokenizing for `--source` outlines.
  - `pptxgenjs` — writes the real `deck.pptx` (Open XML zip package).
- No API keys and no network access. `deck.html` embeds all CSS and JS inline and makes zero
  external requests.

## Usage

```bash
# From a Markdown outline
bun run src/index.ts --source ./outline.md --slides 10 --theme aurora \
  --audience executives --format report --output ./out

# From a one-paragraph brief
bun run src/index.ts --brief "Q2 launch review for AI billing" --slides 8 --theme midnight

# Skip PPTX rendering, emit machine-readable manifest
bun run src/index.ts --source ./outline.md --no-pptx --json
```

Open `out/deck.html` in any browser: `←`/`→` (or space) to navigate, `Home`/`End` to jump, `N` to
toggle speaker notes, `Ctrl/Cmd-P` to print one slide per page.

### Markdown parsing rules

- The first `#` heading becomes the deck title (unless `--title` is given).
- Each `#`/`##` heading starts a new slide; `###` headings become bullets.
- List items become bullets; paragraphs become speaker notes (and become bullets when a slide would
  otherwise be empty); blockquotes become full-bleed quote slides; the first lines of a code block
  become bullets.
- Plain prose with no Markdown structure is split into sentences and grouped into slides.
- The deck is then fitted to `--slides`: dense slides split into `(cont.)` slides, short adjacent
  slides merge, and any remaining gap is filled with format-appropriate scaffold slides.

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-b, --brief <text>` | Brief, outline, or narrative text. Also accepted as a bare positional argument. | — |
| `-s, --source <path>` | Read the brief/outline from a Markdown or text file. | — |
| `-t, --title <text>` | Deck title. | first `#` heading, else first line of the brief |
| `-n, --slides <n>` | Target slide count (1–60). | `8` |
| `--theme <name>` | `midnight`, `aurora`, `sandstone`, `ocean`, or `mono`. | `midnight` |
| `--audience <type>` | `team`, `customers`, `executives`, or `students`. Shapes the speaker notes. | `team` |
| `--format <type>` | `general`, `training`, `sales`, `report`, or `proposal`. Shapes the closing slides. | `general` |
| `-o, --output <dir>` | Output directory. | `./slide-deck` |
| `--no-pptx` | Skip `deck.pptx`; still write every other file. | off |
| `--json` | Print `manifest.json` to stdout instead of the text summary. | off |
| `-h, --help` | Show help. | — |
| `-v, --version` | Show version. | — |

Either `--brief` or `--source` is required.

## Outputs

Written under `--output`:

| File | Contents |
|------|----------|
| `slides.json` | The slide model: index, layout (`title`/`agenda`/`bullets`/`section`/`quote`/`closing`), title, subtitle, bullets, and notes per slide. |
| `deck.md` | Readable Markdown deck, one `---` separated section per slide with inline notes. |
| `speaker-notes.md` | Per-slide talk track, on-screen recap, runtime estimate, and a delivery checklist. |
| `theme-guide.md` | Palette hex values, typography scale, layout rules, and how to swap themes. |
| `deck.html` | Self-contained reveal-style deck: inline CSS/JS, keyboard + click navigation, progress bar, notes toggle, and a print stylesheet that paginates one slide per page. No external requests. |
| `deck.pptx` | Real PowerPoint file written by `pptxgenjs` (16:9), including per-slide speaker notes. Opens in PowerPoint, Keynote, LibreOffice, and Google Slides. |
| `manifest.json` | Run metadata: title, source, theme, audience, format, slide count, layouts, and file list. |

## Notes

- PPTX rendering failures are non-fatal: the other files are still written, a warning goes to
  stderr, and `manifest.json` records `pptx: "failed: …"`.
- Scaffold slides added to reach `--slides` are labelled in their notes so they are easy to find and
  replace before presenting.
