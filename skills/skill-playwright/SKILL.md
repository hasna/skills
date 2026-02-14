---
name: skill-playwright
description: End-to-end testing and browser automation with Playwright. Automate Chromium, Firefox, and WebKit. Test web apps, fill forms, capture screenshots, and handle complex user interactions. Use for testing, automation, and web scraping tasks.
---

# Playwright Automation Skill

## What this Skill does

This Skill provides end-to-end testing and browser automation capabilities using Playwright, supporting multiple browsers and advanced automation scenarios.

## When to use this Skill

Use this Skill when you need to:
- Automate end-to-end testing workflows
- Test across multiple browsers (Chromium, Firefox, WebKit)
- Automate complex user interactions
- Fill and submit forms programmatically
- Capture screenshots and videos
- Test responsive designs and mobile viewports
- Handle authentication and cookies
- Test file downloads and uploads
- Intercept and modify network requests

## MCP Server Connection

The Playwright MCP server provides access to Playwright's automation capabilities.

```json
{
  "playwright": {
    "command": "npx",
    "args": ["@playwright/mcp@latest", "--headless"]
  }
}
```

**Options**:
- Remove `--headless` to see the browser
- Add `--browser firefox` or `--browser webkit` to use different browsers

## Available Operations

The Playwright MCP server provides tools for:

- **Navigation**: Go to URLs, navigate history, reload pages
- **Element Interaction**: Click, type, fill, select, drag and drop
- **Screenshots**: Capture page or element screenshots
- **Forms**: Fill forms with multiple fields at once
- **File Upload**: Handle file input elements
- **Dialogs**: Handle alerts, confirms, and prompts
- **Keyboard/Mouse**: Press keys, hover, drag and drop
- **Network**: Monitor and intercept network requests
- **Console**: Capture console messages and errors
- **Browser Context**: Manage cookies, storage, and authentication

## Multi-Browser Testing

Playwright supports:
- **Chromium**: Chrome/Edge equivalent
- **Firefox**: Mozilla Firefox
- **WebKit**: Safari equivalent

## Advanced Features

- **Auto-waiting**: Automatically waits for elements to be ready
- **Network Interception**: Mock API responses
- **Geolocation**: Test location-based features
- **Permissions**: Grant camera, microphone access
- **Mobile Emulation**: Test responsive designs
- **Video Recording**: Record test execution
- **Trace Viewer**: Debug test failures

## Examples

### Example 1: Cross-browser testing
"Test the login flow on Chrome, Firefox, and Safari"
→ Claude runs tests across all three browsers

### Example 2: Form automation
"Fill out the registration form with test data"
→ Claude fills all fields and submits the form

### Example 3: Screenshot comparison
"Take screenshots of the homepage on desktop and mobile"
→ Claude captures both viewport sizes

### Example 4: Network testing
"Monitor API calls when loading the dashboard"
→ Claude tracks network requests and responses

### Example 5: File handling
"Upload test.pdf to the file input and submit"
→ Claude handles file upload interaction

## Best practices

- Use auto-waiting instead of manual sleeps
- Take snapshots for assertions
- Handle dialogs appropriately
- Test across multiple browsers for compatibility
- Use selectors based on user-visible text
- Capture videos for debugging test failures
- Mock network requests for faster tests
- Use browser contexts for isolation

## Integration Notes

The Playwright MCP server automatically handles:
- Browser installation and management
- Element location and waiting
- Screenshot and video capture
- Network request tracking
- Console message collection
- Dialog handling
- Multi-browser orchestration
