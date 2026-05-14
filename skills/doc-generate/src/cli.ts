import type { CliResult, DocOptions } from "./types";

const HELP = `
Generate DOCX - Create Word documents from markdown or AI

Usage:
  skills run generate-docx -- <markdown-file> [options]
  skills run generate-docx -- --topic "Topic" [options]
  skills run generate-docx -- --prompt "Prompt" [options]

Input Options:
  <file>              Input markdown file
  --topic <text>      Topic for AI to write about
  --prompt <text>     Direct prompt for AI generation
  --text <text>       Plain text content

AI Options:
  --sections <n>      Number of sections (default: 5)
  --style <type>      Style: professional, casual, formal, academic
  --tone <type>       Tone: neutral, friendly, authoritative
  --length <type>     Length: short, medium, long, comprehensive

Output Options:
  -o, --output <path> Output file path
  --dir <path>        Output directory (default: .skills/exports)

Template Options:
  --template <name>   Template: default, report, letter, memo, resume, article
  --title <text>      Document title
  --author <text>     Author name
  --company <text>    Company name
  --date <text>       Document date

Styling Options:
  --font <name>       Font family (default: Calibri)
  --font-size <pt>    Base font size (default: 11)
  --heading-font      Heading font (default: Calibri Light)
  --line-spacing <n>  Line spacing (default: 1.15)
  --margins <inches>  Page margins (default: 1)
  --page-size <size>  Page size: letter, a4, legal

Content Options:
  --toc               Include table of contents
  --page-numbers      Include page numbers (default: true)
  --header <text>     Header text
  --footer <text>     Footer text

Examples:
  skills run generate-docx -- document.md -o output.docx
  skills run generate-docx -- --topic "Business Plan" --template report -o plan.docx
  skills run generate-docx -- --prompt "Write a cover letter" --template letter
`;

type ParsedArgs = Record<string, string | number | boolean | undefined> & { _: string[] };

const BOOLEAN_FLAGS = new Set(["toc", "page-numbers", "help"]);
const ALIASES: Record<string, string> = {
  h: "help",
  o: "output",
};

const DEFAULT_ARGS: Omit<ParsedArgs, "_"> = {
  dir: ".skills/exports",
  template: "default",
  font: "Calibri",
  "font-size": 11,
  "heading-font": "Calibri Light",
  "line-spacing": 1.15,
  margins: 1,
  "page-size": "letter",
  "page-numbers": true,
  sections: 5,
  style: "professional",
  tone: "neutral",
  length: "medium",
  toc: false,
};

function normalizeFlag(flag: string): string {
  return ALIASES[flag] ?? flag;
}

function parseBoolean(value: string | undefined): boolean {
  if (value === undefined) return true;
  if (/^(false|0|no)$/i.test(value)) return false;
  if (/^(true|1|yes)$/i.test(value)) return true;
  return Boolean(value);
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { ...DEFAULT_ARGS, _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--") {
      args._.push(...argv.slice(index + 1));
      break;
    }

    if (token.startsWith("--no-")) {
      args[normalizeFlag(token.slice(5))] = false;
      continue;
    }

    if (token.startsWith("--")) {
      const [rawFlag, inlineValue] = token.slice(2).split(/=(.*)/s, 2);
      const flag = normalizeFlag(rawFlag);

      if (BOOLEAN_FLAGS.has(flag)) {
        args[flag] = parseBoolean(inlineValue);
        continue;
      }

      if (inlineValue !== undefined) {
        args[flag] = inlineValue;
        continue;
      }

      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("-")) {
        args[flag] = next;
        index += 1;
      } else {
        args[flag] = "";
      }
      continue;
    }

    if (token.startsWith("-") && token !== "-") {
      const shortFlags = token.slice(1);
      const firstFlag = normalizeFlag(shortFlags[0]);

      if (shortFlags.length === 1 && !BOOLEAN_FLAGS.has(firstFlag)) {
        const next = argv[index + 1];
        args[firstFlag] = next ?? "";
        if (next !== undefined) index += 1;
        continue;
      }

      for (const shortFlag of shortFlags) {
        args[normalizeFlag(shortFlag)] = true;
      }
      continue;
    }

    args._.push(token);
  }

  return args;
}

function stringArg(args: ParsedArgs, name: string, fallback = ""): string {
  const value = args[name];
  if (value === undefined || value === false) return fallback;
  return String(value);
}

function numberArg(args: ParsedArgs, name: string, fallback: number): number {
  const value = Number(args[name]);
  return Number.isFinite(value) ? value : fallback;
}

export function parseCli(argv = process.argv.slice(2)): CliResult {
  const args = parseArgs(argv);

  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  const options: DocOptions = {
    output: stringArg(args, "output"),
    dir: stringArg(args, "dir", ".skills/exports"),
    template: stringArg(args, "template", "default") as DocOptions["template"],
    title: stringArg(args, "title"),
    author: stringArg(args, "author"),
    company: stringArg(args, "company"),
    date: stringArg(args, "date", new Date().toLocaleDateString()),
    font: stringArg(args, "font", "Calibri"),
    fontSize: numberArg(args, "font-size", 11),
    headingFont: stringArg(args, "heading-font", "Calibri Light"),
    lineSpacing: numberArg(args, "line-spacing", 1.15),
    margins: numberArg(args, "margins", 1),
    pageSize: stringArg(args, "page-size", "letter") as DocOptions["pageSize"],
    toc: Boolean(args.toc),
    pageNumbers: Boolean(args["page-numbers"]),
    header: stringArg(args, "header"),
    footer: stringArg(args, "footer"),
    topic: stringArg(args, "topic") || null,
    prompt: stringArg(args, "prompt") || null,
    text: stringArg(args, "text") || null,
    sections: numberArg(args, "sections", 5),
    style: stringArg(args, "style", "professional") as DocOptions["style"],
    tone: stringArg(args, "tone", "neutral") as DocOptions["tone"],
    length: stringArg(args, "length", "medium") as DocOptions["length"],
  };

  return {
    options,
    inputFile: args._[0] as string | undefined,
  };
}
