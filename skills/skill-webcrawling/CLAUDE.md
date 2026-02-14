# service-webcrawling

Web crawling service using Firecrawl API.

## Tech Stack

- Runtime: Bun
- Language: TypeScript
- CLI: Commander.js
- API: Firecrawl

## CLI

```bash
service-webcrawling scrape https://example.com
service-webcrawling crawl https://example.com -d 2 -l 20
service-webcrawling sessions
```

## Environment

- `FIRECRAWL_API_KEY` - Required
