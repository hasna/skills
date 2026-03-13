---
name: Domain Purchase
description: Purchase and manage domains via GoDaddy API with CLI and HTTP server
---

# Domain Purchase

Purchase and manage domains via the GoDaddy API. Provides both a CLI tool and an HTTP server for domain purchasing workflows.

## Features

- Purchase domains through GoDaddy API
- Manage domain configurations and settings
- HTTP server mode for API-driven purchases
- AWS Secrets Manager integration for credential storage
- Remote server proxy mode for centralized domain management

## Usage

```bash
# Run the CLI
skill-domainpurchase

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
| `DOMAIN_USE_REMOTE_SERVER` | Use remote server proxy (`true`/`false`) |
| `DOMAIN_REMOTE_SERVER_URL` | Remote server URL |
| `DOMAIN_REMOTE_API_KEY` | Remote server API key |
| `AWS_SECRET_NAME` | AWS Secrets Manager secret name for credentials |

## Configuration

Config is stored at `~/.config/service-domainpurchase/config.json`. Environment variables take priority over the config file. AWS Secrets Manager is also supported as a credential source.
