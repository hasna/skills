---
name: skill-browse
description: AI-powered browser automation using Browser-Use Cloud API
---

# skill-browse

Browser automation skill that leverages Browser-Use Cloud API to perform AI-powered web browsing, data extraction, and automation tasks.

## Key Features

- **Natural Language Tasks**: Describe browser actions in plain English
- **AI-Powered Automation**: Uses LLMs to interpret and execute complex browsing tasks
- **Data Extraction**: Extract structured data from any website
- **Real-Time Monitoring**: Live URL to watch agent actions
- **Multiple LLM Support**: Choose from GPT-4o, O3, Claude, Gemini, and more
- **Proxy Support**: Built-in proxy for captcha bypass with country selection
- **Task Management**: Pause, resume, and stop tasks as needed

## Supported Models

- **GPT-4o**: Default, great balance of speed and accuracy
- **O3**: Best accuracy, recommended for complex tasks
- **Claude Sonnet 4**: Anthropic's latest model
- **Gemini Flash**: Google's fast model
- **Browser-Use**: Proprietary model, 3-5x faster

## Use Cases

- Web scraping and data extraction
- Form filling and submission
- Website testing and monitoring
- Automated research and data gathering
- Price monitoring and comparison
- Content aggregation

## Configuration

Environment variables:
- `BROWSER_USE_API_KEY`: API key (required)
- `BROWSER_USE_MODEL`: Default model
- `BROWSER_USE_PROXY`: Default proxy setting
- `BROWSER_USE_PROXY_COUNTRY`: Default proxy country

## Quick Start

```bash
# Basic browsing task
bun run src/index.ts browse \
  --task "Go to hacker-news.com and find the top 3 posts"

# Extract data with output
bun run src/index.ts extract \
  --task "Search amazon.com for 'laptop' and extract top 5 products" \
  --output ./products.json
```
