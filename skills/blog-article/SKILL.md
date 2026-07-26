---
name: blog-article
description: Generate one or more SEO-ready blog article packages as hosted artifacts.
kind: instruction
---

# Blog Article

Generate blog articles as downloadable Markdown, HTML, JSON, and manifest artifacts.

## Requirements

None. This is an instruction skill: it is prose an agent follows, so it needs no
credentials, no network access, and no local runtime.

## Usage

Ask an agent for the deliverables below and give it the inputs. Reading this file
IS the invocation; `skills run` refuses instruction skills on purpose.

## Inputs

| Input | Description | Default |
|--------|-------------|---------|
| `topic` | Topic or theme. Positional text also works. | required |
| `audience` | Intended reader or buyer persona. | |
| `count` | Number of articles to generate, 1-12. | 1 |
| `articles` | Alias for `--count`. | |
| `tone` | `professional`, `casual`, `technical`, or `friendly`. | professional |
| `length` | `short`, `medium`, or `long`. | medium |
| `seo` | Include SEO metadata and keyword-oriented structure. | false |
| `outline` | Optional outline, angles, or required sections. | |

## Deliverables

- `manifest.json` using the `skills.blogArticle.outputs.v1` contract
- For a single article: `article.md`, `article.html`, `article.json`
- For batch runs: `article-XX-<slug>/article.md`, `article.html`, `article.json`

`manifest.json` includes the run id, prompt, sanitized input options, requested tone/length/SEO settings, receipt cost, and an `articles` array. Each article entry includes `title`, `slug`, `summary`, `keywords`, optional `featuredImage`, word count, reading time, and relative file paths.

## Method

1. Confirm topic, audience and search intent before writing. If the topic is
   ambiguous, state the interpretation you chose.
2. Outline first: H2/H3 skeleton with one sentence of intent per section. Get the
   shape right before producing prose.
3. Write the draft to the requested length and tone. Lead with the answer; do not
   warm up for three paragraphs.
4. Support claims with specifics — numbers, examples, named tools. Remove any
   sentence that would survive unchanged in an article about something else.
5. If SEO is requested, add title, meta description, slug and internal-link
   suggestions as a separate block, never by stuffing the body.
6. Finish with a self-edit pass: cut hedging, merge duplicate points, verify every
   factual claim you cannot source is marked as an assumption.
