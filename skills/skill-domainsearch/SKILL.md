---
name: Domain Search
description: Search domain availability and suggestions via GoDaddy API
---

# Domain Search

Search domain availability and get suggestions via the GoDaddy API. Provides both a CLI tool and an HTTP server for domain search workflows.

## Features

- Check domain name availability
- Get domain suggestions based on keywords
- HTTP server mode for API-driven searches
- Configurable API endpoint and credentials

## Usage

```bash
# Run the CLI
skill-domainsearch

# Start the HTTP server
bun run start

# Development mode with watch
bun run dev
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DOMAIN_API_KEY` | GoDaddy API key |
| `DOMAIN_API_SECRET` | GoDaddy API secret |
| `DOMAIN_CUSTOMER_ID` | GoDaddy customer ID |
| `DOMAIN_API_URL` | API base URL (default: `https://api.godaddy.com`) |

## Configuration

Config is stored at `~/.config/service-domainsearch/config.json`. Environment variables take priority over the config file.
