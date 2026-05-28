import { existsSync, readFileSync } from "fs";
import { log } from "./runtime";

// Generate slug from text
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

// Detect source type
export function detectSourceType(source: string): "url" | "file" | "text" {
  // Check if it's a URL
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return "url";
  }

  // Check if it's a file path
  if (existsSync(source)) {
    return "file";
  }

  // Otherwise it's direct text
  return "text";
}

// Extract content from URL
async function extractFromURL(url: string): Promise<string> {
  log(`Fetching content from URL: ${url}`);

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.statusText}`);
    }

    const html = await response.text();

    // Basic HTML to text conversion
    // Remove script and style tags
    let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, " ");

    // Decode HTML entities
    text = text.replace(/&nbsp;/g, " ");
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&apos;/g, "'");
    text = text.replace(/&amp;/g, "&");
    text = text.replace(/&lt;/g, "<");
    text = text.replace(/&gt;/g, ">");

    // Clean up whitespace
    text = text.replace(/\s+/g, " ").trim();

    log(`Extracted ${text.length} characters from URL`, "success");
    return text;
  } catch (error) {
    throw new Error(`Failed to extract content from URL: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

// Extract content from file
function extractFromFile(filePath: string): string {
  log(`Reading content from file: ${filePath}`);

  try {
    const content = readFileSync(filePath, "utf-8");

    // If it's markdown, do some basic cleanup
    let text = content;

    if (filePath.endsWith(".md") || filePath.endsWith(".markdown")) {
      // Remove markdown syntax for cleaner processing
      text = text.replace(/^#{1,6}\s+/gm, ""); // Headers
      text = text.replace(/\*\*(.+?)\*\*/g, "$1"); // Bold
      text = text.replace(/\*(.+?)\*/g, "$1"); // Italic
      text = text.replace(/\[(.+?)\]\(.+?\)/g, "$1"); // Links
      text = text.replace(/`{1,3}[^`]+`{1,3}/g, ""); // Code blocks
    }

    // Clean up whitespace
    text = text.replace(/\s+/g, " ").trim();

    log(`Extracted ${text.length} characters from file`, "success");
    return text;
  } catch (error) {
    throw new Error(`Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

// Get content based on source type
export async function getContent(source: string, sourceType: "url" | "file" | "text", maxLength: number): Promise<string> {
  let content: string;

  if (sourceType === "url") {
    content = await extractFromURL(source);
  } else if (sourceType === "file") {
    content = extractFromFile(source);
  } else {
    content = source;
  }

  // Truncate if too long
  if (content.length > maxLength) {
    log(`Content truncated from ${content.length} to ${maxLength} characters`);
    content = content.slice(0, maxLength);
  }

  return content;
}
