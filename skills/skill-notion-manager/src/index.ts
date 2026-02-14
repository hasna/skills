#!/usr/bin/env bun
import { Client } from "@notionhq/client";

const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
  console.log(`
skill-notion-manager - Manage Notion pages and databases

Usage:
  skills run notion-manager -- action=<action> [options]

Options:
  -h, --help               Show this help message
  action=<action>          Action to perform (required):
                           - search: Search for pages and databases
                           - read-page: Read a specific page
                           - create-page: Create a new page
  query=<text>             Search query (for search action)
  pageId=<id>              Page ID (required for read-page)
  parentId=<id>            Parent page ID (required for create-page)
  title=<text>             Page title (required for create-page)

Examples:
  skills run notion-manager -- action=search query="meeting notes"
  skills run notion-manager -- action=read-page pageId=abc123...
  skills run notion-manager -- action=create-page parentId=xyz789... title="New Document"

Requirements:
  Requires Notion connector to be connected in skills.md.
`);
  process.exit(0);
}

const actionArg = args.find(a => a.startsWith("action="))?.split("=")[1];
const queryArg = args.find(a => a.startsWith("query="))?.split("=")[1];
const pageIdArg = args.find(a => a.startsWith("pageId="))?.split("=")[1];
const parentIdArg = args.find(a => a.startsWith("parentId="))?.split("=")[1];
const titleArg = args.find(a => a.startsWith("title="))?.split("=")[1];

if (!process.env.NOTION_ACCESS_TOKEN) {
  console.error("Error: Notion connector not connected. Please connect Notion in skills.md.");
  process.exit(1);
}

const notion = new Client({
  auth: process.env.NOTION_ACCESS_TOKEN,
});

async function main() {
  try {
    switch (actionArg) {
      case "search":
        const searchResponse = await notion.search({
          query: queryArg,
          page_size: 10,
        });
        console.log(JSON.stringify(searchResponse.results.map((r: any) => ({
          id: r.id,
          object: r.object,
          title: r.properties?.title?.title?.[0]?.plain_text || r.properties?.Name?.title?.[0]?.plain_text || "Untitled",
          url: r.url
        })), null, 2));
        break;

      case "read-page":
        if (!pageIdArg) {
          console.error("Error: pageId is required for read-page");
          process.exit(1);
        }
        const page = await notion.pages.retrieve({ page_id: pageIdArg });
        // For content, we'd need blocks.children.list, but let's just return metadata for now
        console.log(JSON.stringify(page, null, 2));
        break;

      case "create-page":
        if (!parentIdArg || !titleArg) {
          console.error("Error: parentId and title are required for create-page");
          process.exit(1);
        }
        const newPage = await notion.pages.create({
          parent: { page_id: parentIdArg },
          properties: {
            title: [
              {
                text: {
                  content: titleArg,
                },
              },
            ],
          },
        });
        console.log(JSON.stringify(newPage, null, 2));
        break;

      default:
        console.log("Usage: skills run notion-manager -- action=<search|read-page|create-page> [query=...] [pageId=...] [parentId=...] [title=...]");
    }
  } catch (error: any) {
    console.error("Notion API Error:", error.message);
    process.exit(1);
  }
}

main();
