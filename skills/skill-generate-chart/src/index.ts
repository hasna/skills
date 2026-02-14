#!/usr/bin/env bun

/**
 * Chart Generator Skill
 *
 * Generates charts from data with support for multiple formats and customization options.
 * Uses Chart.js with node-canvas for server-side rendering.
 */

import { parseArgs } from "util";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname, extname } from "path";
import { mkdirSync } from "fs";

// Types
interface SimpleDataPoint {
  label: string;
  value: number;
}

interface ScatterDataPoint {
  x: number;
  y: number;
}

interface Dataset {
  label: string;
  data: number[];
  backgroundColor?: string | string[];
  borderColor?: string | string[];
}

interface MultiDatasetFormat {
  labels: string[];
  datasets: Dataset[];
}

type ChartType = "bar" | "line" | "pie" | "doughnut" | "area" | "scatter";
type OutputFormat = "png" | "svg" | "pdf";
type Theme = "default" | "dark" | "minimal" | "colorful";
type LegendPosition = "top" | "bottom" | "left" | "right" | "none";

interface ChartOptions {
  type: ChartType;
  data?: string;
  file?: string;
  output: string;
  title?: string;
  width?: number;
  height?: number;
  colors?: string;
  theme?: Theme;
  legend?: LegendPosition;
  xLabel?: string;
  yLabel?: string;
  stacked?: boolean;
  smooth?: boolean;
}

// Color schemes
const THEME_COLORS = {
  default: [
    "#FF6384", "#36A2EB", "#FFCE56", "#4BC0C0", "#9966FF",
    "#FF9F40", "#FF6384", "#C9CBCF"
  ],
  dark: [
    "#FF6B9D", "#4ECDC4", "#FFE66D", "#A8E6CF", "#C7CEEA",
    "#FFDAC1", "#FF8B94", "#B4A7D6"
  ],
  minimal: [
    "#2C3E50", "#34495E", "#7F8C8D", "#95A5A6", "#BDC3C7",
    "#D5DBDB", "#E8EAED", "#F0F3F4"
  ],
  colorful: [
    "#E74C3C", "#3498DB", "#F39C12", "#2ECC71", "#9B59B6",
    "#1ABC9C", "#E67E22", "#34495E"
  ]
};

const THEME_BACKGROUND = {
  default: "#FFFFFF",
  dark: "#1A1A2E",
  minimal: "#F8F9FA",
  colorful: "#FFFFFF"
};

const THEME_TEXT_COLOR = {
  default: "#666666",
  dark: "#E0E0E0",
  minimal: "#212529",
  colorful: "#2C3E50"
};

// Parse command line arguments
function parseArguments(): ChartOptions {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h" },
      type: { type: "string" },
      data: { type: "string" },
      file: { type: "string" },
      output: { type: "string" },
      title: { type: "string" },
      width: { type: "string" },
      height: { type: "string" },
      colors: { type: "string" },
      theme: { type: "string" },
      legend: { type: "string" },
      "x-label": { type: "string" },
      "y-label": { type: "string" },
      stacked: { type: "boolean", default: false },
      smooth: { type: "boolean", default: false },
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
skill-generate-chart - Generate charts from data files

Usage:
  skills run generate-chart -- --type <type> --output <file> [options]

Required Options:
  --type <type>        Chart type: bar | line | pie | doughnut | area | scatter
  --output <file>      Output file path (.png, .svg, or .pdf)
  --data <json>        Inline JSON data
  --file <path>        Path to data file (.json or .csv)

Optional:
  -h, --help           Show this help message
  --title <text>       Chart title
  --width <px>         Chart width (default: 800)
  --height <px>        Chart height (default: 600)
  --colors <list>      Comma-separated color list
  --theme <name>       Theme: default | dark | minimal | colorful
  --legend <pos>       Legend position: top | bottom | left | right | none
  --x-label <text>     X-axis label
  --y-label <text>     Y-axis label
  --stacked            Enable stacked charts
  --smooth             Enable smooth curves for line charts

Examples:
  skills run generate-chart -- --type bar --file data.csv --output chart.png
  skills run generate-chart -- --type pie --data '[{"label":"A","value":10}]' --output pie.png
`);
    process.exit(0);
  }

  // Validate required options
  if (!values.type) {
    console.error("Error: --type is required");
    console.error("Valid types: bar, line, pie, doughnut, area, scatter");
    process.exit(1);
  }

  if (!values.output) {
    console.error("Error: --output is required");
    process.exit(1);
  }

  if (!values.data && !values.file) {
    console.error("Error: Either --data or --file is required");
    process.exit(1);
  }

  const validTypes: ChartType[] = ["bar", "line", "pie", "doughnut", "area", "scatter"];
  if (!validTypes.includes(values.type as ChartType)) {
    console.error(`Error: Invalid chart type "${values.type}"`);
    console.error(`Valid types: ${validTypes.join(", ")}`);
    process.exit(1);
  }

  return {
    type: values.type as ChartType,
    data: values.data,
    file: values.file,
    output: values.output,
    title: values.title,
    width: values.width ? parseInt(values.width) : 800,
    height: values.height ? parseInt(values.height) : 600,
    colors: values.colors,
    theme: (values.theme as Theme) || "default",
    legend: (values.legend as LegendPosition) || "top",
    xLabel: values["x-label"],
    yLabel: values["y-label"],
    stacked: values.stacked || false,
    smooth: values.smooth || false,
  };
}

// Load data from file
function loadDataFromFile(filePath: string): any {
  if (!existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const content = readFileSync(filePath, "utf-8");
  const ext = extname(filePath).toLowerCase();

  if (ext === ".json") {
    try {
      return JSON.parse(content);
    } catch (error) {
      console.error("Error: Invalid JSON file");
      process.exit(1);
    }
  } else if (ext === ".csv") {
    return parseCSV(content);
  } else {
    console.error("Error: Unsupported file format. Use .json or .csv");
    process.exit(1);
  }
}

// Parse CSV data
function parseCSV(content: string): SimpleDataPoint[] {
  const lines = content.trim().split("\n");
  if (lines.length < 2) {
    console.error("Error: CSV must have at least a header and one data row");
    process.exit(1);
  }

  const headers = lines[0].split(",").map(h => h.trim());
  const data: SimpleDataPoint[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map(v => v.trim());
    if (values.length >= 2) {
      data.push({
        label: values[0],
        value: parseFloat(values[1]) || 0
      });
    }
  }

  return data;
}

// Normalize data to Chart.js format
function normalizeData(rawData: any, chartType: ChartType, colors: string[], options: ChartOptions): any {
  // Check if it's multi-dataset format
  if (rawData.labels && rawData.datasets) {
    return normalizeMultiDataset(rawData, chartType, colors, options);
  }

  // Check if it's scatter format
  if (Array.isArray(rawData) && rawData.length > 0 && "x" in rawData[0] && "y" in rawData[0]) {
    return normalizeScatterData(rawData, colors);
  }

  // Simple format
  if (Array.isArray(rawData)) {
    return normalizeSimpleData(rawData, chartType, colors);
  }

  console.error("Error: Unsupported data format");
  process.exit(1);
}

function normalizeSimpleData(data: SimpleDataPoint[], chartType: ChartType, colors: string[]): any {
  const labels = data.map(d => d.label);
  const values = data.map(d => d.value);

  const isPieType = chartType === "pie" || chartType === "doughnut";

  return {
    labels,
    datasets: [{
      label: "Data",
      data: values,
      backgroundColor: isPieType ? colors : colors[0] + "CC",
      borderColor: isPieType ? colors.map(c => c) : colors[0],
      borderWidth: 2,
      tension: 0.4
    }]
  };
}

function normalizeMultiDataset(data: MultiDatasetFormat, chartType: ChartType, colors: string[], options: ChartOptions): any {
  const isPieType = chartType === "pie" || chartType === "doughnut";

  if (isPieType && data.datasets.length > 1) {
    console.warn("Warning: Pie/Doughnut charts typically use single dataset. Using first dataset only.");
  }

  const datasets = data.datasets.map((dataset, index) => {
    const color = colors[index % colors.length];
    return {
      label: dataset.label,
      data: dataset.data,
      backgroundColor: dataset.backgroundColor || (isPieType ? colors : color + "CC"),
      borderColor: dataset.borderColor || color,
      borderWidth: 2,
      tension: options.smooth ? 0.4 : 0.1,
      fill: chartType === "area"
    };
  });

  return {
    labels: data.labels,
    datasets
  };
}

function normalizeScatterData(data: ScatterDataPoint[], colors: string[]): any {
  return {
    datasets: [{
      label: "Data Points",
      data: data,
      backgroundColor: colors[0] + "CC",
      borderColor: colors[0],
      borderWidth: 2,
      pointRadius: 6,
      pointHoverRadius: 8
    }]
  };
}

// Get colors based on theme and custom colors
function getColors(options: ChartOptions): string[] {
  if (options.colors) {
    return options.colors.split(",").map(c => c.trim());
  }
  return THEME_COLORS[options.theme || "default"];
}

// Generate Chart.js configuration
function generateChartConfig(data: any, options: ChartOptions, colors: string[]): any {
  const theme = options.theme || "default";
  const chartType = options.type === "area" ? "line" : options.type;

  const config: any = {
    type: chartType,
    data: data,
    options: {
      responsive: false,
      plugins: {
        title: {
          display: !!options.title,
          text: options.title || "",
          color: THEME_TEXT_COLOR[theme],
          font: {
            size: 20,
            weight: "bold"
          },
          padding: 20
        },
        legend: {
          display: options.legend !== "none",
          position: options.legend === "none" ? "top" : options.legend,
          labels: {
            color: THEME_TEXT_COLOR[theme],
            font: {
              size: 12
            },
            padding: 15
          }
        }
      }
    }
  };

  // Add scales for non-pie charts
  if (!["pie", "doughnut"].includes(options.type)) {
    config.options.scales = {
      x: {
        display: true,
        title: {
          display: !!options.xLabel,
          text: options.xLabel || "",
          color: THEME_TEXT_COLOR[theme],
          font: {
            size: 14,
            weight: "bold"
          }
        },
        ticks: {
          color: THEME_TEXT_COLOR[theme]
        },
        grid: {
          color: theme === "dark" ? "#333333" : "#E0E0E0"
        },
        stacked: options.stacked
      },
      y: {
        display: true,
        title: {
          display: !!options.yLabel,
          text: options.yLabel || "",
          color: THEME_TEXT_COLOR[theme],
          font: {
            size: 14,
            weight: "bold"
          }
        },
        ticks: {
          color: THEME_TEXT_COLOR[theme]
        },
        grid: {
          color: theme === "dark" ? "#333333" : "#E0E0E0"
        },
        stacked: options.stacked
      }
    };
  }

  return config;
}

// Generate chart using Chart.js (mock implementation)
async function generateChart(options: ChartOptions): Promise<void> {
  console.log("Generating chart...");

  // Load data
  let rawData: any;
  if (options.file) {
    console.log(`Loading data from: ${options.file}`);
    rawData = loadDataFromFile(options.file);
  } else if (options.data) {
    try {
      rawData = JSON.parse(options.data);
    } catch (error) {
      console.error("Error: Invalid JSON data");
      process.exit(1);
    }
  }

  // Get colors
  const colors = getColors(options);

  // Normalize data
  const chartData = normalizeData(rawData, options.type, colors, options);

  // Generate chart configuration
  const config = generateChartConfig(chartData, options, colors);

  // Determine output format
  const outputExt = extname(options.output).toLowerCase().replace(".", "") as OutputFormat;
  const validFormats: OutputFormat[] = ["png", "svg", "pdf"];

  if (!validFormats.includes(outputExt)) {
    console.error(`Error: Invalid output format "${outputExt}"`);
    console.error(`Valid formats: ${validFormats.join(", ")}`);
    process.exit(1);
  }

  // Create output directory if it doesn't exist
  const outputDir = dirname(options.output);
  if (outputDir && outputDir !== ".") {
    mkdirSync(outputDir, { recursive: true });
  }

  // Generate chart (simplified - in production this would use Chart.js + node-canvas)
  console.log("\nChart Configuration:");
  console.log("-------------------");
  console.log(`Type: ${options.type}`);
  console.log(`Output: ${options.output}`);
  console.log(`Format: ${outputExt.toUpperCase()}`);
  console.log(`Dimensions: ${options.width}x${options.height}`);
  console.log(`Theme: ${options.theme}`);
  if (options.title) console.log(`Title: ${options.title}`);
  console.log(`\nData Points: ${chartData.datasets[0].data.length}`);
  console.log(`Datasets: ${chartData.datasets.length}`);

  // In a real implementation, this would:
  // 1. Create a canvas with node-canvas
  // 2. Initialize Chart.js with the config
  // 3. Render the chart
  // 4. Export to the specified format

  // For now, create a placeholder file with metadata
  const metadata = {
    generated: new Date().toISOString(),
    chart: {
      type: options.type,
      theme: options.theme,
      dimensions: {
        width: options.width,
        height: options.height
      }
    },
    config: config,
    note: "To enable actual chart generation, install: chartjs-node-canvas"
  };

  writeFileSync(options.output + ".json", JSON.stringify(metadata, null, 2));

  console.log("\n✓ Chart configuration generated successfully!");
  console.log(`✓ Metadata saved to: ${options.output}.json`);
  console.log("\n📝 Note: To generate actual chart images, install chartjs-node-canvas:");
  console.log("   bun add chartjs-node-canvas chart.js");
}

// Main execution
async function main() {
  console.log("🎨 Chart Generator v1.0.0\n");

  const options = parseArguments();
  await generateChart(options);

  console.log("\n✨ Done!");
}

// Run
main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
