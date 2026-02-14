#!/usr/bin/env bun
/**
 * Browser Agent Skill
 * Autonomous web browsing using OpenAI's Computer-Using Agent (CUA)
 */

import { parseArgs } from "util";
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

// Types
interface BrowserAgentOptions {
  task: string;
  url?: string;
  headless: boolean;
  timeout: number;
  maxSteps: number;
  viewport: { width: number; height: number };
  saveScreenshots: boolean;
  output?: string;
  cookies?: string;
  allowlist?: string[];
  blocklist?: string[];
  verbose: boolean;
}

interface ActionLog {
  step: number;
  action: string;
  timestamp: string;
  details?: Record<string, any>;
}

interface TaskResult {
  task: string;
  status: "completed" | "failed" | "timeout" | "max_steps_reached";
  steps: number;
  duration: string;
  result: {
    data?: any;
    summary: string;
  };
  screenshots: string[];
  actions: ActionLog[];
  error?: string;
}

interface OpenAIAction {
  type: string;
  [key: string]: any;
}

interface OpenAIResponse {
  id: string;
  choices: Array<{
    message: {
      content?: string;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string;
  }>;
}

// Constants
const SKILL_NAME = "browser-agent";
const SESSION_ID = randomUUID().slice(0, 8);
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME, SESSION_ID);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);
const SESSION_TIMESTAMP = new Date()
  .toISOString()
  .replace(/[:.]/g, "_")
  .replace(/-/g, "_")
  .slice(0, 19)
  .toLowerCase();

// Ensure directories exist
function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Logger
function log(message: string, level: "info" | "error" | "success" | "debug" = "info") {
  const timestamp = new Date().toISOString();
  const logFile = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);

  ensureDir(LOGS_DIR);

  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(logFile, logEntry);

  const prefix = level === "error" ? "❌" : level === "success" ? "✅" : level === "debug" ? "🔍" : "ℹ️";
  if (level === "error") {
    console.error(`${prefix} ${message}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

// Screenshot helper
async function takeScreenshot(page: Page, stepNumber: number): Promise<string> {
  ensureDir(EXPORTS_DIR);
  const filename = `step_${String(stepNumber).padStart(3, "0")}.png`;
  const filepath = join(EXPORTS_DIR, filename);

  await page.screenshot({
    path: filepath,
    fullPage: false, // Only viewport for consistency
  });

  return filepath;
}

// Convert screenshot to base64 for OpenAI
async function screenshotToBase64(filepath: string): Promise<string> {
  const buffer = readFileSync(filepath);
  return buffer.toString("base64");
}

// Check URL against allow/block lists
function isUrlAllowed(url: string, allowlist?: string[], blocklist?: string[]): boolean {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;

    if (blocklist && blocklist.some((blocked) => domain.includes(blocked))) {
      return false;
    }

    if (allowlist && allowlist.length > 0) {
      return allowlist.some((allowed) => domain.includes(allowed));
    }

    return true;
  } catch {
    return false;
  }
}

// Execute action in Playwright
async function executeAction(
  page: Page,
  action: OpenAIAction,
  options: BrowserAgentOptions
): Promise<boolean> {
  try {
    switch (action.type) {
      case "navigate":
        if (!isUrlAllowed(action.url, options.allowlist, options.blocklist)) {
          log(`Navigation blocked by URL restrictions: ${action.url}`, "error");
          return false;
        }
        log(`Navigating to: ${action.url}`, "debug");
        await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(1000); // Brief pause for page to stabilize
        return true;

      case "click":
        log(`Clicking at: (${action.x}, ${action.y})`, "debug");
        await page.mouse.click(action.x, action.y);
        await page.waitForTimeout(500);
        return true;

      case "type":
        log(`Typing text: "${action.text}"`, "debug");
        await page.keyboard.type(action.text, { delay: 50 });
        return true;

      case "key":
        log(`Pressing key: ${action.key}`, "debug");
        await page.keyboard.press(action.key);
        await page.waitForTimeout(300);
        return true;

      case "scroll":
        const amount = action.amount || 500;
        log(`Scrolling ${action.direction}: ${amount}px`, "debug");
        await page.evaluate((scrollAmount) => {
          window.scrollBy(0, scrollAmount);
        }, action.direction === "up" ? -amount : amount);
        await page.waitForTimeout(300);
        return true;

      case "wait":
        const waitTime = action.duration || 1000;
        log(`Waiting for ${waitTime}ms`, "debug");
        await page.waitForTimeout(waitTime);
        return true;

      default:
        log(`Unknown action type: ${action.type}`, "error");
        return false;
    }
  } catch (error) {
    log(`Action execution failed: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    return false;
  }
}

// Call OpenAI Computer Use API
async function callOpenAI(
  task: string,
  screenshotBase64: string,
  conversationHistory: any[],
  stepNumber: number
): Promise<{ actions: OpenAIAction[]; response: string; finished: boolean }> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  // Build messages array with conversation history
  const messages = [
    {
      role: "system",
      content: `You are a computer-using agent that can browse the web and interact with web pages to complete tasks.

Your task: ${task}

You can perform these actions:
- navigate: Go to a URL {"type": "navigate", "url": "https://example.com"}
- click: Click at coordinates {"type": "click", "x": 100, "y": 200}
- type: Type text {"type": "type", "text": "search query"}
- key: Press a key {"type": "key", "key": "Enter"}
- scroll: Scroll page {"type": "scroll", "direction": "down", "amount": 500}
- wait: Wait for duration {"type": "wait", "duration": 1000}

When you complete the task, respond with:
- A summary of what you accomplished
- The data you extracted (if applicable)
- Your reasoning

Always think step by step. After each action, I'll send you a new screenshot.
Current step: ${stepNumber}`,
    },
    ...conversationHistory,
    {
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${screenshotBase64}`,
          },
        },
        {
          type: "text",
          text: stepNumber === 1 ? `Task: ${task}` : "Here's the current state after the last action. What's next?",
        },
      ],
    },
  ];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o", // Using GPT-4o for vision and reasoning
      messages,
      max_tokens: 1000,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
  }

  const data: OpenAIResponse = await response.json();
  const choice = data.choices[0];
  const content = choice.message.content || "";

  // Parse response for actions or completion
  const finished = content.toLowerCase().includes("task completed") ||
                   content.toLowerCase().includes("finished") ||
                   choice.finish_reason === "stop";

  // Try to extract actions from response
  let actions: OpenAIAction[] = [];

  // Look for JSON action objects in the response
  const jsonMatches = content.match(/\{[^}]+\}/g);
  if (jsonMatches) {
    for (const match of jsonMatches) {
      try {
        const parsed = JSON.parse(match);
        if (parsed.type) {
          actions.push(parsed);
        }
      } catch {
        // Not valid JSON, skip
      }
    }
  }

  return {
    actions,
    response: content,
    finished: finished && actions.length === 0,
  };
}

// Main browser automation loop
async function runBrowserAgent(options: BrowserAgentOptions): Promise<TaskResult> {
  const startTime = Date.now();
  const actionLogs: ActionLog[] = [];
  const screenshots: string[] = [];
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let stepNumber = 0;
  let conversationHistory: any[] = [];

  try {
    log(`Starting Browser Agent`);
    log(`Task: "${options.task}"`);
    log(`Session ID: ${SESSION_ID}`);
    log(`Max Steps: ${options.maxSteps}, Timeout: ${options.timeout}s`);

    // Launch browser
    log("Launching browser...");
    browser = await chromium.launch({
      headless: options.headless,
      args: ["--disable-blink-features=AutomationControlled"],
    });

    // Create context with viewport
    const contextOptions: any = {
      viewport: options.viewport,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };

    // Load cookies if provided
    if (options.cookies && existsSync(options.cookies)) {
      log(`Loading cookies from: ${options.cookies}`);
      const cookiesData = JSON.parse(readFileSync(options.cookies, "utf-8"));
      contextOptions.storageState = {
        cookies: cookiesData,
        origins: [],
      };
    }

    context = await browser.newContext(contextOptions);
    page = await context.newPage();

    // Navigate to starting URL if provided
    if (options.url) {
      if (!isUrlAllowed(options.url, options.allowlist, options.blocklist)) {
        throw new Error(`Starting URL blocked by restrictions: ${options.url}`);
      }
      log(`Navigating to starting URL: ${options.url}`);
      await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    } else {
      // Start with blank page
      await page.goto("about:blank");
    }

    // Main execution loop
    const timeoutMs = options.timeout * 1000;
    let isComplete = false;
    let lastResponse = "";

    while (stepNumber < options.maxSteps && !isComplete && Date.now() - startTime < timeoutMs) {
      stepNumber++;
      log(`\n--- Step ${stepNumber}/${options.maxSteps} ---`);

      // Take screenshot
      const screenshotPath = await takeScreenshot(page, stepNumber);
      screenshots.push(screenshotPath);
      if (options.verbose) {
        log(`Screenshot saved: ${screenshotPath}`, "debug");
      }

      // Get next action from OpenAI
      log("Analyzing page and determining next action...");
      const screenshotBase64 = await screenshotToBase64(screenshotPath);
      const { actions, response, finished } = await callOpenAI(
        options.task,
        screenshotBase64,
        conversationHistory,
        stepNumber
      );

      lastResponse = response;

      if (options.verbose) {
        log(`OpenAI Response: ${response}`, "debug");
      }

      // Add to conversation history
      conversationHistory.push({
        role: "assistant",
        content: response,
      });

      // Check if task is complete
      if (finished) {
        log("Task marked as complete by agent", "success");
        isComplete = true;
        break;
      }

      // Execute actions
      if (actions.length === 0) {
        log("No actions returned, asking for next step...");
        continue;
      }

      for (const action of actions) {
        const actionLog: ActionLog = {
          step: stepNumber,
          action: action.type,
          timestamp: new Date().toISOString(),
          details: action,
        };

        const success = await executeAction(page, action, options);
        actionLog.details = { ...action, success };
        actionLogs.push(actionLog);

        if (!success) {
          log(`Action failed, will retry on next step`, "error");
        }

        // Small delay between actions
        await page.waitForTimeout(300);
      }
    }

    // Determine final status
    let status: TaskResult["status"] = "completed";
    if (!isComplete) {
      if (Date.now() - startTime >= timeoutMs) {
        status = "timeout";
        log("Task timed out", "error");
      } else if (stepNumber >= options.maxSteps) {
        status = "max_steps_reached";
        log("Maximum steps reached", "error");
      }
    }

    // Extract data from final response
    let extractedData = null;
    try {
      // Try to find JSON in the response
      const jsonMatch = lastResponse.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[1]);
      }
    } catch {
      // No structured data, that's okay
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    const result: TaskResult = {
      task: options.task,
      status,
      steps: stepNumber,
      duration: `${duration}s`,
      result: {
        data: extractedData,
        summary: lastResponse,
      },
      screenshots: screenshots.map((s) => s.replace(EXPORTS_DIR + "/", "")),
      actions: actionLogs,
    };

    // Save output if requested
    if (options.output) {
      const outputPath = join(process.cwd(), options.output);
      writeFileSync(outputPath, JSON.stringify(result, null, 2));
      log(`Results saved to: ${outputPath}`, "success");
    }

    return result;
  } catch (error) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    log(`Fatal error: ${errorMessage}`, "error");

    return {
      task: options.task,
      status: "failed",
      steps: stepNumber,
      duration: `${duration}s`,
      result: {
        summary: `Task failed: ${errorMessage}`,
      },
      screenshots: screenshots.map((s) => s.replace(EXPORTS_DIR + "/", "")),
      actions: actionLogs,
      error: errorMessage,
    };
  } finally {
    // Cleanup
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

// Main function
async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      url: { type: "string" },
      headless: { type: "string", default: "true" },
      timeout: { type: "string", default: "300" },
      "max-steps": { type: "string", default: "50" },
      viewport: { type: "string", default: "1280x720" },
      "save-screenshots": { type: "string", default: "true" },
      output: { type: "string", short: "o" },
      cookies: { type: "string" },
      allowlist: { type: "string" },
      blocklist: { type: "string" },
      verbose: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  // Show help
  if (values.help || positionals.length === 0) {
    console.log(`
Browser Agent - Autonomous web browsing with OpenAI Computer Use

Usage:
  skills run browser-agent -- <task> [options]

Options:
  --url <url>              Starting URL (optional)
  --headless <bool>        Run in headless mode [default: true]
  --timeout <seconds>      Max execution time [default: 300]
  --max-steps <number>     Maximum actions [default: 50]
  --viewport <WxH>         Browser size [default: 1280x720]
  --save-screenshots       Save all screenshots [default: true]
  --output, -o <file>      Save results to JSON file
  --cookies <file>         Load cookies from JSON file
  --allowlist <domains>    Comma-separated allowed domains
  --blocklist <domains>    Comma-separated blocked domains
  --verbose, -v            Show detailed logs
  --help, -h               Show this help

Examples:
  skills run browser-agent -- "Find top 5 GitHub trending repos"
  skills run browser-agent -- "Search for laptops" --url https://amazon.com
  skills run browser-agent -- "Extract news titles" --output news.json
  skills run browser-agent -- "Check email count" --cookies gmail.json --verbose
`);
    process.exit(0);
  }

  const task = positionals.join(" ");

  if (!task) {
    log("Please provide a task description", "error");
    process.exit(1);
  }

  // Parse viewport
  const viewportParts = (values.viewport as string).split("x");
  const viewport = {
    width: parseInt(viewportParts[0]) || 1280,
    height: parseInt(viewportParts[1]) || 720,
  };

  const options: BrowserAgentOptions = {
    task,
    url: values.url as string,
    headless: values.headless === "true",
    timeout: parseInt(values.timeout as string) || 300,
    maxSteps: parseInt(values["max-steps"] as string) || 50,
    viewport,
    saveScreenshots: values["save-screenshots"] === "true",
    output: values.output as string,
    cookies: values.cookies as string,
    allowlist: values.allowlist ? (values.allowlist as string).split(",").map((d) => d.trim()) : undefined,
    blocklist: values.blocklist ? (values.blocklist as string).split(",").map((d) => d.trim()) : undefined,
    verbose: values.verbose || false,
  };

  try {
    const result = await runBrowserAgent(options);

    console.log("\n" + "=".repeat(60));
    console.log("BROWSER AGENT RESULTS");
    console.log("=".repeat(60));
    console.log(`Status: ${result.status}`);
    console.log(`Steps: ${result.steps}`);
    console.log(`Duration: ${result.duration}`);
    console.log(`\nSummary:\n${result.result.summary}`);

    if (result.result.data) {
      console.log(`\nExtracted Data:`);
      console.log(JSON.stringify(result.result.data, null, 2));
    }

    console.log(`\nScreenshots: ${EXPORTS_DIR}`);
    console.log(`Logs: ${join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`)}`);

    if (result.status !== "completed") {
      process.exit(1);
    }
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    process.exit(1);
  }
}

main();
