---
name: Article Writer
description: Generate high-quality articles using parallel AI agents. Supports research, writing, and optional cover image generation. Write single articles or batch process multiple topics with configurable parallelism.
---

# Article Writer Skill

This skill spawns parallel AI agents to research and write articles on any topic. Each article goes through a multi-phase pipeline:

1. **Research Agent** - Gathers information and key points about the topic
2. **Writer Agent** - Creates a well-structured article based on the research
3. **Image Agent** (optional) - Generates a cover image for the article

## Features

- Write single articles or batch process multiple topics
- Configurable writing styles (blog, technical, news, academic, casual)
- Adjustable article lengths (short, medium, long)
- Optional cover image generation (OpenAI DALL-E, Google Imagen, xAI Aurora)
- Parallel processing for batch operations
- Markdown output with YAML frontmatter
- Automatic directory creation

## Usage

### Write a Single Article
```bash
bun run src/index.ts write \
  --topic "The Future of AI in Healthcare" \
  --style technical \
  --length long \
  --output ./articles \
  --image
```

### Batch Write Multiple Articles
```bash
bun run src/index.ts batch \
  --topics "Machine Learning" "Cloud Computing" "Cybersecurity" \
  --style blog \
  --output ./articles \
  --parallel 5 \
  --image
```

## Configuration

Set up API keys as environment variables:
```bash
export ANTHROPIC_API_KEY=your_anthropic_key    # Required
export OPENAI_API_KEY=your_openai_key          # For image generation
export GOOGLE_API_KEY=your_google_key          # Alternative image provider
export XAI_API_KEY=your_xai_key                # Alternative image provider
```

## Output Format

Articles are saved as Markdown files with YAML frontmatter:
```markdown
---
title: "Article Title"
topic: "original topic"
style: "blog"
generatedAt: "2024-01-15T10:30:00.000Z"
wordCount: 1200
coverImage: "./article-title-cover.png"
---

# Article Title

Article content...
```

## Writing Styles

| Style | Description |
|-------|-------------|
| blog | Conversational, engaging with personal touches |
| technical | Professional with precise terminology |
| news | Journalistic, inverted pyramid structure |
| academic | Formal with scholarly tone |
| casual | Friendly, like talking to a knowledgeable friend |

## Article Lengths

| Length | Word Count |
|--------|------------|
| short | 300-600 words |
| medium | 800-1200 words |
| long | 1500-2500 words |
