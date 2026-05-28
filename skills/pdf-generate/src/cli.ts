import { existsSync, readFileSync } from "node:fs";
import { log, SKILLS_INPUT } from "./runtime";
import { templates } from "./templates";
import { PAGE_FORMATS, type GenerateOptions } from "./types";

export function parseArgs(args: string[]): GenerateOptions {
  const options: GenerateOptions = {
    contentType: "markdown",
    format: "A4",
    orientation: "portrait",
    margin: { top: "1cm", right: "1cm", bottom: "1cm", left: "1cm" },
    displayHeaderFooter: false,
    printBackground: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "-h":
      case "--help":
        console.log(`
pdf-generate - Generate high-quality PDF documents

Usage:
  skills run generate-pdf -- [options]

Options:
  -h, --help               Show this help message
  --content <text>         Content to convert (markdown, HTML, or text)
  --content-type <type>    Content type: markdown | html | text (default: markdown)
  --file <path>            Read content from file
  --template <name>        Use built-in template: invoice | report | resume | letter | contract
  --data <json>            JSON data for template variables
  --url <url>              Generate PDF from URL
  --format <size>          Page format: A4 | Letter | Legal | A3 | A5 | Tabloid (default: A4)
  --orientation <type>     Page orientation: portrait | landscape (default: portrait)
  --title <text>           Document title
  --author <text>          Document author
  --filename <name>        Output filename (without extension)
  --css <styles>           Custom CSS styles
  --header <html>          Header HTML
  --footer <html>          Footer HTML

Templates:
  invoice                  Professional invoice template
  report                   Business report template
  resume                   Resume/CV template
  letter                   Formal letter template
  contract                 Contract/agreement template

Examples:
  # Generate PDF from markdown
  skills run generate-pdf -- --content "# Hello World" --filename report

  # Use a template with data
  skills run generate-pdf -- --template invoice --data '{"clientName":"Acme Corp","total":"$1000"}'

  # Convert a file
  skills run generate-pdf -- --file ./README.md --format Letter
`);
        process.exit(0);
      case "--content":
        if (nextArg) {
          options.content = nextArg;
          i++;
        }
        break;
      case "--content-type":
        if (nextArg && ["markdown", "html", "text"].includes(nextArg)) {
          options.contentType = nextArg as "markdown" | "html" | "text";
          i++;
        }
        break;
      case "--format":
        if (nextArg && PAGE_FORMATS[nextArg]) {
          options.format = nextArg;
          i++;
        }
        break;
      case "--orientation":
        if (nextArg && ["portrait", "landscape"].includes(nextArg)) {
          options.orientation = nextArg as "portrait" | "landscape";
          i++;
        }
        break;
      case "--title":
        if (nextArg) {
          options.title = nextArg;
          i++;
        }
        break;
      case "--author":
        if (nextArg) {
          options.author = nextArg;
          i++;
        }
        break;
      case "--filename":
        if (nextArg) {
          options.filename = nextArg;
          i++;
        }
        break;
      case "--template":
        if (nextArg && templates[nextArg]) {
          options.template = nextArg;
          i++;
        }
        break;
      case "--data":
        if (nextArg) {
          try {
            options.data = JSON.parse(nextArg);
          } catch {
            log(`Invalid JSON data: ${nextArg}`, "warn");
          }
          i++;
        }
        break;
      case "--url":
        if (nextArg) {
          options.url = nextArg;
          i++;
        }
        break;
      case "--file":
        if (nextArg && existsSync(nextArg)) {
          options.content = readFileSync(nextArg, "utf-8");
          i++;
        }
        break;
      case "--css":
        if (nextArg) {
          options.css = nextArg;
          i++;
        }
        break;
      case "--header":
        if (nextArg) {
          options.header = nextArg;
          options.displayHeaderFooter = true;
          i++;
        }
        break;
      case "--footer":
        if (nextArg) {
          options.footer = nextArg;
          options.displayHeaderFooter = true;
          i++;
        }
        break;
    }
  }

  if (!options.content && !options.template && !options.url && SKILLS_INPUT) {
    options.content = SKILLS_INPUT;
  }

  return options;
}
