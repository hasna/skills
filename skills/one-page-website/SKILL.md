---
name: one-page-website
description: Generate a deployable static one-page website — semantic responsive HTML with inlined tokenized CSS, progressive-enhancement JavaScript, dark mode, a section map, copy, and deploy notes. No build step and no external requests.
---

# One Page Website

Generate a complete static one-page site: hero, features, proof, pricing, FAQ,
and CTA. The output is plain HTML, CSS, and JavaScript that you can open with
`file://` or drop on any static host. There is no bundler, no framework, no
webfont fetch, and no third-party request of any kind — which also means no
API keys and no network access at generation time.

## Requirements

- Bun (the skill runs as `bun run src/index.ts`).
- No API keys, no network access, no environment variables.
- One runtime dependency: `marked`, used only to parse `--copy` markdown. Run
  `bun install` in this skill directory. If it is missing you get
  `Missing dependency 'marked'. Run bun install in this skill directory.`

## Usage

```bash
# the whole page from a name and a headline
skills run one-page-website -- --name "MeterKit" --tagline "Usage billing that finance actually trusts"

# short page, bold look
skills run one-page-website -- "Relay" --sections hero,features,cta --style bold

# inject your own copy and lock the brand color
skills run one-page-website -- --name "MeterKit" --copy ./copy.md --accent "#0F7B7B" -o ./out

# name your own feature cards
skills run one-page-website -- --name "Ledgerly" --features "Double-entry core,Close in a day,Auditor-ready exports"

# machine-readable summary
skills run one-page-website -- --name "Relay" --json
```

Then serve it:

```bash
cd out/site && python3 -m http.server 8000
```

Run the skill directly from its directory with `bun run src/index.ts --help`.

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--name <text>` | Brand or product name. A positional string also works. | required |
| `--tagline <text>` | Hero headline. | generated from the name |
| `--sections <list>` | Comma list drawn from `hero,features,proof,pricing,faq,cta`. Unknown names fail with the valid list. `hero` is always included. | all six |
| `--style <text>` | Style direction, matched against the presets below. | `clean` |
| `--copy <file>` | Markdown file whose headings override the generated copy. See below. | none |
| `--goal <text>` | Primary CTA label, also used for the closing heading. | `Book a demo` |
| `--audience <text>` | Who the page is for. Appears in the lead and the testimonial. | `software teams` |
| `--features <list>` | Comma list of feature card titles. | generated |
| `--accent <hex>` | Force the accent color. | from the style preset |
| `--output <dir>`, `-o` | Output directory. | `./one-page-website` |
| `--json` | Print the run summary as JSON on stdout. | off |
| `--help` | Show help and exit 0. | |
| `--version` | Print the version. | |

### Style presets

| Preset | Triggers on | Look |
|--------|-------------|------|
| `clean` (default) | clean, polished, quiet, refined, saas, minimal, crisp | System sans, blue accent, 10px radii |
| `editorial` | editorial, magazine, serif, print, sharp | Serif display face, near-square corners, red accent |
| `bold` | bold, loud, playful, vivid, energetic, startup | Heavy 800-weight headings, large radii, magenta accent |
| `warm` | warm, human, friendly, approachable, amber | Amber accent, soft radii |
| `technical` | technical, developer, mono, terminal, engineering, infra | Monospace display face, tight radii, teal accent |

Presets set CSS custom properties only. Everything downstream — dark mode, both
button variants, the CTA band — derives from those tokens.

## Using `--copy`

Point `--copy` at a markdown file. The mapping is:

- An `# H1` becomes the hero headline.
- Any prose before the first `## H2` becomes the hero lead.
- An `## H2` whose slug matches a section id (`features`, `proof`, `pricing`,
  `faq`, `cta`, `hero`) has its body rendered into that section as rich text,
  above the generated content.
- Any other `## H2` becomes a new section with its own id, nav entry, and
  anchor, inserted just before the CTA.

Markdown lists, tables, code blocks, and blockquotes are all styled by the
`.rich-text` rules. Run once without `--copy`, edit the emitted `copy.md`, then
re-run with `--copy copy.md`.

## Outputs

| File | Contents |
|------|----------|
| `site/index.html` | The page. Stylesheet inlined in `<style>` so a cold visit is one request. |
| `site/styles.css` | The identical stylesheet as a standalone file, if you prefer to link it. |
| `site/script.js` | Mobile nav, single-open FAQ, smooth scroll with focus management, scrollspy, header shadow. |
| `site/README.md` | How to serve it, how to split the CSS, what each token does. |
| `section-map.json` | Every section id, nav label, anchor, and whether a copy override was applied. |
| `copy.md` | The generated copy in markdown, ready to edit and feed back through `--copy`. |
| `deploy-notes.md` | Netlify / Cloudflare / GitHub Pages / S3 commands, cache headers, a CSP, and a pre-ship checklist. |
| `manifest.json` | Every file written, with byte sizes and the run inputs. |

## What "progressive enhancement" means here

- The FAQ is native `<details>`/`<summary>`. It opens and closes with JavaScript
  disabled; the script only adds single-open behaviour.
- The mobile menu button ships `hidden` and is revealed by the script. With
  JavaScript off, the nav list stays visible instead of being trapped behind a
  dead button.
- Anchor clicks move focus to the target element so keyboard and screen reader
  users land where sighted users do.
- `scroll-behavior: smooth` is inside a `prefers-reduced-motion: no-preference`
  guard, and the script checks the same media query.
- Dark mode is a `@media (prefers-color-scheme: dark)` block that overrides only
  color tokens.

## Accessibility

Skip link to `#main`, landmark elements (`header`, `nav[aria-label]`, `main`,
`footer`), exactly one `<h1>`, `aria-labelledby` on every section,
`aria-expanded` on the nav toggle, `aria-current` maintained by the scrollspy,
and a visible `:focus-visible` ring on every interactive element.
