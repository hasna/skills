import { writeFileSync } from "fs";
import { join } from "path";

interface ParsedInput {
  method: string;
  path: string;
  description: string;
  fields?: string[];
}

interface Options {
  format?: string;
  includeAuth?: boolean;
  includeRateLimit?: boolean;
}

interface TestCase {
  name: string;
  type: "success" | "error" | "validation" | "edge";
  code: string;
}

/**
 * Parse the input prompt to extract API details
 */
function parseInput(input: string): ParsedInput {
  const methodMatch = input.match(/\b(GET|POST|PUT|DELETE|PATCH)\b/i);
  const pathMatch = input.match(/\/[a-z0-9/:_-]+/i);

  if (!methodMatch || !pathMatch) {
    throw new Error("Could not parse HTTP method or path from input. Please provide format like: 'POST /api/users with name, email'");
  }

  const method = methodMatch[0].toUpperCase();
  const path = pathMatch[0];

  // Extract field names mentioned after "with"
  const fieldsMatch = input.match(/with\s+(.+)/i);
  let fields: string[] = [];

  if (fieldsMatch) {
    const fieldsText = fieldsMatch[1];
    fields = fieldsText
      .split(/,|\s+and\s+/)
      .map(f => f.trim())
      .filter(f => f.length > 0 && !f.match(/^(array|object|required|optional)$/i));
  }

  return {
    method,
    path,
    description: input,
    fields: fields.length > 0 ? fields : undefined,
  };
}

/**
 * Generate test cases based on parsed input
 */
function generateTestCases(parsed: ParsedInput, options: Options): TestCase[] {
  const tests: TestCase[] = [];
  const { method, path, fields } = parsed;
  const hasBody = ["POST", "PUT", "PATCH"].includes(method);

  // Success test
  tests.push({
    name: `should successfully ${method} ${path}`,
    type: "success",
    code: generateSuccessTest(method, path, fields),
  });

  // Error tests
  if (method !== "GET") {
    tests.push({
      name: `should return 400 for invalid data`,
      type: "error",
      code: generateErrorTest(method, path, "invalid data"),
    });
  }

  // Validation tests
  if (hasBody && fields && fields.length > 0) {
    fields.forEach((field) => {
      tests.push({
        name: `should return 400 when ${field} is missing`,
        type: "validation",
        code: generateValidationTest(method, path, field, fields),
      });
    });
  }

  // Authentication tests
  if (options.includeAuth) {
    tests.push({
      name: `should return 401 without authentication`,
      type: "error",
      code: generateAuthTest(method, path),
    });
  }

  // Rate limiting tests
  if (options.includeRateLimit) {
    tests.push({
      name: `should return 429 when rate limit exceeded`,
      type: "edge",
      code: generateRateLimitTest(method, path),
    });
  }

  // Edge case: 404 for non-existent resource
  if (path.includes(":id")) {
    tests.push({
      name: `should return 404 for non-existent resource`,
      type: "edge",
      code: generateNotFoundTest(method, path),
    });
  }

  return tests;
}

/**
 * Generate success test code
 */
function generateSuccessTest(method: string, path: string, fields?: string[]): string {
  const hasBody = ["POST", "PUT", "PATCH"].includes(method);
  const requestBody = hasBody && fields
    ? `{ ${fields.map(f => `${f}: "test-${f}"`).join(", ")} }`
    : "{}";

  return `
  const response = await fetch("${path}", {
    method: "${method}",
    headers: { "Content-Type": "application/json" },
    ${hasBody ? `body: JSON.stringify(${requestBody}),` : ""}
  });

  expect(response.status).toBe(${method === "POST" ? "201" : "200"});
  const data = await response.json();
  expect(data).toBeTruthy();`;
}

/**
 * Generate error test code
 */
function generateErrorTest(method: string, path: string, errorType: string): string {
  return `
  const response = await fetch("${path}", {
    method: "${method}",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invalid: "data" }),
  });

  expect(response.status).toBe(400);
  const data = await response.json();
  expect(data.error).toBeTruthy();`;
}

/**
 * Generate validation test code
 */
function generateValidationTest(
  method: string,
  path: string,
  missingField: string,
  allFields: string[]
): string {
  const bodyWithoutField = allFields
    .filter(f => f !== missingField)
    .map(f => `${f}: "test-${f}"`)
    .join(", ");

  return `
  const response = await fetch("${path}", {
    method: "${method}",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ${bodyWithoutField} }),
  });

  expect(response.status).toBe(400);
  const data = await response.json();
  expect(data.error).toContain("${missingField}");`;
}

/**
 * Generate authentication test code
 */
function generateAuthTest(method: string, path: string): string {
  const hasBody = ["POST", "PUT", "PATCH"].includes(method);

  return `
  const response = await fetch("${path}", {
    method: "${method}",
    headers: { "Content-Type": "application/json" },
    ${hasBody ? 'body: JSON.stringify({ test: "data" }),' : ""}
  });

  expect(response.status).toBe(401);
  const data = await response.json();
  expect(data.error).toBeTruthy();`;
}

/**
 * Generate rate limit test code
 */
function generateRateLimitTest(method: string, path: string): string {
  const hasBody = ["POST", "PUT", "PATCH"].includes(method);

  return `
  // Make multiple requests to trigger rate limit
  const requests = Array(100).fill(null).map(() =>
    fetch("${path}", {
      method: "${method}",
      headers: { "Content-Type": "application/json" },
      ${hasBody ? 'body: JSON.stringify({ test: "data" }),' : ""}
    })
  );

  const responses = await Promise.all(requests);
  const rateLimited = responses.some(r => r.status === 429);
  expect(rateLimited).toBe(true);`;
}

/**
 * Generate 404 test code
 */
function generateNotFoundTest(method: string, path: string): string {
  const testPath = path.replace(":id", "non-existent-id");
  const hasBody = ["POST", "PUT", "PATCH"].includes(method);

  return `
  const response = await fetch("${testPath}", {
    method: "${method}",
    headers: { "Content-Type": "application/json" },
    ${hasBody ? 'body: JSON.stringify({ test: "data" }),' : ""}
  });

  expect(response.status).toBe(404);`;
}

/**
 * Generate complete test file content
 */
function generateTestFile(parsed: ParsedInput, tests: TestCase[], options: Options): string {
  const { method, path } = parsed;
  const framework = options.format || "vitest";

  let content = ``;

  if (framework === "vitest") {
    content += `import { describe, it, expect, beforeAll, afterAll } from "vitest";\n\n`;
  } else if (framework === "jest") {
    content += `import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";\n\n`;
  } else {
    content += `const { describe, it, expect, before, after } = require("mocha");\nconst { expect } = require("chai");\n\n`;
  }

  content += `describe("${method} ${path}", () => {\n`;
  content += `  let baseUrl: string;\n\n`;
  content += `  beforeAll(() => {\n`;
  content += `    baseUrl = process.env.API_BASE_URL || "http://localhost:3000";\n`;
  content += `  });\n\n`;

  // Group tests by type
  const groupedTests = {
    success: tests.filter(t => t.type === "success"),
    validation: tests.filter(t => t.type === "validation"),
    error: tests.filter(t => t.type === "error"),
    edge: tests.filter(t => t.type === "edge"),
  };

  Object.entries(groupedTests).forEach(([type, typeTests]) => {
    if (typeTests.length === 0) return;

    const label = type.charAt(0).toUpperCase() + type.slice(1);
    content += `  describe("${label} cases", () => {\n`;

    typeTests.forEach(test => {
      content += `    it("${test.name}", async () => {${test.code}\n    });\n\n`;
    });

    content += `  });\n\n`;
  });

  content += `});\n`;

  return content;
}

/**
 * Main execution function
 */
async function main() {
  try {
    const input = process.env.SKILLS_INPUT || "";
    const outputDir = process.env.SKILLS_OUTPUT_DIR || process.cwd();
    const exportsDir = process.env.SKILLS_EXPORTS_DIR || join(outputDir, "exports");

    if (!input) {
      throw new Error("No input provided. Use: skills run api-test-suite -- \"POST /api/users with name, email\"");
    }

    // Parse command line options
    const args = process.argv.slice(2);
    const options: Options = {
      format: args.includes("--format")
        ? args[args.indexOf("--format") + 1]
        : "vitest",
      includeAuth: !args.includes("--include-auth=false"),
      includeRateLimit: args.includes("--include-rate-limit"),
    };

    console.log("Parsing API endpoint specification...");
    const parsed = parseInput(input);

    console.log(`Generating test suite for ${parsed.method} ${parsed.path}`);
    console.log(`Format: ${options.format}`);
    console.log(`Include auth tests: ${options.includeAuth}`);
    console.log(`Include rate limit tests: ${options.includeRateLimit}`);

    // Generate test cases
    const testCases = generateTestCases(parsed, options);
    console.log(`Generated ${testCases.length} test cases`);

    // Generate complete test file
    const testFileContent = generateTestFile(parsed, testCases, options);

    // Save to exports directory
    const fileName = `${parsed.path.replace(/\//g, "-").replace(/:/g, "")}-${parsed.method.toLowerCase()}.test.ts`;
    const filePath = join(exportsDir, fileName);

    writeFileSync(filePath, testFileContent);
    console.log(`Test suite saved to: ${filePath}`);

    // Also log a summary
    const summary = {
      endpoint: `${parsed.method} ${parsed.path}`,
      testCases: testCases.length,
      framework: options.format,
      filePath: fileName,
      tests: testCases.map(t => ({ name: t.name, type: t.type })),
    };

    console.log("\n=== Test Suite Summary ===");
    console.log(JSON.stringify(summary, null, 2));

  } catch (error) {
    console.error("Error generating API test suite:", error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export {
  parseInput,
  generateTestCases,
  generateTestFile,
  generateSuccessTest,
  generateErrorTest,
  generateValidationTest,
  generateAuthTest,
  generateRateLimitTest,
  generateNotFoundTest,
};
