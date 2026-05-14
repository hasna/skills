import { join } from "path";

import { EXPORTS_DIR } from "./logger";
import type { OutputFormat } from "./types";

export function formatJSON(data: any[]): string {
  return JSON.stringify(data, null, 2);
}

// Format data as CSV
export function formatCSV(data: any[]): string {
  if (data.length === 0) return "";

  const headers = Object.keys(data[0]);
  const rows = data.map(record =>
    headers.map(header => {
      const value = record[header];
      // Escape quotes and wrap in quotes if contains comma or quote
      if (typeof value === "string" && (value.includes(",") || value.includes('"') || value.includes("\n"))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    }).join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

// Format data as SQL INSERT statements
export function formatSQL(data: any[], tableName: string): string {
  if (data.length === 0) return "";

  const fields = Object.keys(data[0]);
  const fieldList = fields.join(", ");

  const values = data.map(record =>
    `(${fields.map(field => {
      const value = record[field];
      if (value === null || value === undefined) {
        return "NULL";
      }
      if (typeof value === "string") {
        return `'${value.replace(/'/g, "''")}'`;
      }
      if (typeof value === "boolean") {
        return value ? "TRUE" : "FALSE";
      }
      return value;
    }).join(", ")})`
  );

  return `INSERT INTO ${tableName} (${fieldList}) VALUES\n${values.join(",\n")};`;
}

// Format data as TypeScript
export function formatTypeScript(data: any[]): string {
  if (data.length === 0) return "";

  // Generate interface from first record
  const sample = data[0];
  const interfaceFields = Object.entries(sample)
    .map(([key, value]) => {
      let type: string = typeof value;
      if (type === "object" && value === null) {
        type = "any";
      }
      return `  ${key}: ${type};`;
    })
    .join("\n");

  const interfaceCode = `interface MockData {\n${interfaceFields}\n}`;
  const dataCode = `export const mockData: MockData[] = ${JSON.stringify(data, null, 2)};`;

  return `${interfaceCode}\n\n${dataCode}`;
}

// Generate output filename
export function generateOutputFilename(format: OutputFormat): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "_").replace(/-/g, "_").slice(0, 19).toLowerCase();
  const extension = format === "typescript" ? "ts" : format;
  return join(EXPORTS_DIR, `mock_data_${timestamp}.${extension}`);
}

// Main function
