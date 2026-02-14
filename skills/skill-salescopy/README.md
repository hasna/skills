# service-salescopygenerate

Sales copy generator using AI. Create high-converting sales letters, landing pages, email sequences, and more.

## Features

- Multiple copy types: sales letters, landing pages, email sequences, headlines, etc.
- Built-in copywriting templates: AIDA, PAS, FAB, and more
- Tone control: professional, casual, urgent, friendly, etc.
- Session management for organizing copy variations
- OpenAI GPT-4o powered generation

## Installation

```bash
bun install -g @hasnaxyz/service-salescopygenerate
```

## CLI

```bash
# Generate a sales letter
service-salescopygenerate generate -n "Product Name" -d "Product description" -t sales-letter

# Use a template
service-salescopygenerate generate -n "Product Name" -d "Description" --template aida

# Generate with specific tone and length
service-salescopygenerate generate -n "Product" -d "Description" --tone urgent -l long

# Generate multiple variations
service-salescopygenerate generate -n "Product" -d "Description" -v 3

# List templates
service-salescopygenerate templates list

# Manage sessions
service-salescopygenerate sessions list
service-salescopygenerate sessions show <id>
service-salescopygenerate sessions export <id> -o output.md

# Configuration
service-salescopygenerate config show
service-salescopygenerate config set defaultModel gpt-4o
```

## Copy Types

- `sales-letter` - Persuasive sales letters
- `landing-page` - Landing page copy
- `email-sequence` - Email marketing sequences
- `headline` - Compelling headlines
- `bullet-points` - Benefit-focused bullets
- `call-to-action` - CTA buttons and phrases
- `testimonial-request` - Testimonial requests
- `product-description` - Product descriptions

## Templates

- `aida` - Attention, Interest, Desire, Action
- `pas` - Problem, Agitate, Solution
- `fab` - Features, Advantages, Benefits
- `headline-power` - Power headline variations
- `email-welcome` - Welcome email sequence

## Environment

- `OPENAI_API_KEY` - Required

## License

Apache-2.0 - Copyright (c) 2025 Hasna
