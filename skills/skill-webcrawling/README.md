# service-webcrawling

Web crawling service using Firecrawl API.

## Installation

```bash
bun install -g @hasnaxyz/service-webcrawling
```

## Quick Start

```bash
export FIRECRAWL_API_KEY=fc-...

# Scrape a single URL
service-webcrawling scrape https://example.com

# Crawl a website
service-webcrawling crawl https://example.com -d 2 -l 20

# List sessions
service-webcrawling sessions
```

## CLI Commands

### scrape

Scrape a single URL.

```bash
service-webcrawling scrape <url> [options]

Options:
  -f, --format <format>  markdown, html, json (default: markdown)
  --full-page            Include full page, not just main content
```

### crawl

Crawl an entire website.

```bash
service-webcrawling crawl <url> [options]

Options:
  -d, --depth <number>   Max depth (default: 2)
  -l, --limit <number>   Max pages (default: 10)
  --exclude <paths>      Exclude paths (comma-separated)
  --include <paths>      Include only paths (comma-separated)
```

### sessions

List crawl sessions.

```bash
service-webcrawling sessions [--json]
```

### config

```bash
service-webcrawling config view
service-webcrawling config set firecrawlApiKey fc-...
```

## Environment Variables

```bash
FIRECRAWL_API_KEY=fc-...  # Required
```

## License

MIT
