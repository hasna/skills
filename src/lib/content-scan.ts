/**
 * content-scan.ts — scans skill BODIES (not just package.json/README) for content
 * that must never ship in the public @hasna/skills package.
 *
 * Finding categories:
 *   - secret-value:     credential-shaped values (API keys, tokens, private keys)
 *   - pii-contact:      personal contact PII (E.164 phone numbers)
 *   - private-context:  internal/operational context that leaks the private fleet
 *                       (fleet hostnames, home-directory paths with a real user,
 *                       internal CLI invocations, internal infra/product names)
 *   - committed-output: operational tool output committed into the package — a
 *                       run artifact (timestamped filename, data file under an
 *                       exports/ directory) rather than an authored fixture
 *
 * The first three categories are matched against file CONTENT (see {@link scanText}).
 * `committed-output` is matched against the package-relative PATH instead (see
 * {@link scanPaths}), because what makes an artifact wrong is where it came from,
 * not what is inside it — a scraped catalog and a hand-written fixture can be
 * byte-identical in shape.
 *
 * All output is REDACTED: secret values are never emitted, phone numbers are masked
 * to their country code, and only the rule id + a safe redacted marker are reported.
 */

import { readFileSync } from "node:fs";
import { decodeForScanning, looksBinary } from "./file-bytes.js";

export type ScanCategory = "secret-value" | "pii-contact" | "private-context" | "committed-output";

export interface ScanRule {
  category: ScanCategory;
  /** Stable, human-readable rule id (safe to print — never a secret value). */
  id: string;
  description: string;
  pattern: RegExp;
  /** Optional predicate to drop known-safe example matches (e.g. 555 phone numbers). */
  isExample?: (match: string) => boolean;
}

export interface ScanFinding {
  file: string;
  line: number;
  column: number;
  category: ScanCategory;
  ruleId: string;
  /** Redacted marker — never contains a raw secret value. */
  redacted: string;
}

/**
 * Credential-shaped value patterns. These intentionally match only the SHAPE of a
 * credential; the matched value itself is never printed (see {@link redactMatch}).
 * Assembled from fragments so this source file never itself contains a literal
 * credential prefix that would trip naive scanners.
 */
const SECRET_RULES: Omit<ScanRule, "category">[] = [
  { id: "anthropic-api-key", description: "Anthropic API key", pattern: new RegExp(["sk", "ant", "[A-Za-z0-9_-]{8}"].join("-")) },
  { id: "openai-project-key", description: "OpenAI project key", pattern: new RegExp(["sk", "proj", "[A-Za-z0-9_-]{8}"].join("-")) },
  { id: "openai-api-key", description: "OpenAI API key", pattern: new RegExp("sk" + "-" + "[A-Za-z0-9]{20}") },
  { id: "npm-token", description: "npm access token", pattern: new RegExp(["npm", "[A-Za-z0-9]{16}"].join("_")) },
  { id: "github-oauth-token", description: "GitHub OAuth token", pattern: new RegExp(["gho", "[A-Za-z0-9]{16}"].join("_")) },
  { id: "github-pat", description: "GitHub personal access token", pattern: new RegExp(["ghp", "[A-Za-z0-9]{16}"].join("_")) },
  { id: "xai-api-key", description: "xAI API key", pattern: new RegExp(["xai", "[A-Za-z0-9]{16}"].join("-")) },
  { id: "google-api-key", description: "Google API key", pattern: new RegExp("AI" + "za" + "[A-Za-z0-9_-]{20}") },
  { id: "aws-access-key-id", description: "AWS access key id", pattern: new RegExp("AK" + "IA" + "[A-Z0-9]{12}") },
  { id: "context7-key", description: "Context7 key", pattern: new RegExp("ctx7sk" + "-" + "[A-Za-z0-9-]{8}") },
  { id: "private-key-block", description: "PEM private key block", pattern: new RegExp("-----BEGIN [A-Z ]*PRIVATE KEY-----") },
];

/**
 * E.164 phone numbers. Word-boundaried so we don't match inside longer digit runs
 * (hashes, ids). North-American (+1) numbers with a 555 area code are treated as
 * documentation examples and ignored.
 */
const PII_RULES: ScanRule[] = [
  {
    id: "e164-phone",
    category: "pii-contact",
    description: "E.164 phone number",
    pattern: /(?<![\d+])\+[1-9]\d{7,14}(?!\d)/,
    isExample: (match) => /^\+1555/.test(match),
  },
];

/**
 * Internal / operational context that must never appear in the public corpus.
 * These are deliberately narrow to avoid false positives on legitimate public
 * content (e.g. the public `@hasnaxyz` npm scope or the public `~/.hasna` config
 * dir are intentionally NOT matched here).
 */
const PRIVATE_CONTEXT_RULES: ScanRule[] = [
  {
    id: "fleet-hostname",
    category: "private-context",
    description: "Private fleet hostname (apple0X / spark0X)",
    pattern: /\b(?:apple|spark)0\d\b/,
  },
  {
    id: "home-directory-path",
    category: "private-context",
    description: "Absolute home-directory path leaking an OS username",
    pattern: /\/(?:home|Users)\/[a-z_][a-z0-9_-]*\//,
    isExample: (match) => /\/(?:home|Users)\/(?:user|users|you|username|name|me|example|foo|bar|test)\//i.test(match),
  },
  {
    id: "internal-cli",
    category: "private-context",
    description: "Internal-only CLI invocation",
    pattern: /\bdomains r53\b/,
  },
  {
    id: "internal-infra-name",
    category: "private-context",
    description: "Internal infrastructure / account name",
    pattern: /\bhasna-(?:xyz-infra|tools)\b/,
  },
];

export const SCAN_RULES: ScanRule[] = [
  ...SECRET_RULES.map((rule) => ({ ...rule, category: "secret-value" as const })),
  ...PII_RULES,
  ...PRIVATE_CONTEXT_RULES,
];

/** A rule matched against a package-relative path rather than file content. */
export interface ScanPathRule {
  category: ScanCategory;
  id: string;
  description: string;
  pattern: RegExp;
  /** Optional predicate to drop known-safe paths (e.g. source trees). */
  isExample?: (path: string) => boolean;
}

/**
 * Extensions that carry DATA. Source code that happens to live in a directory
 * called `output/` is not a committed artifact, so the directory rule below only
 * fires on a data file.
 */
const DATA_FILE_EXTENSIONS = [
  "csv",
  "tsv",
  "json",
  "jsonl",
  "ndjson",
  "sql",
  "log",
  "har",
  "xlsx",
  "xls",
  "parquet",
  "db",
  "sqlite",
  "sqlite3",
  "dump",
];

/** Directory names that conventionally hold the OUTPUT of a run. */
const ARTIFACT_DIRECTORIES = [
  "exports",
  "export",
  "outputs",
  "output",
  "runs",
  "results",
  "dumps",
  "artifacts",
  "snapshots",
];

/**
 * Operational output committed into the published package.
 *
 * Both rules are deliberately narrow, because a guard that cries wolf gets
 * disabled. Measured against the real packed file list, each matches the known
 * offenders and nothing else:
 *
 *   timestamped-artifact-filename — an ISO date-TIME in a filename is close to
 *     proof of a tool run; authored source files are not named after the second
 *     they were created. A bare 8-digit date or an epoch-millisecond number is
 *     deliberately NOT matched: those are indistinguishable from migration
 *     prefixes and ordinary ids.
 *
 *   committed-artifact-directory — a DATA file under exports/, output/, runs/…
 *     Source trees are exempt so that a legitimate `src/output/` module of code
 *     is not flagged.
 */
const PATH_RULES: ScanPathRule[] = [
  {
    id: "timestamped-artifact-filename",
    category: "committed-output",
    description: "Package file whose name carries a run timestamp (tool output, not a fixture)",
    pattern: /(?:^|\/)[^/]*\d{4}-\d{2}-\d{2}T\d{2}[-:]\d{2}[-:]\d{2}[^/]*$/,
  },
  {
    id: "committed-artifact-directory",
    category: "committed-output",
    description: "Data file committed under an artifact/output directory",
    pattern: new RegExp(
      `(?:^|/)(?:${ARTIFACT_DIRECTORIES.join("|")})/[^/]+\\.(?:${DATA_FILE_EXTENSIONS.join("|")})$`,
      "i",
    ),
    isExample: (path) => /(?:^|\/)src\//.test(path),
  },
];

/**
 * Scan package-relative PATHS for committed tool output. Unlike the content
 * scanners this reads nothing from disk — the path itself is the evidence. The
 * reported marker is the path verbatim: it is not sensitive, and the maintainer
 * needs it in order to delete the file.
 */
export function scanPaths(paths: string[]): ScanFinding[] {
  const findings: ScanFinding[] = [];

  for (const path of paths) {
    for (const rule of PATH_RULES) {
      if (!rule.pattern.test(path)) continue;
      if (rule.isExample?.(path)) continue;
      findings.push({
        file: path,
        // 0/0 denotes "the whole file", not a position within it.
        line: 0,
        column: 0,
        category: rule.category,
        ruleId: rule.id,
        redacted: path,
      });
    }
  }

  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.ruleId.localeCompare(b.ruleId));
}

/**
 * Produce a redacted marker for a matched value. Secret values are NEVER emitted;
 * phone numbers are reduced to their leading country context; private-context
 * matches (hostnames, paths, CLI names — not credentials) are shown verbatim so a
 * maintainer can locate and remove them.
 */
export function redactMatch(category: ScanCategory, ruleId: string, match: string): string {
  if (category === "secret-value") {
    return `[redacted secret-value:${ruleId}]`;
  }
  if (category === "pii-contact") {
    const head = match.slice(0, 2); // "+<countryDigit>"
    return `${head}${"*".repeat(Math.max(0, match.length - 2))}`;
  }
  return match;
}

function makeGlobal(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

/**
 * Scan a block of text and return redacted findings. `file` is used only for
 * reporting; it is never read from disk here.
 */
export function scanText(text: string, file = "<text>"): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const lines = text.split(/\r?\n/);

  for (const rule of SCAN_RULES) {
    const regex = makeGlobal(rule.pattern);
    for (let i = 0; i < lines.length; i++) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(lines[i])) !== null) {
        const value = match[0];
        if (value.length === 0) {
          regex.lastIndex++;
          continue;
        }
        if (rule.isExample?.(value)) continue;
        findings.push({
          file,
          line: i + 1,
          column: match.index + 1,
          category: rule.category,
          ruleId: rule.id,
          redacted: redactMatch(rule.category, rule.id, value),
        });
      }
    }
  }

  return findings.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.ruleId.localeCompare(b.ruleId),
  );
}

/**
 * Read a file and scan its contents.
 *
 * This used to skip any file whose first 8000 bytes contained a NUL, which made
 * a NUL byte a silent opt-out from secret and PII scanning: the identical
 * credential-shaped literal was caught without a NUL and passed with one. Only
 * genuinely compiled/compressed content is skipped now, decided by magic number
 * rather than by the presence of a byte, and NULs are stripped during decoding
 * so they cannot be used to break a pattern apart either.
 */
export function scanFile(path: string, reportedName = path): ScanFinding[] {
  const buffer = readFileSync(path);
  if (looksBinary(buffer)) return [];
  return scanText(decodeForScanning(buffer), reportedName);
}

/**
 * Scan a list of files. `nameFor` maps an absolute path to the name reported in
 * findings (e.g. a repo-relative or package-relative path).
 */
export function scanFiles(paths: string[], nameFor: (path: string) => string = (p) => p): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const path of paths) {
    findings.push(...scanFile(path, nameFor(path)));
  }
  return findings;
}

export interface ScanAllowlistEntry {
  /** Package-relative file path the exception applies to. */
  file: string;
  /** Rule id the exception applies to. */
  ruleId: string;
  /** Human-readable justification (shown in audits). */
  reason: string;
}

/**
 * Drop findings that match an explicit, documented allowlist entry. Matching is
 * exact on (file, ruleId) so an exception can never silently suppress a different
 * file or a different rule. Returns the surviving findings.
 */
export function applyAllowlist(findings: ScanFinding[], allowlist: ScanAllowlistEntry[]): ScanFinding[] {
  if (allowlist.length === 0) return findings;
  const allowed = new Set(allowlist.map((entry) => `${entry.file} ${entry.ruleId}`));
  return findings.filter((finding) => !allowed.has(`${finding.file} ${finding.ruleId}`));
}

/** Serialize findings as redacted JSON. Safe to print — contains no secret values. */
export function toRedactedJson(findings: ScanFinding[]): string {
  return JSON.stringify(
    {
      ok: findings.length === 0,
      count: findings.length,
      findings,
    },
    null,
    2,
  );
}
