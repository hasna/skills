#!/usr/bin/env bun
/**
 * Generate Regex Skill
 * Generate regular expression patterns from natural language descriptions
 */

import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import OpenAI from "openai";

// Types
type RegexFlavor = "javascript" | "python" | "pcre" | "go" | "rust";
type Preset = "email" | "phone" | "url" | "date" | "ipv4" | "ipv6" | "hex-color" | "credit-card" | "ssn" | "zip-code" | "username" | "password" | "slug";

interface GenerateOptions {
  description?: string;
  preset?: Preset;
  flavor: RegexFlavor;
  testStrings: string[];
  explain?: string;
  flags: string;
  output?: string;
  noAI: boolean;
}

interface TestResult {
  input: string;
  match: boolean;
  groups: string[];
  error?: string;
}

interface RegexOutput {
  pattern: string;
  flavor: RegexFlavor;
  flags: string;
  explanation: string;
  description: string;
  testResults?: TestResult[];
  generatedAt: string;
}

// Constants
const SKILL_NAME = "generate-regex";
const SESSION_ID = randomUUID().slice(0, 8);

// Use SKILLS_OUTPUT_DIR from CLI if available
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);
const LOG_FILE = join(LOGS_DIR, `${SESSION_ID}.log`);

// Ensure directories exist
function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Logger
function log(message: string, level: "info" | "error" | "success" = "info") {
  const timestamp = new Date().toISOString();
  ensureDir(LOGS_DIR);

  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(LOG_FILE, logEntry);

  if (level === "error") {
    console.error(message);
  }
}

// Common regex presets
const REGEX_PRESETS: Record<Preset, { pattern: string; description: string; explanation: string }> = {
  email: {
    pattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
    description: "Match valid email addresses",
    explanation: `- ^ - Start of string
- [a-zA-Z0-9._%+-]+ - One or more alphanumeric or special chars (local part)
- @ - Literal @ symbol
- [a-zA-Z0-9.-]+ - Domain name
- \\. - Literal dot
- [a-zA-Z]{2,} - TLD (2+ letters)
- $ - End of string`
  },
  phone: {
    pattern: "^\\+?1?[-\\.\\s]?\\(?([0-9]{3})\\)?[-\\.\\s]?([0-9]{3})[-\\.\\s]?([0-9]{4})$",
    description: "Match US phone numbers (multiple formats)",
    explanation: `- ^ - Start of string
- \\+? - Optional plus sign
- 1? - Optional country code (1)
- [-\\.\\s]? - Optional separator (dash, dot, or space)
- \\(? - Optional opening parenthesis
- ([0-9]{3}) - Area code (3 digits) - Capture group 1
- \\)? - Optional closing parenthesis
- [-\\.\\s]? - Optional separator
- ([0-9]{3}) - Exchange (3 digits) - Capture group 2
- [-\\.\\s]? - Optional separator
- ([0-9]{4}) - Line number (4 digits) - Capture group 3
- $ - End of string`
  },
  url: {
    pattern: "^https?:\\/\\/(www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b([-a-zA-Z0-9()@:%_\\+.~#?&//=]*)$",
    description: "Match HTTP/HTTPS URLs",
    explanation: `- ^ - Start of string
- https? - Match http or https
- :\\/\\/ - Literal ://
- (www\\.)? - Optional www. prefix
- [-a-zA-Z0-9@:%._\\+~#=]{1,256} - Domain name (up to 256 chars)
- \\. - Literal dot
- [a-zA-Z0-9()]{1,6} - TLD (1-6 chars)
- \\b - Word boundary
- ([-a-zA-Z0-9()@:%_\\+.~#?&//=]*) - Optional path and query string
- $ - End of string`
  },
  date: {
    pattern: "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$",
    description: "Match dates in YYYY-MM-DD format",
    explanation: `- ^ - Start of string
- \\d{4} - 4-digit year
- - - Literal hyphen
- (0[1-9]|1[0-2]) - Month (01-12)
- - - Literal hyphen
- (0[1-9]|[12][0-9]|3[01]) - Day (01-31)
- $ - End of string`
  },
  ipv4: {
    pattern: "^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$",
    description: "Match IPv4 addresses",
    explanation: `- ^ - Start of string
- ((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.) - Match 0-255 followed by dot, repeated 3 times
  - 25[0-5] - 250-255
  - 2[0-4][0-9] - 200-249
  - [01]?[0-9][0-9]? - 0-199
- (25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?) - Final octet (0-255)
- $ - End of string`
  },
  ipv6: {
    pattern: "^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$",
    description: "Match IPv6 addresses",
    explanation: `- Complex pattern matching all valid IPv6 formats
- Supports full notation (8 groups of 4 hex digits)
- Supports compressed notation (::)
- Supports IPv4-mapped IPv6 addresses
- Supports link-local addresses`
  },
  "hex-color": {
    pattern: "^#?([a-fA-F0-9]{6}|[a-fA-F0-9]{3})$",
    description: "Match hex color codes",
    explanation: `- ^ - Start of string
- #? - Optional hash symbol
- ([a-fA-F0-9]{6}|[a-fA-F0-9]{3}) - Either 6 or 3 hex digits
- $ - End of string`
  },
  "credit-card": {
    pattern: "^(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12}|(?:2131|1800|35\\d{3})\\d{11})$",
    description: "Match credit card numbers (Visa, MasterCard, Amex, Discover, JCB)",
    explanation: `- Matches major credit card formats:
- Visa: Starts with 4, 13 or 16 digits
- MasterCard: Starts with 51-55, 16 digits
- American Express: Starts with 34 or 37, 15 digits
- Discover: Starts with 6011 or 65, 16 digits
- JCB: Starts with 2131, 1800, or 35, 15-16 digits`
  },
  ssn: {
    pattern: "^(?!000|666)[0-8][0-9]{2}-(?!00)[0-9]{2}-(?!0000)[0-9]{4}$",
    description: "Match US Social Security Numbers (XXX-XX-XXXX)",
    explanation: `- ^ - Start of string
- (?!000|666) - Negative lookahead: not 000 or 666
- [0-8][0-9]{2} - First 3 digits (001-899)
- - - Literal hyphen
- (?!00) - Negative lookahead: not 00
- [0-9]{2} - Middle 2 digits (01-99)
- - - Literal hyphen
- (?!0000) - Negative lookahead: not 0000
- [0-9]{4} - Last 4 digits (0001-9999)
- $ - End of string`
  },
  "zip-code": {
    pattern: "^\\d{5}(-\\d{4})?$",
    description: "Match US ZIP codes (5 or 9 digit)",
    explanation: `- ^ - Start of string
- \\d{5} - 5 digits
- (-\\d{4})? - Optional hyphen and 4 more digits (ZIP+4)
- $ - End of string`
  },
  username: {
    pattern: "^[a-zA-Z0-9_-]{3,16}$",
    description: "Match valid usernames (alphanumeric, underscore, hyphen, 3-16 chars)",
    explanation: `- ^ - Start of string
- [a-zA-Z0-9_-]{3,16} - 3 to 16 alphanumeric characters, underscores, or hyphens
- $ - End of string`
  },
  password: {
    pattern: "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$",
    description: "Match strong passwords (8+ chars, uppercase, lowercase, number, special)",
    explanation: `- ^ - Start of string
- (?=.*[a-z]) - Positive lookahead: must contain lowercase letter
- (?=.*[A-Z]) - Positive lookahead: must contain uppercase letter
- (?=.*\\d) - Positive lookahead: must contain digit
- (?=.*[@$!%*?&]) - Positive lookahead: must contain special character
- [A-Za-z\\d@$!%*?&]{8,} - Match 8+ characters from allowed set
- $ - End of string`
  },
  slug: {
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    description: "Match URL slugs (lowercase, numbers, hyphens)",
    explanation: `- ^ - Start of string
- [a-z0-9]+ - One or more lowercase letters or digits
- (?:-[a-z0-9]+)* - Zero or more groups of hyphen followed by letters/digits
- $ - End of string`
  }
};

function showHelp(): void {
  console.log(`
skill-generate-regex - Generate regular expression patterns from natural language

Usage:
  skills run generate-regex -- "<description>" [options]
  skills run generate-regex -- --preset <preset-name> [options]
  skills run generate-regex -- --explain "<pattern>" [options]

Options:
  -h, --help               Show this help message
  --preset <name>          Use a preset pattern (email, phone, url, date, ipv4, ipv6,
                           hex-color, credit-card, ssn, zip-code, username, password, slug)
  --flavor <type>          Target regex flavor: javascript, python, pcre, go, rust (default: javascript)
  --test <string>          String to test against the pattern (can be used multiple times)
  --explain <pattern>      Explain an existing regex pattern
  --flags <flags>          Regex flags (e.g., "gi" for global, case-insensitive)
  --output <path>          Custom output file path
  --no-ai                  Only works with --preset (no AI generation)

Output includes:
  - Generated pattern
  - Line-by-line explanation
  - Test results (if --test provided)
  - Flavor-specific usage notes

Examples:
  skills run generate-regex -- "match US phone numbers"
  skills run generate-regex -- --preset email --test "test@example.com"
  skills run generate-regex -- --explain "^[a-z]+$" --flavor python

Requirements:
  OPENAI_API_KEY environment variable must be set for AI generation.
`);
}

// Parse command line arguments
function parseArgs(args: string[]): GenerateOptions {
  // Check for help flag first
  if (args.includes("-h") || args.includes("--help")) {
    showHelp();
    process.exit(0);
  }
  const options: GenerateOptions = {
    flavor: "javascript",
    testStrings: [],
    flags: "",
    noAI: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "--preset":
        if (nextArg && nextArg in REGEX_PRESETS) {
          options.preset = nextArg as Preset;
          i++;
        }
        break;
      case "--flavor":
        if (nextArg && ["javascript", "python", "pcre", "go", "rust"].includes(nextArg)) {
          options.flavor = nextArg as RegexFlavor;
          i++;
        }
        break;
      case "--test":
        if (nextArg) {
          options.testStrings.push(nextArg);
          i++;
        }
        break;
      case "--explain":
        if (nextArg) {
          options.explain = nextArg;
          i++;
        }
        break;
      case "--flags":
        if (nextArg) {
          options.flags = nextArg;
          i++;
        }
        break;
      case "--output":
        if (nextArg) {
          options.output = nextArg;
          i++;
        }
        break;
      case "--no-ai":
        options.noAI = true;
        break;
      default:
        // If it's not a flag and we don't have a description yet, use it as description
        if (!arg.startsWith("--") && !options.description && !options.preset && !options.explain) {
          options.description = arg;
        }
        break;
    }
  }

  return options;
}

// Format pattern for specific flavor
function formatPatternForFlavor(pattern: string, flavor: RegexFlavor, flags: string): string {
  switch (flavor) {
    case "python":
      return `r'${pattern}'`;
    case "go":
      return `\`${pattern}\``;
    case "rust":
      return `r"${pattern}"`;
    case "pcre":
    case "javascript":
    default:
      return pattern;
  }
}

// Get flavor-specific notes
function getFlavorNotes(flavor: RegexFlavor, flags: string): string {
  switch (flavor) {
    case "python":
      const pythonFlags = [];
      if (flags.includes("i")) pythonFlags.push("re.IGNORECASE");
      if (flags.includes("m")) pythonFlags.push("re.MULTILINE");
      if (flags.includes("s")) pythonFlags.push("re.DOTALL");
      if (flags.includes("x")) pythonFlags.push("re.VERBOSE");

      if (pythonFlags.length > 0) {
        return `Use with: re.compile(r'...', ${pythonFlags.join(" | ")})`;
      }
      return "Use with: re.compile(r'...')";

    case "go":
      return "Use with: regexp.MustCompile(`...`)";

    case "rust":
      return "Use with: Regex::new(r\"...\").unwrap()";

    case "pcre":
      return "Use with PCRE-compatible engine";

    case "javascript":
    default:
      if (flags) {
        return `Use with: new RegExp('...', '${flags}')`;
      }
      return "Use with: new RegExp('...') or /.../ literal";
  }
}

// Test regex pattern against strings
function testPattern(pattern: string, testStrings: string[], flags: string): TestResult[] {
  const results: TestResult[] = [];

  try {
    const regex = new RegExp(pattern, flags);

    for (const testString of testStrings) {
      try {
        const match = regex.exec(testString);
        results.push({
          input: testString,
          match: match !== null,
          groups: match ? match.slice(1).filter(g => g !== undefined) : []
        });
      } catch (error) {
        results.push({
          input: testString,
          match: false,
          groups: [],
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  } catch (error) {
    // If regex compilation fails, mark all tests as errors
    for (const testString of testStrings) {
      results.push({
        input: testString,
        match: false,
        groups: [],
        error: error instanceof Error ? error.message : "Invalid regex pattern"
      });
    }
  }

  return results;
}

// Generate regex using AI
async function generateRegexAI(description: string, flavor: RegexFlavor, flags: string): Promise<{ pattern: string; explanation: string }> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY or ANTHROPIC_API_KEY environment variable is required for AI generation");
  }

  log(`Generating regex pattern using AI for: "${description}"`);

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const flavorNotes: Record<RegexFlavor, string> = {
    javascript: "JavaScript RegExp (ES2018+, supports named groups, lookbehinds)",
    python: "Python re module",
    pcre: "PCRE (Perl Compatible Regular Expressions)",
    go: "Go RE2 syntax (no backreferences or lookarounds)",
    rust: "Rust regex crate (similar to RE2)"
  };

  const prompt = `Generate a regular expression pattern based on this description: "${description}"

Target flavor: ${flavor} (${flavorNotes[flavor]})
${flags ? `Flags: ${flags}` : ""}

Requirements:
1. Provide ONLY the regex pattern (no delimiters like / or quotes)
2. Make it as specific and accurate as possible
3. Consider edge cases
4. Optimize for the target flavor's capabilities

Format your response as JSON:
{
  "pattern": "the regex pattern here",
  "explanation": "line-by-line explanation of each part, using bullet points with - prefix"
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a regex expert. Generate accurate, efficient regular expressions with detailed explanations. Return only valid JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      response_format: { type: "json_object" }
    });

    const content = completion.choices[0].message.content || "{}";
    const result = JSON.parse(content);

    if (!result.pattern || !result.explanation) {
      throw new Error("Invalid AI response format");
    }

    log(`Generated pattern: ${result.pattern}`);
    return result;
  } catch (error) {
    throw new Error(`AI generation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

// Explain regex using AI
async function explainRegexAI(pattern: string, flavor: RegexFlavor): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY or ANTHROPIC_API_KEY environment variable is required for AI explanation");
  }

  log(`Explaining regex pattern using AI: "${pattern}"`);

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const prompt = `Explain this regular expression pattern in detail: ${pattern}

Target flavor: ${flavor}

Provide a comprehensive explanation that includes:
1. Line-by-line breakdown of each component (use bullet points with - prefix)
2. What the pattern matches overall
3. Any special features or techniques used
4. Potential use cases

Format as plain text with bullet points.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a regex expert. Explain regular expressions in clear, detailed terms that both beginners and experts can understand."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3
    });

    const explanation = completion.choices[0].message.content || "No explanation available";
    log("Generated explanation");
    return explanation;
  } catch (error) {
    throw new Error(`AI explanation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

// Format output for display
function formatOutput(result: RegexOutput): string {
  const lines: string[] = [];

  // Pattern
  const formattedPattern = formatPatternForFlavor(result.pattern, result.flavor, result.flags);
  lines.push(`Pattern: ${formattedPattern}`);
  lines.push("");

  // Description
  if (result.description) {
    lines.push(`Description: ${result.description}`);
    lines.push("");
  }

  // Explanation
  lines.push("Explanation:");
  lines.push(result.explanation);
  lines.push("");

  // Test results
  if (result.testResults && result.testResults.length > 0) {
    lines.push("Test Results:");
    for (const test of result.testResults) {
      const icon = test.match ? "✓" : "✗";
      const status = test.match ? "MATCH" : "NO MATCH";
      lines.push(`${icon} "${test.input}" - ${status}`);

      if (test.groups.length > 0) {
        lines.push(`  Captured groups: ${test.groups.map((g, i) => `[${i + 1}] ${g}`).join(", ")}`);
      }

      if (test.error) {
        lines.push(`  Error: ${test.error}`);
      }
    }

    const passed = result.testResults.filter(t => t.match).length;
    const total = result.testResults.length;
    lines.push("");
    lines.push(`${total} test${total !== 1 ? "s" : ""}, ${passed} passed, ${total - passed} failed`);
    lines.push("");
  }

  // Flavor and flags
  lines.push(`Flavor: ${result.flavor}`);
  lines.push(`Flags: ${result.flags || "(none)"}`);
  lines.push(getFlavorNotes(result.flavor, result.flags));

  return lines.join("\n");
}

// Main function
async function main() {
  try {
    log(`Starting ${SKILL_NAME} skill (Session: ${SESSION_ID})`);

    const args = Bun.argv.slice(2);
    log(`Arguments: ${args.join(" ")}`);

    const options = parseArgs(args);

    // Determine what to do
    let result: RegexOutput;

    if (options.explain) {
      // Explain mode
      log("Mode: Explain");
      const explanation = await explainRegexAI(options.explain, options.flavor);

      result = {
        pattern: options.explain,
        flavor: options.flavor,
        flags: options.flags,
        explanation,
        description: "Regex explanation",
        generatedAt: new Date().toISOString()
      };

      if (options.testStrings.length > 0) {
        result.testResults = testPattern(options.explain, options.testStrings, options.flags);
      }
    } else if (options.preset) {
      // Preset mode
      log(`Mode: Preset (${options.preset})`);
      const preset = REGEX_PRESETS[options.preset];

      result = {
        pattern: preset.pattern,
        flavor: options.flavor,
        flags: options.flags,
        explanation: preset.explanation,
        description: preset.description,
        generatedAt: new Date().toISOString()
      };

      if (options.testStrings.length > 0) {
        result.testResults = testPattern(preset.pattern, options.testStrings, options.flags);
      }
    } else if (options.description) {
      // Generate mode
      log("Mode: Generate from description");

      if (options.noAI) {
        throw new Error("--no-ai flag can only be used with --preset");
      }

      const generated = await generateRegexAI(options.description, options.flavor, options.flags);

      result = {
        pattern: generated.pattern,
        flavor: options.flavor,
        flags: options.flags,
        explanation: generated.explanation,
        description: options.description,
        generatedAt: new Date().toISOString()
      };

      if (options.testStrings.length > 0) {
        result.testResults = testPattern(generated.pattern, options.testStrings, options.flags);
      }
    } else {
      throw new Error("Please provide a description, --preset, or --explain flag");
    }

    // Display output
    console.log(formatOutput(result));

    // Save to file if requested
    const outputFile = options.output || join(EXPORTS_DIR, `regex_${Date.now()}.json`);
    ensureDir(EXPORTS_DIR);
    await Bun.write(outputFile, JSON.stringify(result, null, 2));

    log(`Output saved to: ${outputFile}`, "success");
    console.log(`\nOutput saved to: ${outputFile}`);

    log("Skill completed successfully", "success");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error: ${errorMessage}`, "error");
    console.error(`\nError: ${errorMessage}`);
    process.exit(1);
  }
}

main();
