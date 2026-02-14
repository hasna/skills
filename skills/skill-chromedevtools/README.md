# skill-chromedevtools

Browser automation and debugging with Chrome DevTools Protocol

## Overview

This Skill provides browser automation and debugging capabilities using the Chrome DevTools Protocol (CDP) for testing web applications, automating workflows, and debugging.

## MCP Server

Uses the Chrome DevTools MCP server for browser control.

Connection: NPM package `chrome-devtools-mcp`

## Usage

This Skill is automatically invoked by Claude Code when working with browser automation tasks.

Example requests:
- "Navigate to example.com and take a screenshot"
- "Fill out the login form and submit"
- "Check console errors on this page"
- "Monitor network requests"

## Setup

No API key required. Chrome must be installed on the system.
