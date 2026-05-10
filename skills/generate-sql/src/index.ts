#!/usr/bin/env bun
/**
 * Generate SQL Skill
 * Generate SQL queries from natural language descriptions with AI
 */

import { parseArgs } from "util";
import { mkdirSync, appendFileSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname, extname } from "path";
import { randomUUID } from "crypto";

// Types
type Dialect = "postgresql" | "mysql" | "sqlite" | "sqlserver" | "oracle";
type OutputFormat = "pretty" | "compact" | "json";
type QueryType = "select" | "insert" | "update" | "delete" | "create" | "alter" | "auto";

interface GenerateOptions {
  description: string;
  dialect: Dialect;
  schema?: string;
  explain: boolean;
  format: OutputFormat;
  output?: string;
  type: QueryType;
  noAi: boolean;
  model: string;
  validate: boolean;
  verbose: boolean;
}

interface SQLQuery {
  query: string;
  dialect: Dialect;
  type: string;
  explanation?: string;
  tables: string[];
  complexity: "simple" | "medium" | "complex";
}

interface SchemaInfo {
  content: string;
  format: "sql" | "json";
  tables: string[];
}

// Constants
const SKILL_NAME = "generate-sql";
const SESSION_ID = randomUUID().slice(0, 8);

// Use SKILLS_OUTPUT_DIR from CLI if available, otherwise fall back to cwd
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);

// Session timestamp for log filename
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").replace(/-/g, "_").slice(0, 19).toLowerCase();

// Ensure directories exist
function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Logger
function log(message: string, level: "info" | "error" | "success" = "info") {
  const timestamp = new Date().toISOString();
  const logFile = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);

  ensureDir(LOGS_DIR);

  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(logFile, logEntry);

  const prefix = level === "error" ? "❌" : level === "success" ? "✅" : "ℹ️";
  console.log(`${prefix} ${message}`);
}

// Schema parsing
function parseSchema(schemaPath: string): SchemaInfo | null {
  if (!existsSync(schemaPath)) {
    log(`Schema file not found: ${schemaPath}`, "error");
    return null;
  }

  const content = readFileSync(schemaPath, "utf-8");
  const ext = extname(schemaPath).toLowerCase();

  let format: "sql" | "json" = "sql";
  let tables: string[] = [];

  if (ext === ".json") {
    format = "json";
    try {
      const parsed = JSON.parse(content);
      if (parsed.tables) {
        tables = Object.keys(parsed.tables);
      }
    } catch (error) {
      log(`Failed to parse JSON schema: ${error}`, "error");
      return null;
    }
  } else {
    // SQL DDL - extract table names
    format = "sql";
    const tableMatches = content.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"]?)(\w+)\1/gi);
    for (const match of tableMatches) {
      tables.push(match[2]);
    }
  }

  return { content, format, tables };
}

// Query type detection
function detectQueryType(description: string): QueryType {
  const lower = description.toLowerCase();

  // Check for CREATE statements first (more specific)
  if (
    lower.includes("create table") ||
    lower.includes("create index") ||
    (lower.includes("create") && lower.includes("table"))
  ) {
    return "create";
  }

  // Check for ALTER statements
  if (
    lower.includes("alter table") ||
    lower.includes("add column") ||
    lower.includes("drop column") ||
    (lower.includes("alter") && lower.includes("table"))
  ) {
    return "alter";
  }

  // Check for DELETE statements
  if (lower.includes("delete") || lower.includes("remove")) {
    return "delete";
  }

  // Check for UPDATE statements
  if (lower.includes("update") || lower.includes("modify") || lower.includes("change")) {
    return "update";
  }

  // Check for INSERT statements
  if (lower.includes("insert") || lower.includes("add") || lower.includes("create new")) {
    return "insert";
  }

  // Check for SELECT statements (most common, check last)
  if (
    lower.includes("select") ||
    lower.includes("get") ||
    lower.includes("find") ||
    lower.includes("show") ||
    lower.includes("list") ||
    lower.includes("retrieve")
  ) {
    return "select";
  }

  return "select"; // Default to select
}

// Template-based query generation (no AI)
function generateTemplateQuery(description: string, dialect: Dialect, type: QueryType): SQLQuery {
  const detectedType = type === "auto" ? detectQueryType(description) : type;

  let query = "";
  let tables: string[] = [];
  let complexity: "simple" | "medium" | "complex" = "simple";

  // Extract potential table names from description
  const lower = description.toLowerCase();
  const words = description.split(/\s+/);

  // Look for table name patterns like "users table", "products", etc.
  const commonTableWords = ["table", "from", "into", "update", "join", "where", "with"];
  const ignoreWords = ["get", "find", "show", "list", "all", "the", "and", "or", "in", "on", "at", "by", "for", "to", "a", "an", "create", "alter", "drop", "insert", "delete", "remove", "modify", "change", "add", "new", "old"];

  const potentialTables = words.filter(w =>
    w.length > 2 &&
    !commonTableWords.includes(w.toLowerCase()) &&
    !ignoreWords.includes(w.toLowerCase())
  );

  if (potentialTables.length > 0) {
    // Try to find a table name after "table" keyword or at the beginning
    const tableIndex = words.findIndex(w => w.toLowerCase() === "table");
    if (tableIndex >= 0 && tableIndex > 0) {
      // Get word before "table" keyword
      tables.push(words[tableIndex - 1].toLowerCase());
    } else {
      // Find first noun-like word (usually the table name)
      tables.push(potentialTables[0].toLowerCase());
    }
  } else {
    tables.push("table_name");
  }

  switch (detectedType) {
    case "select":
      query = `SELECT *\nFROM ${tables[0] || "table_name"}\nWHERE 1=1;`;
      break;
    case "insert":
      query = `INSERT INTO ${tables[0] || "table_name"} (column1, column2)\nVALUES (value1, value2);`;
      break;
    case "update":
      query = `UPDATE ${tables[0] || "table_name"}\nSET column1 = value1\nWHERE id = 1;`;
      break;
    case "delete":
      query = `DELETE FROM ${tables[0] || "table_name"}\nWHERE id = 1;`;
      break;
    case "create":
      query = `CREATE TABLE ${tables[0] || "table_name"} (\n  id INTEGER PRIMARY KEY,\n  column1 VARCHAR(255),\n  created_at TIMESTAMP\n);`;
      break;
    case "alter":
      query = `ALTER TABLE ${tables[0] || "table_name"}\nADD COLUMN new_column VARCHAR(255);`;
      break;
  }

  // Adjust for dialect-specific syntax
  if (dialect === "mysql") {
    query = query.replace(/SERIAL/g, "INT AUTO_INCREMENT");
    query = query.replace(/TIMESTAMP/g, "DATETIME");
  } else if (dialect === "sqlite") {
    query = query.replace(/SERIAL/g, "INTEGER");
    query = query.replace(/VARCHAR\(\d+\)/g, "TEXT");
  } else if (dialect === "sqlserver") {
    query = query.replace(/SERIAL/g, "INT IDENTITY(1,1)");
  } else if (dialect === "oracle") {
    query = query.replace(/SERIAL/g, "NUMBER GENERATED ALWAYS AS IDENTITY");
  }

  return {
    query,
    dialect,
    type: detectedType.toUpperCase(),
    tables,
    complexity,
  };
}

// AI-powered query generation
async function generateAIQuery(
  description: string,
  dialect: Dialect,
  schema: SchemaInfo | null,
  options: GenerateOptions
): Promise<SQLQuery> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    if (options.verbose) {
      log("ANTHROPIC_API_KEY not set, falling back to template mode", "info");
    }
    return generateTemplateQuery(description, dialect, options.type);
  }

  try {
    const prompt = buildPrompt(description, dialect, schema, options);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.content[0].text;

    return parseAIResponse(content, dialect);
  } catch (error) {
    if (options.verbose) {
      log(`AI generation failed: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
      log("Falling back to template mode", "info");
    }
    return generateTemplateQuery(description, dialect, options.type);
  }
}

// Build AI prompt
function buildPrompt(
  description: string,
  dialect: Dialect,
  schema: SchemaInfo | null,
  options: GenerateOptions
): string {
  let prompt = `Generate a ${dialect.toUpperCase()} SQL query for the following request:\n\n`;
  prompt += `Request: ${description}\n\n`;

  if (schema) {
    prompt += `Database Schema:\n`;
    prompt += `\`\`\`${schema.format === "sql" ? "sql" : "json"}\n`;
    prompt += schema.content.length > 5000 ? schema.content.substring(0, 5000) + "\n..." : schema.content;
    prompt += `\n\`\`\`\n\n`;
  }

  prompt += `Requirements:\n`;
  prompt += `1. Generate valid ${dialect.toUpperCase()} SQL syntax\n`;
  prompt += `2. Use proper formatting and indentation\n`;
  prompt += `3. Include comments if the query is complex\n`;
  prompt += `4. Follow best practices for ${dialect.toUpperCase()}\n`;

  if (options.explain) {
    prompt += `5. Provide a clear explanation of what the query does\n`;
  }

  prompt += `\nRespond in the following JSON format:\n`;
  prompt += `{\n`;
  prompt += `  "query": "The SQL query (properly formatted)",\n`;
  prompt += `  "type": "Query type (SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER)",\n`;
  prompt += `  "tables": ["List of table names used"],\n`;
  prompt += `  "complexity": "simple | medium | complex",\n`;

  if (options.explain) {
    prompt += `  "explanation": "Plain English explanation of what the query does",\n`;
  }

  prompt += `}\n\n`;
  prompt += `Return only the JSON, no additional text.`;

  return prompt;
}

// Parse AI response
function parseAIResponse(content: string, dialect: Dialect): SQLQuery {
  try {
    // Extract JSON from markdown code blocks if present
    const jsonMatch = content.match(/\`\`\`(?:json)?\s*(\{[\s\S]*\})\s*\`\`\`/);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;

    const parsed = JSON.parse(jsonStr);

    return {
      query: parsed.query || "",
      dialect,
      type: parsed.type || "UNKNOWN",
      explanation: parsed.explanation,
      tables: parsed.tables || [],
      complexity: parsed.complexity || "medium",
    };
  } catch (error) {
    throw new Error(`Failed to parse AI response: ${error}`);
  }
}

// SQL validation
function validateSQL(query: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for basic SQL structure
  if (!query.trim()) {
    errors.push("Query is empty");
    return { valid: false, errors };
  }

  // Check for matching parentheses
  const openParens = (query.match(/\(/g) || []).length;
  const closeParens = (query.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    errors.push("Mismatched parentheses");
  }

  // Check for matching quotes
  const singleQuotes = (query.match(/'/g) || []).length;
  if (singleQuotes % 2 !== 0) {
    errors.push("Mismatched single quotes");
  }

  const doubleQuotes = (query.match(/"/g) || []).length;
  if (doubleQuotes % 2 !== 0) {
    errors.push("Mismatched double quotes");
  }

  // Check for SQL keywords
  const hasKeyword = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(query);
  if (!hasKeyword) {
    errors.push("No SQL keyword found");
  }

  return { valid: errors.length === 0, errors };
}

// Format SQL query
function formatQuery(sqlQuery: SQLQuery, format: OutputFormat, explain: boolean): string {
  if (format === "json") {
    return JSON.stringify(sqlQuery, null, 2);
  }

  let output = "";

  if (explain && sqlQuery.explanation) {
    // Add explanation as SQL comment
    const explanationLines = sqlQuery.explanation.split("\n");
    output += "/*\n";
    output += ` * Query Type: ${sqlQuery.type}\n`;
    output += ` * Complexity: ${sqlQuery.complexity}\n`;
    output += ` * Tables: ${sqlQuery.tables.join(", ")}\n`;
    output += ` *\n`;
    explanationLines.forEach(line => {
      output += ` * ${line}\n`;
    });
    output += " */\n\n";
  }

  if (format === "compact") {
    // Remove extra whitespace and newlines
    output += sqlQuery.query.replace(/\s+/g, " ").trim();
  } else {
    // Pretty format (default)
    output += sqlQuery.query;
  }

  // Ensure query ends with semicolon
  if (!output.trim().endsWith(";")) {
    output += ";";
  }

  return output;
}

// Main function
async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      dialect: { type: "string", default: "postgresql" },
      schema: { type: "string" },
      explain: { type: "boolean", default: false },
      format: { type: "string", default: "pretty" },
      output: { type: "string", short: "o" },
      type: { type: "string", default: "auto" },
      "no-ai": { type: "boolean", default: false },
      model: { type: "string", default: "claude-3-5-sonnet-20241022" },
      validate: { type: "boolean", default: true },
      verbose: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  // Show help
  if (values.help) {
    console.log(`
Generate SQL - Generate SQL queries from natural language descriptions

Usage:
  bun run src/index.ts [options] "description"

Options:
  --dialect <dialect>     Database dialect (postgresql, mysql, sqlite, sqlserver, oracle) [default: postgresql]
  --schema <path>         Path to schema file (SQL DDL or JSON schema)
  --explain               Add plain English explanation of the query
  --format <format>       Output format (pretty, compact, json) [default: pretty]
  --output, -o <path>     Save to file instead of stdout
  --type <type>           Query type hint (select, insert, update, delete, create, alter, auto) [default: auto]
  --no-ai                 Use template-based generation (no API key required)
  --model <model>         AI model to use [default: claude-3-5-sonnet-20241022]
  --validate              Validate SQL syntax before output [default: true]
  --verbose, -v           Show detailed processing information
  --help, -h              Show this help

Examples:
  bun run src/index.ts "Get all users who signed up in the last 30 days"
  bun run src/index.ts "Find top 10 products by sales" --dialect postgresql
  bun run src/index.ts "Create a users table with email and name" --dialect mysql
  bun run src/index.ts "Get average order value by month" --schema ./schema.sql --explain
`);
    process.exit(0);
  }

  try {
    log(`Session ID: ${SESSION_ID}`);

    // Get description from positional arguments
    const description = positionals.join(" ").trim();

    if (!description) {
      log("Please provide a description of the SQL query you want to generate", "error");
      console.log('\nExample: skills run generate-sql -- "Get all users from last 30 days"');
      process.exit(1);
    }

    // Parse options
    const dialect = (values.dialect?.toLowerCase() || "postgresql") as Dialect;
    const format = (values.format?.toLowerCase() || "pretty") as OutputFormat;
    const type = (values.type?.toLowerCase() || "auto") as QueryType;

    // Validate dialect
    const validDialects: Dialect[] = ["postgresql", "mysql", "sqlite", "sqlserver", "oracle"];
    if (!validDialects.includes(dialect)) {
      log(`Invalid dialect: ${dialect}. Valid dialects: ${validDialects.join(", ")}`, "error");
      process.exit(1);
    }

    // Validate format
    const validFormats: OutputFormat[] = ["pretty", "compact", "json"];
    if (!validFormats.includes(format)) {
      log(`Invalid format: ${format}. Valid formats: ${validFormats.join(", ")}`, "error");
      process.exit(1);
    }

    const options: GenerateOptions = {
      description,
      dialect,
      schema: values.schema,
      explain: values.explain || false,
      format,
      output: values.output,
      type,
      noAi: values["no-ai"] || false,
      model: values.model || "claude-3-5-sonnet-20241022",
      validate: values.validate !== false,
      verbose: values.verbose || false,
    };

    if (options.verbose) {
      log(`Generating ${dialect.toUpperCase()} query for: "${description}"`);
    }

    // Parse schema if provided
    let schema: SchemaInfo | null = null;
    if (options.schema) {
      if (options.verbose) {
        log(`Loading schema from: ${options.schema}`);
      }
      schema = parseSchema(options.schema);
      if (!schema) {
        process.exit(1);
      }
      if (options.verbose && schema.tables.length > 0) {
        log(`Found ${schema.tables.length} tables: ${schema.tables.join(", ")}`);
      }
    }

    // Generate query
    let sqlQuery: SQLQuery;

    if (options.noAi) {
      if (options.verbose) {
        log("Using template-based generation (AI disabled)");
      }
      sqlQuery = generateTemplateQuery(description, dialect, type);
    } else {
      if (options.verbose) {
        log("Generating query with AI...");
      }
      sqlQuery = await generateAIQuery(description, dialect, schema, options);
    }

    if (!sqlQuery.query) {
      log("Failed to generate query", "error");
      process.exit(1);
    }

    // Validate query
    if (options.validate) {
      const validation = validateSQL(sqlQuery.query);
      if (!validation.valid) {
        log("Query validation failed:", "error");
        validation.errors.forEach(error => log(`  - ${error}`, "error"));
        if (!options.verbose) {
          log("Use --verbose to see the generated query", "info");
        }
        if (options.verbose) {
          console.log("\nGenerated query:");
          console.log(sqlQuery.query);
        }
        process.exit(1);
      }
    }

    if (options.verbose) {
      log("Query generated successfully", "success");
      log(`Type: ${sqlQuery.type}, Complexity: ${sqlQuery.complexity}`);
      if (sqlQuery.tables.length > 0) {
        log(`Tables: ${sqlQuery.tables.join(", ")}`);
      }
    }

    // Format output
    const output = formatQuery(sqlQuery, format, options.explain);

    // Save or print
    if (options.output) {
      const outputPath = options.output.startsWith("/") ? options.output : join(process.cwd(), options.output);
      const outputDir = dirname(outputPath);
      ensureDir(outputDir);
      writeFileSync(outputPath, output, "utf-8");
      log(`Query saved to: ${outputPath}`, "success");
    } else {
      console.log("\n" + output + "\n");
    }

    // Summary
    if (options.verbose || options.output) {
      console.log(`\n✨ SQL query generated successfully!`);
      console.log(`   🗄️  Dialect: ${dialect}`);
      console.log(`   📋 Type: ${sqlQuery.type}`);
      console.log(`   ⚡ Complexity: ${sqlQuery.complexity}`);
      if (sqlQuery.tables.length > 0) {
        console.log(`   📊 Tables: ${sqlQuery.tables.join(", ")}`);
      }
      if (options.output) {
        console.log(`   📁 Output: ${options.output}`);
      }
      console.log(`   📋 Log: ${join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`)}`);
    }
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    process.exit(1);
  }
}

main();
