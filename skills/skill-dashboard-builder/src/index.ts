#!/usr/bin/env bun
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { parse } from "csv-parse/sync";

// =============================================================================
// Security: HTML Escaping to prevent XSS
// =============================================================================

/**
 * Escape HTML special characters to prevent XSS attacks
 */
function escapeHtml(str: string | undefined | null): string {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Escape a string for safe use in JavaScript context (inside single quotes)
 */
function escapeJsString(str: string | undefined | null): string {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/<\/script>/gi, "<\\/script>");
}

const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
  console.log(`
skill-dashboard-builder - Generate interactive HTML dashboards from data

Usage:
  skills run dashboard-builder -- file=<path> [options]

Options:
  -h, --help           Show this help message
  file=<path>          Input data file (.csv or .json) (required)
  title=<text>         Dashboard title (default: Dashboard)

Examples:
  skills run dashboard-builder -- file=sales.csv
  skills run dashboard-builder -- file=metrics.json title="Monthly Report"
`);
  process.exit(0);
}

const fileArg = args.find(a => a.startsWith("file="))?.split("=")[1];
const titleArg = args.find(a => a.startsWith("title="))?.split("=")[1] || "Dashboard";

async function main() {
  if (!fileArg) {
    console.log("Usage: skills run dashboard-builder -- file=<path> [title=...]");
    process.exit(1);
  }

  try {
    const content = await readFile(fileArg, "utf-8");
    let data: any[] = [];

    if (fileArg.endsWith(".json")) {
      data = JSON.parse(content);
    } else if (fileArg.endsWith(".csv")) {
      data = parse(content, { columns: true, skip_empty_lines: true });
    } else {
      throw new Error("Unsupported file format. Use .csv or .json");
    }

    if (data.length === 0) throw new Error("No data found");

    // Analyze columns
    const keys = Object.keys(data[0]);
    const numericKeys = keys.filter(k => !isNaN(Number(data[0][k])));
    const categoryKeys = keys.filter(k => isNaN(Number(data[0][k])));

    const labelKey = categoryKeys[0] || keys[0];
    const valueKey = numericKeys[0] || keys[1];

    const labels = data.map(d => d[labelKey]);
    const values = data.map(d => Number(d[valueKey]));

    // Sanitize labels for safe JSON embedding (strip script tags etc)
    const sanitizedLabels = labels.map((l: string) => String(l).replace(/<[^>]*>/g, ""));

    // Generate HTML with proper escaping
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>${escapeHtml(titleArg)}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: sans-serif; padding: 20px; background: #f4f4f9; }
    .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { text-align: center; color: #333; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${escapeHtml(titleArg)}</h1>
    <canvas id="myChart"></canvas>
  </div>
  <script>
    const ctx = document.getElementById('myChart');
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(sanitizedLabels)},
        datasets: [{
          label: '${escapeJsString(valueKey)}',
          data: ${JSON.stringify(values)},
          backgroundColor: 'rgba(54, 162, 235, 0.5)',
          borderColor: 'rgba(54, 162, 235, 1)',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  </script>
</body>
</html>
    `;

    const outputDir = process.env.SKILLS_EXPORTS_DIR || ".";
    const outputPath = join(outputDir, "dashboard.html");
    await writeFile(outputPath, html);
    console.log(`Dashboard generated: ${outputPath}`);

  } catch (error: any) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
