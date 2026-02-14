# skill-browse

AI-powered browser automation using Browser-Use Cloud API. Execute natural language browser tasks, extract data from websites, and automate web interactions using AI agents.

## Features

- **Natural Language Tasks**: Describe what you want to do in plain English
- **AI-Powered Execution**: LLMs interpret and execute complex browsing tasks
- **Structured Data Extraction**: Extract data with optional JSON schemas
- **Real-Time Monitoring**: Watch agent actions via live URL
- **Multiple LLM Models**: GPT-4o, O3, Claude, Gemini, and more
- **Proxy Support**: Built-in proxy with country selection for captcha bypass
- **Task Management**: Pause, resume, stop, and monitor tasks

## Installation

```bash
cd skill-browse
bun install
```

## Configuration

Set your Browser-Use API key:

```bash
export BROWSER_USE_API_KEY=bu_xxx...
```

Or copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BROWSER_USE_API_KEY` | Browser-Use Cloud API key | (required) |
| `BROWSER_USE_MODEL` | Default LLM model | `gpt-4o` |
| `BROWSER_USE_PROXY` | Enable proxy by default | `false` |
| `BROWSER_USE_PROXY_COUNTRY` | Default proxy country | `us` |

Get your API key from: https://cloud.browser-use.com/billing

## Usage

### Browse Command

Execute a browser automation task:

```bash
# Basic task
bun run src/index.ts browse \
  --task "Go to hacker-news.com and find the top 5 posts"

# With options
bun run src/index.ts browse \
  --task "Search google.com for 'best laptops 2025'" \
  --model o3 \
  --proxy \
  --proxy-country us \
  --timeout 120
```

### Extract Command

Extract structured data from websites:

```bash
# Extract to file
bun run src/index.ts extract \
  --task "Go to amazon.com, search for 'laptop', and extract the names and prices of the top 5 results" \
  --output ./products.json

# With JSON schema for structured output
bun run src/index.ts extract \
  --task "Get the top 10 posts from hacker-news.com" \
  --schema '{"type":"object","properties":{"posts":{"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"url":{"type":"string"},"score":{"type":"number"}}}}}}'
```

### Task Management

```bash
# List all tasks
bun run src/index.ts list

# Check task status
bun run src/index.ts status --task-id abc123

# Pause a running task
bun run src/index.ts pause --task-id abc123

# Resume a paused task
bun run src/index.ts resume --task-id abc123

# Stop a task permanently
bun run src/index.ts stop --task-id abc123
```

## Commands Reference

| Command | Description |
|---------|-------------|
| `browse` | Execute a browser automation task |
| `extract` | Extract structured data from a website |
| `status` | Check status of a specific task |
| `list` | List all tasks |
| `pause` | Pause a running task |
| `resume` | Resume a paused task |
| `stop` | Stop a task permanently |
| `help` | Show help information |

## Options Reference

### Browse Options

| Option | Description |
|--------|-------------|
| `--task <text>` | Natural language task description (required) |
| `--model <model>` | LLM model to use |
| `--proxy` | Enable proxy |
| `--proxy-country <code>` | Proxy country (us, fr, it, jp, au, de, fi, ca) |
| `--adblock` | Enable ad blocking |
| `--highlight` | Highlight elements during execution |
| `--timeout <seconds>` | Task timeout in seconds |
| `--secrets <json>` | JSON object with credentials (see Authentication section) |
| `--secrets-file <path>` | Path to JSON file with credentials |
| `--allowed-domains <csv>` | Comma-separated list of allowed domains |

### Extract Options

All browse options plus:

| Option | Description |
|--------|-------------|
| `--output <path>` | Save extracted data to file |
| `--schema <json>` | JSON schema for structured output |
| `--json` | Output only JSON to stdout |

## Authentication & Credentials

Browser-Use supports secure credential handling for tasks that require login. Credentials are passed using placeholder keys in the task description, with actual values provided separately.

### How It Works

1. Use placeholder names in your task description (e.g., `my_user`, `my_pass`)
2. Provide actual values via `--secrets` or `--secrets-file`
3. Browser-Use injects real values directly into form fields (LLM never sees actual credentials)

### Example: Login with Credentials

```bash
# Using inline JSON
bun run src/index.ts browse \
  --task "Go to twitter.com, login with username my_user and password my_pass, then get notifications" \
  --secrets '{"my_user":"real@email.com","my_pass":"realPassword123"}' \
  --allowed-domains twitter.com,x.com
```

### Example: Credentials from File

Create a `credentials.json` file:

```json
{
  "twitter_user": "myemail@example.com",
  "twitter_pass": "mypassword123",
  "github_token": "ghp_xxxxxxxxxxxx"
}
```

Then use it:

```bash
bun run src/index.ts browse \
  --task "Login to twitter with twitter_user and twitter_pass" \
  --secrets-file ./credentials.json
```

### Security Best Practices

- **Never include real credentials in the task description** - use placeholder names
- **Use `--allowed-domains`** to restrict where the browser can navigate
- **Store credentials in files** rather than command line for shell history safety
- **Use environment-specific credential files** for different environments

## Supported Models

| Model | Provider | Notes |
|-------|----------|-------|
| `gpt-4o` | OpenAI | Default, good balance |
| `o3` | OpenAI | Best accuracy |
| `o4-mini` | OpenAI | Faster, lower cost |
| `claude-sonnet-4` | Anthropic | Latest Claude |
| `claude-3-5-sonnet` | Anthropic | Previous Claude |
| `gemini-flash-latest` | Google | Fast |
| `browser-use` | Browser-Use | 3-5x faster |

## Proxy Countries

- `us` - United States
- `fr` - France
- `it` - Italy
- `jp` - Japan
- `au` - Australia
- `de` - Germany
- `fi` - Finland
- `ca` - Canada

## Examples

### Research Task

```bash
bun run src/index.ts browse \
  --task "Go to techcrunch.com and summarize the top 3 AI news stories from today" \
  --model o3 \
  --timeout 180
```

### E-commerce Scraping

```bash
bun run src/index.ts extract \
  --task "Search for 'wireless headphones' on amazon.com and get the name, price, and rating of the top 10 results" \
  --output ./headphones.json \
  --proxy \
  --proxy-country us
```

### Form Automation

```bash
bun run src/index.ts browse \
  --task "Go to example-form.com, fill in the contact form with name 'John Doe', email 'john@example.com', message 'Hello', and submit"
```

### Social Media Data

```bash
bun run src/index.ts extract \
  --task "Go to twitter.com/elonmusk and extract the text and timestamp of the last 5 tweets" \
  --output ./tweets.json \
  --model o3
```

## API Reference

The skill uses the Browser-Use Cloud API. For more information:
- Documentation: https://docs.browser-use.com/
- API Reference: https://docs.browser-use.com/api-reference/

## Pricing

Browser-Use charges per task initialization and per step:
- Task initialization: $0.01
- Per step (GPT-4o): $0.025
- Per step (O3): $0.01 (promotional)

Example: A 10-step task with GPT-4o costs ~$0.26

See https://browser-use.com/pricing for current rates.

## License

MIT
