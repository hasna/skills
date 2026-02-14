---
name: skill-browseruse
description: AI-powered browser automation for complex web tasks. Natural language browser control, intelligent navigation, form filling, data extraction, and multi-step workflows. Use for advanced web automation, testing, and data collection tasks.
---

# Browser Use AI Automation Skill

## What this Skill does

This Skill provides AI-powered browser automation that understands natural language instructions for complex web interactions, navigation, and data extraction tasks.

## When to use this Skill

Use this Skill when you need to:
- Automate complex multi-step web workflows
- Extract data from websites intelligently
- Fill forms with contextual understanding
- Navigate websites using natural language
- Perform web research and data collection
- Test user journeys with AI understanding
- Handle dynamic content and SPAs
- Solve CAPTCHAs and verification flows

## MCP Server Connection

The Browser Use MCP server provides AI-powered browser automation.

```json
{
  "browser-use": {
    "command": "/opt/homebrew/bin/uvx",
    "args": ["--from", "browser-use[cli]", "browser-use", "--mcp"]
  }
}
```

**Requirements**: Python 3.10+ with uvx installed

## Available Operations

The Browser Use MCP server provides AI-driven tools for:

- **Natural Language Navigation**: Describe where to go and it navigates
- **Intelligent Form Filling**: Understands form context and fills appropriately
- **Data Extraction**: Extract structured data using natural descriptions
- **Multi-step Workflows**: Complete complex task sequences
- **Dynamic Element Handling**: Works with SPAs and AJAX content
- **Screenshot Analysis**: Visual understanding of pages
- **Error Recovery**: Handles unexpected page states
- **CAPTCHA Solving**: Intelligent verification handling

## AI-Powered Features

Browser Use leverages AI for:
- **Understanding Intent**: Interprets high-level task descriptions
- **Element Detection**: Finds elements without specific selectors
- **Context Awareness**: Makes decisions based on page state
- **Adaptive Navigation**: Handles different page layouts
- **Error Handling**: Recovers from failures intelligently
- **Data Structuring**: Extracts information in requested format

## Examples

### Example 1: Research and extraction
"Go to Hacker News and extract the top 10 stories with titles and URLs"
→ Browser Use navigates, finds elements, and extracts data

### Example 2: Complex workflow
"Search Google for 'best React libraries 2024', open the first result, and summarize the content"
→ Browser Use executes multi-step workflow with understanding

### Example 3: Form submission
"Fill out the contact form with company information and submit"
→ Browser Use understands form context and fills appropriately

### Example 4: Comparison shopping
"Compare prices for iPhone 15 on Amazon and Best Buy"
→ Browser Use navigates both sites and extracts pricing

### Example 5: Account creation
"Create a test account on the staging site with random credentials"
→ Browser Use completes registration flow intelligently

## Best practices

- Provide clear, high-level task descriptions
- Let the AI handle element selection
- Use for complex workflows that require decision-making
- Leverage for data extraction over simple automation
- Allow error recovery and retry logic
- Use for tasks that need visual understanding
- Describe desired output format for extractions
- Trust the AI to adapt to page changes

## Integration Notes

The Browser Use MCP server automatically handles:
- AI model selection and prompting
- Browser lifecycle management
- Element location with visual understanding
- Error detection and recovery
- Multi-step task planning
- Data extraction and formatting
- Screenshot analysis
- Session management

## Advanced Capabilities

- **Proxy Support**: Route through proxies for geo-specific tasks
- **Multi-page Handling**: Manage multiple tabs intelligently
- **Session Persistence**: Maintain login state across tasks
- **Rate Limiting**: Respectful automation with delays
- **Visual Verification**: Screenshot-based validation
