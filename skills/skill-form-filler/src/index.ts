#!/usr/bin/env bun
import puppeteer from "puppeteer";
import { join } from "path";

const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
  console.log(`
skill-form-filler - Automate web form filling with Puppeteer

Usage:
  skills run form-filler -- url=<url> data=<json> [options]

Options:
  -h, --help                 Show this help message
  url=<url>                  URL of the page containing the form (required)
  data=<json>                JSON mapping CSS selectors to values (required)
  submitSelector=<selector>  CSS selector for submit button

Data Format:
  Provide a JSON object where keys are CSS selectors and values are text to type.
  Example: '{"#email": "user@example.com", "#password": "secret123"}'

Examples:
  skills run form-filler -- url="https://example.com/login" data='{"#username": "john", "#password": "pass123"}'
  skills run form-filler -- url="https://example.com/contact" data='{"#name": "John", "#message": "Hello"}' submitSelector="button[type=submit]"
`);
  process.exit(0);
}

const urlArg = args.find(a => a.startsWith("url="))?.split("=")[1];
const dataArg = args.find(a => a.startsWith("data="))?.split("=")[1];
const submitSelectorArg = args.find(a => a.startsWith("submitSelector="))?.split("=")[1];

async function main() {
  if (!urlArg || !dataArg) {
    console.log("Usage: skills run form-filler -- url=... data='{\"selector\": \"value\"}' [submitSelector=...]");
    process.exit(1);
  }

  let formData: Record<string, string>;
  try {
    formData = JSON.parse(dataArg);
  } catch {
    console.error("Error: data must be valid JSON");
    process.exit(1);
  }

  console.log(`Navigating to ${urlArg}...`);
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  try {
    await page.goto(urlArg, { waitUntil: "networkidle0" });

    for (const [selector, value] of Object.entries(formData)) {
      console.log(`Filling ${selector} with "${value}"`);
      await page.type(selector, value);
    }

    if (submitSelectorArg) {
      console.log(`Clicking ${submitSelectorArg}...`);
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}), // Wait for nav if it happens
        page.click(submitSelectorArg),
      ]);
    }

    const outputDir = process.env.SKILLS_EXPORTS_DIR || ".";
    const screenshotPath = join(outputDir, "form-submission.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot saved to ${screenshotPath}`);

  } catch (error: any) {
    console.error("Browser Error:", error.message);
  } finally {
    await browser.close();
  }
}

main();
