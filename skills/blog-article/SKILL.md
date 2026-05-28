---
name: blog-article
description: Generate one or more SEO-ready blog article packages as hosted premium artifacts.
---

# Blog Article

Generate blog articles as downloadable Markdown, HTML, JSON, and manifest artifacts.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only skill metadata and instructions.

## Usage

```bash
skills quote create-blog-article --count 8 --topic "SaaS onboarding"
skills run create-blog-article --count 8 --topic "SaaS onboarding" --audience "founders" --length long --seo
skills run create-blog-article -- --topic "Product-led growth" --articles 12
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--topic <text>` | Topic or theme. Positional text also works. | required |
| `--audience <text>` | Intended reader or buyer persona. | |
| `--count <number>` | Number of articles to generate, 1-12. | 1 |
| `--articles <number>` | Alias for `--count`. | |
| `--tone <tone>` | `professional`, `casual`, `technical`, or `friendly`. | professional |
| `--length <length>` | `short`, `medium`, or `long`. | medium |
| `--seo` | Include SEO metadata and keyword-oriented structure. | false |
| `--outline <text>` | Optional outline, angles, or required sections. | |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `manifest.json` using the `skills.blogArticle.outputs.v1` contract
- For a single article: `article.md`, `article.html`, `article.json`
- For batch runs: `article-XX-<slug>/article.md`, `article.html`, `article.json`

`manifest.json` includes the run id, prompt, sanitized input options, requested tone/length/SEO settings, receipt cost, and an `articles` array. Each article entry includes `title`, `slug`, `summary`, `keywords`, optional `featuredImage`, word count, reading time, and relative file paths.

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
