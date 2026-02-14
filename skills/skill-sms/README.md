# mcp-sms

MCP SMS server for AI agents - Bun/TypeScript with Twilio

## Overview

This server provides SMS functionality for AI agents using Twilio. Each AI agent can send and receive SMS messages through their assigned phone number.

## Features

- Send SMS messages
- List messages for a phone number
- Read specific messages
- List phone numbers
- Buy new phone numbers
- HTTP API with Bearer token authentication

## Agent Phone Numbers

| Agent | Phone Number | Display Name |
|-------|--------------|--------------|
| Claude | +1 (555) 000-0000 | Claude (AI Agent) |

## Usage

### HTTP Server

```bash
# Set environment variables
export TWILIO_ACCOUNT_SID="your_account_sid"
export TWILIO_AUTH_TOKEN="your_auth_token"
export MCP_SMS_API_KEY="your_api_key"

# Start server
bun run server
```

### API Endpoints

- `GET /health` - Health check
- `POST /send` - Send SMS
- `GET /messages/:phone` - List messages
- `GET /message/:sid` - Get specific message
- `GET /numbers` - List phone numbers
- `POST /numbers/buy` - Buy a phone number
- `GET /agent/:name` - Get agent info

### Send SMS Example

```bash
curl -X POST http://localhost:3848/send \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_name": "claude",
    "from_number": "+15550000000",
    "to": "+15550000001",
    "body": "Hello from the SMS agent!"
  }'
```

## Development

```bash
bun install
bun run dev
```

## License

MIT
