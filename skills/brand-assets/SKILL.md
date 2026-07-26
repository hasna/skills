---
name: brand-assets
description: Extract brand assets from a website you name — icons, social preview images, logo images, inline SVG marks, theme colors, CSS color tokens, and font stacks — downloaded into a folder with full source provenance. Use when a user asks to find, extract, download, or package a site's logo and visual identity.
---

# Brand Assets

Point this at a URL. It fetches that page over plain HTTP, parses the markup and
the stylesheets it links, and pulls out the brand's icons, social images, logo
images, colors, and typography. Everything downloaded is recorded against the
exact URL it came from.

The only hosts contacted are the one you name and whatever that page links its
own assets from. There is no search API, no AI service, and no key of any kind.

## Requirements

- Bun (the skill runs as `bun run src/index.ts`).
- Outbound HTTP access to the site you pass. Nothing else.
- No API keys and no environment variables.
- One runtime dependency: `node-html-parser`. Run `bun install` in this skill
  directory. If it is missing you get
  `Missing dependency 'node-html-parser'. Run bun install in this skill directory.`

`--url` is **required**. There is no brand-name search fallback — omitting it
fails immediately and names the flag.

## Usage

```bash
# the normal case
skills run brand-assets -- --url https://example.com

# positional URL, custom destination and timeout
skills run brand-assets -- https://example.com --output ./out/example --timeout 30000

# inspect without downloading any binaries
skills run brand-assets -- --url https://example.com --no-download

# machine-readable profile on stdout
skills run brand-assets -- --url https://example.com --json
```

Run it directly from the skill directory with `bun run src/index.ts --help`.

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--url <url>`, `-u` | Website to inspect. A bare hostname is upgraded to `https://`. A positional URL also works. | **required** |
| `--output <dir>`, `-o` | Output directory. | `./brand-assets` |
| `--timeout <ms>`, `-t` | Per-request timeout, 500–300000. Applies to the page, each stylesheet, and each asset. | `15000` |
| `--max-assets <n>` | Cap on downloaded assets, 0–200. Anything beyond is listed as `skipped`. | `20` |
| `--no-download` | Discover and report only; fetch no binaries. | off |
| `--json` | Print the full profile as JSON on stdout. | off |
| `--help` | Show help and exit 0. | |
| `--version` | Print the version. | |

## What is discovered

| Source | What is taken |
|--------|---------------|
| `<link rel="icon">`, `shortcut icon`, `apple-touch-icon`, `mask-icon` | Favicons and touch icons, with their `sizes` and `type` |
| `<link rel="manifest">` | The web app manifest: `name`, `short_name`, `theme_color`, `background_color`, and every declared icon |
| `<meta property="og:image">`, `<meta name="twitter:image">` | Social preview images |
| `<meta name="theme-color">` | Brand color, including per-`media` light/dark variants |
| `<img>` whose `src`, `alt`, `class`, or `id` matches logo / wordmark / brandmark / brand | Logo images |
| Inline `<svg>` inside `header`, `nav`, links, or logo-classed elements | Up to three inline marks, saved as standalone SVG files |
| Inline `<style>`, `style=` attributes, and up to 6 linked stylesheets | CSS custom properties whose name mentions color / brand / accent / primary / bg / fg / surface / theme, plus ordinary `color`, `background`, `fill`, and `stroke` declarations |
| The same CSS | `font-family` declarations and font-related custom properties |

If the page declares no icon at all, `/favicon.ico` is tried as a conventional
fallback and reported honestly if it 404s.

### How colors are ranked

`<meta>` and web app manifest colors first, then hand-authored CSS custom
properties, then ordinary declarations. Utility-framework plumbing (`--tw-*` and
friends) is deliberately demoted so real brand tokens surface first. Every entry
records how many times it was seen and every source it appeared in. The palette
is capped at 48 distinct colors.

## Outputs

| File | Contents |
|------|----------|
| `assets/` | Every downloaded file, named `<role>-<original-name>.<ext>` — e.g. `icon-favicon-32x32.png`, `logo-img-wordmark.svg`, `inline-logo-01.svg`. |
| `brand-profile.json` | Everything discovered: metadata, assets with status, palette, typography, stylesheet results, counts. |
| `brand-profile.md` | The same profile as a readable summary with asset, palette, and typography tables. |
| `palette.json` | Every color: hex, how it was declared, which properties carried it, its kind, occurrence count, and every source. |
| `typography.md` | Each font stack with its full fallback chain, source, and notes on reproducing the type without the font binaries. |
| `sources.json` | The provenance map: downloaded file → source URL, status, content type, byte size, plus per-stylesheet fetch results. |
| `manifest.json` | Every file written, with byte sizes and the run inputs. |

Webfont binaries are never downloaded — licenses almost never permit
redistributing them. `typography.md` gives you the stacks instead.

## Failure behaviour

Exit code 1 with a single clear line on stderr for each of:

- `--url` missing — names the flag and shows an example.
- A value that is not an http(s) URL.
- DNS or connection failure.
- A timeout — the message tells you to raise `--timeout`.
- A non-200 response — the status code is included.
- A response whose content type is not HTML — the actual content type is quoted.

Failures *below* the page level are not fatal: a 404 favicon, an unreachable
stylesheet, or a malformed manifest is recorded with its status in
`sources.json` and `brand-profile.md`, and the run still completes.

## Provenance and reuse

These are someone else's trademarks. `sources.json` exists so you can prove where
each file came from. Confirm you have the right to use an asset before you ship
it, and check the site's own brand or press page for official guidelines and
higher-resolution originals.
