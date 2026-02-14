#!/usr/bin/env bun
import { readFile, writeFile } from "fs/promises";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
  console.log(`
skill-csv-transformer - Transform and filter CSV data

Usage:
  skills run csv-transformer -- input=<file> output=<file> [options]

Options:
  -h, --help           Show this help message
  input=<file>         Input CSV file path (required)
  output=<file>        Output file path (required)
  format=<fmt>         Output format: csv | json (default: csv)
  columns=<cols>       Comma-separated columns to include
  filter=<col=val>     Filter rows where column equals value

Examples:
  skills run csv-transformer -- input=data.csv output=out.csv
  skills run csv-transformer -- input=data.csv output=out.json format=json
  skills run csv-transformer -- input=data.csv output=out.csv columns=name,email
  skills run csv-transformer -- input=data.csv output=out.csv filter=status=active
`);
  process.exit(0);
}

const inputArg = args.find(a => a.startsWith("input="))?.split("=")[1];
const outputArg = args.find(a => a.startsWith("output="))?.split("=")[1];
const formatArg = args.find(a => a.startsWith("format="))?.split("=")[1] || "csv";
const columnsArg = args.find(a => a.startsWith("columns="))?.split("=")[1];
const filterArg = args.find(a => a.startsWith("filter="))?.split("=")[1];

async function main() {
  if (!inputArg || !outputArg) {
    console.log("Usage: skills run csv-transformer -- input=... output=... [format=json|csv] [columns=col1,col2] [filter=col=val]");
    process.exit(1);
  }

  try {
    const content = await readFile(inputArg, "utf-8");
    let records = parse(content, { columns: true, skip_empty_lines: true });

    // Filter
    if (filterArg) {
      const [key, value] = filterArg.split("=");
      records = records.filter((r: any) => r[key] === value);
    }

    // Select Columns
    if (columnsArg) {
      const cols = columnsArg.split(",");
      records = records.map((r: any) => {
        const newR: any = {};
        cols.forEach(c => newR[c] = r[c]);
        return newR;
      });
    }

    // Output
    let outputContent = "";
    if (formatArg === "json") {
      outputContent = JSON.stringify(records, null, 2);
    } else {
      outputContent = stringify(records, { header: true });
    }

    await writeFile(outputArg, outputContent);
    console.log(`Transformed data saved to ${outputArg}`);

  } catch (error: any) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
