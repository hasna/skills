#!/usr/bin/env bun
import { parseArgs } from "util";
import { readFileSync, existsSync } from "fs";
import { parse } from "csv-parse/sync";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    caption: { type: "string" },
    label: { type: "string" },
    align: { type: "string" }, // e.g., "lcr"
    help: { type: "boolean" },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.log(`
LaTeX Table Generator
Usage: skills run latex-table-generator -- <file> [options]

Options:
  --caption <text>   Table caption
  --label <text>     Table label (e.g., tab:results)
  --align <str>      Column alignment (e.g., "l|c|r")
`);
  process.exit(0);
}

const filePath = positionals[0];

if (!existsSync(filePath)) {
  console.error(`Error: File not found: ${filePath}`);
  process.exit(1);
}

try {
  const content = readFileSync(filePath, "utf-8");
  let data: string[][] = [];

  if (filePath.endsWith(".json")) {
    const json = JSON.parse(content);
    if (Array.isArray(json)) {
      // Assume array of objects or array of arrays
      if (json.length > 0) {
        if (Array.isArray(json[0])) {
          data = json;
        } else if (typeof json[0] === "object") {
          const headers = Object.keys(json[0]);
          data = [headers, ...json.map((row: any) => headers.map(h => String(row[h] ?? "")))]
        }
      }
    }
  } else {
    // Assume CSV
    data = parse(content, {
      skip_empty_lines: true,
      relax_column_count: true,
    });
  }

  if (data.length === 0) {
    console.error("Error: No data found in file.");
    process.exit(1);
  }

  const numCols = data[0].length;
  const align = values.align || "l".repeat(numCols);
  const caption = values.caption || "Table Caption";
  const label = values.label || `tab:${filePath.split("/").pop()?.replace(".", "_")}`;

  let latex = `\begin{table}[h]
  \centering
  \caption{${caption}}
  \label{${label}}
  \begin{tabular}{${align}}
    \hline
`;

  // Header
  latex += `    ${data[0].map(escapeLatex).join(" & ")} \\ 
    \hline
`;

  // Body
  for (let i = 1; i < data.length; i++) {
    latex += `    ${data[i].map(escapeLatex).join(" & ")} \\ 
`;
  }

  latex += `    \hline
  \end{tabular}
\end{table}`;

  console.log(latex);

} catch (error) {
  console.error("Error processing file:", error);
  process.exit(1);
}

function escapeLatex(str: string): string {
  return String(str)
    .replace(/&/g, "\\&")
    .replace(/%/g, "\\%")
    .replace(/\$/g, "\\$")
    .replace(/#/g, "\\#")
    .replace(/_/g, "\\_")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/~/g, "\\textasciitilde")
    .replace(/\^/g, "\\textasciicircum");
}