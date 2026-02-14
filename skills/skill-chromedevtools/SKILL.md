---
name: skill-chromedevtools
description: Browser automation and debugging with Chrome DevTools Protocol. Navigate pages, inspect elements, debug JavaScript, analyze network requests, and capture screenshots. Use for web testing, debugging, and browser automation tasks.
---

# Chrome DevTools Skill

## What this Skill does

This Skill provides browser automation and debugging capabilities using the Chrome DevTools Protocol (CDP) for testing, debugging, and automating web interactions.

## When to use this Skill

Use this Skill when you need to:
- Automate browser interactions and workflows
- Debug web applications and inspect elements
- Capture screenshots and page snapshots
- Analyze network requests and responses
- Execute JavaScript in browser context
- Test web applications and user flows
- Monitor console logs and errors
- Evaluate page performance

## MCP Server Connection

The Chrome DevTools MCP server provides access to Chrome via the DevTools Protocol.

```json
{
  "chrome-devtools": {
    "command": "npx",
    "args": ["-y", "chrome-devtools-mcp@latest", "--headless"],
    "env": {
      "CHROME_HEADLESS": "true",
      "HEADLESS": "true"
    }
  }
}
```

**Options**:
- Add `--browserUrl http://localhost:9222` to connect to running Chrome instance
- Remove `--headless` for visible browser
- Use `--logFile /path/to/log` for debugging

## Available Operations

The Chrome DevTools MCP server provides tools for:

- **Navigation**: Navigate to URLs, go back/forward, reload pages
- **Element Interaction**: Click, type, fill forms, hover over elements
- **Screenshots**: Capture full page or element screenshots
- **Snapshots**: Take accessibility tree snapshots
- **JavaScript Execution**: Evaluate scripts in page context
- **Network Analysis**: Monitor requests, responses, and timing
- **Console Monitoring**: Capture console logs and errors
- **Dialog Handling**: Handle alerts, confirms, and prompts
- **Performance**: Trace and analyze page performance

## Browser Automation Features

- **Headless Mode**: Run without visible browser window
- **Multi-tab Support**: Manage multiple browser tabs
- **Network Throttling**: Simulate slow connections
- **Geolocation**: Emulate different locations
- **Device Emulation**: Test mobile viewports
- **File Upload**: Handle file input elements

## Examples

### Example 1: Navigate and screenshot
"Go to example.com and take a screenshot"
→ Claude navigates the browser and captures the page

### Example 2: Test a form
"Fill out the login form with test credentials and submit"
→ Claude interacts with form elements and submits

### Example 3: Debug JavaScript
"Check the console for errors on this page"
→ Claude captures and analyzes console output

### Example 4: Analyze network
"Monitor network requests when loading this page"
→ Claude tracks all network activity

### Example 5: Performance testing
"Start a performance trace and reload the page"
→ Claude captures performance metrics

## Best practices

- Use headless mode for faster automation
- Take snapshots instead of screenshots for better accessibility
- Wait for elements to be visible before interacting
- Handle dialogs appropriately (accept/dismiss)
- Monitor console errors for debugging
- Use network filtering for specific request types
- Capture screenshots for visual verification

## Integration Notes

The Chrome DevTools MCP server automatically handles:
- Browser lifecycle management
- Element location and interaction
- Wait conditions and timeouts
- Screenshot and snapshot capture
- Network request tracking
- Console message collection
- Dialog detection and handling
