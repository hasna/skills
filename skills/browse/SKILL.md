---
name: browse
description: Run hosted browser automation and page extraction through the Skills runtime.
---

# Browse

Browse is a hosted premium skill for browser automation, page interaction, and
structured extraction. The OSS package exposes the public contract only; browser
infrastructure, provider credentials, proxies, model routing, worker code, and
logs stay server-side.

## Usage

```bash
skills setup --mode self-hosted --api-url https://operator.example
skills auth login
skills run browse --task "Open example.com and summarize the page"
skills runs status <run-id>
skills exports download <run-id>
```

## Options

| Option | Description |
| --- | --- |
| `--task <text>` | Browser task or extraction goal |
| `--url <url>` | Optional starting URL |
| `--output <format>` | Requested artifact format |

## Requirements

- Authenticate with `skills auth login` or provide `SKILLS_API_KEY`.
- Browser/provider credentials and proxy settings are managed by the hosted
  runtime, not by the OSS package.
