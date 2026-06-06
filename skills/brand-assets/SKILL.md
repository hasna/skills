---
name: brand-assets
description: Fetch official brand assets from a website or brand name, then return logos, palette, typography, source metadata, and a clean asset manifest. Use when a user asks to find, extract, download, package, or normalize a brand's logo and visual identity assets.
---

# Brand Assets

Discover official brand identity material for a company, product, or website and package it into a clean handoff folder.

## Requirements

- Hosted premium execution requires `SKILLS_API_KEY`.
- Provider keys stay server-side in the hosted runtime.
- Provide either a brand name, a website URL, or both. A URL is preferred when the brand name is ambiguous.

## Usage

```bash
skills run brand-assets --url https://example.com
skills run brand-assets --brand "Acme Ledger" --sizes 64,128,256,512,1024
skills run brand-assets "Acme Ledger" --url https://example.com --include-screenshot
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--brand <text>` | Brand, product, or company name. Positional text also works. | inferred when possible |
| `--url <url>` | Official website or landing page to inspect. | optional |
| `--sizes <list>` | Comma-separated PNG export sizes. | `64,128,256,512,1024` |
| `--include-screenshot` | Include a visual reference screenshot when available. | false |

## Hosted Workflow

1. Resolve the most likely official website and brand pages from the supplied brand or URL.
2. Inspect the selected pages for linked logos, favicon assets, social preview images, brand colors, fonts, typography, and structured metadata.
3. Prefer official vector logos, then normalize fallback image assets into the requested PNG sizes.
4. Name every asset with a stable brand slug, file role, variant, and size.
5. Include source URLs and confidence notes so downstream users know where each asset came from.

## Outputs

- `manifest.json`
- `brand-profile.json`
- `brand-profile.md`
- `palette.json`
- `typography.md`
- `logo-usage.md`
- `sources.json`
- `logos/svg/<brand>-logo.svg`
- `logos/png/<brand>-logo-64.png`
- `logos/png/<brand>-logo-128.png`
- `logos/png/<brand>-logo-256.png`
- `logos/png/<brand>-logo-512.png`
- `logos/png/<brand>-logo-1024.png`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
