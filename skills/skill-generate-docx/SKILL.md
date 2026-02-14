---
name: Generate Docx
version: 1.0.0
description: Generate docx with customizable options
author: skills.md
category: Documentation
tags:
  - documentation
  - markdown
  - ai
---
--topic "Project Proposal for Mobile App Development" -o proposal.docx

# Generate DOCX

Create professional Microsoft Word documents from markdown content, plain text, or let AI generate complete documents from a topic or outline.

> **This is a CLI skill.** It requires the `skills` CLI to execute. Install it with `npm install -g @hasna/skills`, then run the commands below.

## Features

- **Markdown to DOCX**: Convert markdown files to Word documents
- **AI Generation**: Generate complete documents from topics/prompts
- **Rich Formatting**: Headers, lists, tables, code blocks, quotes
- **Custom Styling**: Fonts, colors, margins, spacing
- **Templates**: Professional templates (report, letter, memo, resume)
- **Table of Contents**: Auto-generated TOC
- **Headers/Footers**: Page numbers, dates, custom text
- **Images**: Embed images from local files or URLs

## Installation

```bash
skills install generate-docx
```

## Quick Start

### From Markdown

```bash
# Convert markdown to Word
skills run generate-docx -- document.md -o output.docx

# With custom styling
skills run generate-docx -- document.md --template report --font "Times New Roman"
```

### AI Generation

```bash
# Generate from topic
skills run generate-docx -- --topic "Project Proposal for Mobile App Development" -o proposal.docx

# With more control
skills run generate-docx -- --topic "Employee Handbook" \
  --sections 10 \
  --style formal \
  --template report \
  -o handbook.docx
```

### From Text/Prompt

```bash
# Generate from prompt
skills run generate-docx -- --prompt "Write a cover letter for a software engineer position at Google" -o cover-letter.docx
```

## Options

### Input Options

| Flag              | Description                     |
| ----------------- | ------------------------------- |
| `<file>`          | Input markdown file             |
| `--topic <text>`  | Topic for AI to write about     |
| `--prompt <text>` | Direct prompt for AI generation |
| `--text <text>`   | Plain text content              |

### AI Options

| Flag              | Default      | Description                                   |
| ----------------- | ------------ | --------------------------------------------- |
| `--sections <n>`  | 5            | Number of sections to generate                |
| `--style <type>`  | professional | Style: professional, casual, formal, academic |
| `--tone <type>`   | neutral      | Tone: neutral, friendly, authoritative        |
| `--length <type>` | medium       | Length: short, medium, long, comprehensive    |

### Output Options

| Flag                  | Default         | Description      |
| --------------------- | --------------- | ---------------- |
| `-o, --output <path>` | auto            | Output file path |
| `--dir <path>`        | .skills/exports | Output directory |

### Template Options

| Flag                | Default | Description                                              |
| ------------------- | ------- | -------------------------------------------------------- |
| `--template <name>` | default | Template: default, report, letter, memo, resume, article |
| `--title <text>`    | auto    | Document title                                           |
| `--author <text>`   | -       | Author name                                              |
| `--company <text>`  | -       | Company name                                             |
| `--date <text>`     | today   | Document date                                            |

### Styling Options

| Flag                    | Default       | Description             |
| ----------------------- | ------------- | ----------------------- |
| `--font <name>`         | Calibri       | Font family             |
| `--font-size <pt>`      | 11            | Base font size          |
| `--heading-font <name>` | Calibri Light | Heading font            |
| `--line-spacing <n>`    | 1.15          | Line spacing multiplier |
| `--margins <inches>`    | 1             | Page margins            |
| `--page-size <size>`    | letter        | Page: letter, a4, legal |

### Content Options

| Flag              | Default | Description               |
| ----------------- | ------- | ------------------------- |
| `--toc`           | false   | Include table of contents |
| `--page-numbers`  | true    | Include page numbers      |
| `--header <text>` | -       | Header text               |
| `--footer <text>` | -       | Footer text               |

## Templates

### default

Clean, minimal document with standard formatting.

### report

Professional report with title page, TOC, headers/footers.

### letter

Business letter format with date, addresses, signature block.

### memo

Internal memo format with To/From/Subject/Date header.

### resume

CV/Resume format with sections for experience, education, skills.

### article

Article/essay format with abstract and section numbering.

## Examples

### Example 1: Simple Markdown Conversion

```bash
skills run generate-docx -- notes.md -o notes.docx
```

### Example 2: Professional Report

```bash
skills run generate-docx -- \
  --topic "Q4 2024 Sales Analysis" \
  --template report \
  --sections 8 \
  --style formal \
  --toc \
  --author "Sales Team" \
  --company "Acme Corp" \
  -o q4-report.docx
```

### Example 3: Business Letter

```bash
skills run generate-docx -- \
  --prompt "Write a business letter declining a partnership offer politely" \
  --template letter \
  --author "John Smith" \
  --company "Tech Solutions Inc" \
  -o decline-letter.docx
```

### Example 4: Resume from Markdown

```bash
skills run generate-docx -- resume.md \
  --template resume \
  --font "Garamond" \
  --margins 0.75 \
  -o my-resume.docx
```

### Example 5: Academic Paper

```bash
skills run generate-docx -- paper.md \
  --template article \
  --font "Times New Roman" \
  --font-size 12 \
  --line-spacing 2 \
  --toc \
  -o research-paper.docx
```

### Example 6: Company Memo

```bash
skills run generate-docx -- \
  --prompt "Write a memo announcing the new remote work policy" \
  --template memo \
  --author "HR Department" \
  -o remote-work-memo.docx
```

## Markdown Support

The skill supports standard markdown plus extensions:

```markdown
# Heading 1

## Heading 2

### Heading 3

Regular paragraph text with **bold**, _italic_, and `code`.

- Bullet list item 1
- Bullet list item 2
  - Nested item

1. Numbered list
2. Second item

> Block quote text

| Column 1 | Column 2 |
| -------- | -------- |
| Cell 1   | Cell 2   |

![Image](path/to/image.png)

---

Horizontal rule above
```

## Environment Variables

```bash
# Required for AI generation
export OPENAI_API_KEY="sk-..."
```

## Credits

- Base conversion: 3 credits
- AI generation: +5 credits

## Troubleshooting

**Document won't open**

- Ensure .docx extension is used
- Try opening in Google Docs or LibreOffice

**Formatting looks wrong**

- Different Word versions render slightly differently
- Try adjusting font and spacing options

**Images not appearing**

- Use absolute paths for local images
- Ensure image files exist

**AI generation failed**

- Check OPENAI_API_KEY is set
- Use markdown input instead of --topic

## Related Skills

- `generate-pdf` - Create PDF documents
- `generate-slides` - Create presentations
- `parse-pdf` - Extract content from PDFs

## Support

For issues or feature requests, visit [skills.md/skills/generate-docx](https://skills.md/skills/generate-docx)

```