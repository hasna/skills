/**
 * content-scan.ts — scans skill BODIES (not just package.json/README) for content
 * that must never ship in the public @hasna/skills package.
 *
 * Five finding categories:
 *   - secret-value:     credential-shaped values (API keys, tokens, private keys)
 *   - pii-contact:      personal contact PII (E.164 phone numbers, consumer-provider
 *                       email addresses)
 *   - pii-personal:     personal data ABOUT an identified individual — a real human
 *                       name paired with employment/HR/leave/health status, or a
 *                       government identifier carrying a real-looking value
 *   - private-context:  internal/operational context that leaks the private fleet
 *                       (fleet hostnames, home-directory paths with a real user,
 *                       internal CLI invocations, internal infra/product names)
 *   - committed-output: operational tool output committed into the package — a
 *                       run artifact (timestamped filename, data file under an
 *                       exports/ directory) rather than an authored fixture
 *
 * The first four categories are matched against file CONTENT (see {@link scanText}).
 * `committed-output` is matched against the package-relative PATH instead (see
 * {@link scanPaths}), because what makes an artifact wrong is where it came from,
 * not what is inside it — a scraped catalog and a hand-written fixture can be
 * byte-identical in shape.
 *
 * All output is REDACTED: secret values are never emitted, phone numbers, emails and
 * personal names are masked, and only the rule id + a safe redacted marker are
 * reported. Findings are surfaced in (potentially public) CI logs, so a rule must
 * never echo the personal data it just found.
 */

import { readFileSync } from "node:fs";
import { decodeForScanning, looksBinary } from "./file-bytes.js";

export type ScanCategory =
  | "secret-value"
  | "pii-contact"
  | "pii-personal"
  | "private-context"
  | "committed-output";

export interface ScanRule {
  category: ScanCategory;
  /** Stable, human-readable rule id (safe to print — never a secret value). */
  id: string;
  description: string;
  pattern: RegExp;
  /** Optional predicate to drop known-safe example matches (e.g. 555 phone numbers). */
  isExample?: (match: string) => boolean;
  /**
   * Match against the whole text rather than line by line. Needed for record
   * shapes whose fields sit on DIFFERENT lines — a YAML export writes the
   * person on one line and the status on the next, and a per-line regex can
   * never see that pairing.
   */
  multiline?: boolean;
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
 * Leave and HR states that are unambiguously ABOUT A PERSON. Nothing but a
 * human is `on_leave_maternity` or `furloughed`, so a rule may pair one of
 * these with a name in a loose shape (a markdown cell, a `key: value` line)
 * without needing further evidence that the subject is a person.
 */
const LEAVE_STATUS_TOKENS = [
  "on_leave_maternity",
  "on_leave_paternity",
  "on_leave_parental",
  "on_leave_sick",
  "on_leave",
  "maternity_leave",
  "paternity_leave",
  "parental_leave",
  "bereavement_leave",
  "medical_leave",
  "unpaid_leave",
  "sick_leave",
  "laid_off",
  "furloughed",
  "dismissed",
];

/**
 * States that are sensitive about a person but are ALSO ordinary technical
 * English about a process, job, container or session: `Process Status:
 * suspended`, `| Batch Worker | terminated |`, `Connection State: terminated`.
 *
 * They stay in the record vocabulary below, where the surrounding CSV/record
 * shape supplies the evidence that the subject is a person, and are kept out of
 * the loose `|` / `:` rule on purpose. This guard is a blocking check on every
 * pull request, and in a repo of skill READMEs that document workers, sessions
 * and daemons, a rule that fails CI for describing a job's lifecycle — with a
 * two-character-masked marker and no way to see what tripped it — is a rule
 * that gets switched off.
 */
const AMBIGUOUS_STATUS_TOKENS = ["terminated", "suspended", "resigned", "probation", "redundant"];

/**
 * The full employment-status vocabulary: the states above plus neutral ones. A
 * neutral status is still personal data once it is attached to a named
 * individual ("<real person>,active" discloses where someone works), so the
 * record rules below match the whole vocabulary.
 */
const EMPLOYMENT_STATUS_TOKENS = [
  ...LEAVE_STATUS_TOKENS,
  ...AMBIGUOUS_STATUS_TOKENS,
  "contractor",
  "part_time",
  "full_time",
  "salaried",
  "inactive",
  "retired",
  "active",
];

/**
 * Obviously-fictional placeholder people. Example content in the public corpus MUST
 * use one of these (or another clearly-invented name added here during review)
 * rather than a real person. This allowlist is what makes the person rules
 * DENY-BY-DEFAULT: any NEW name paired with an employment status fails the guard
 * until it is either replaced with a placeholder or consciously added here. That is
 * deliberate — a denylist of known real names could never stop the next person's
 * name from being pasted into an example.
 */
const SYNTHETIC_PERSON_NAMES = new Set([
  "alex rivera",
  "sam chen",
  "jordan lee",
  "taylor kim",
  "casey morgan",
  "riley parker",
  "john doe",
  "jane doe",
  "john smith",
  "jane smith",
  "john roe",
  "jane roe",
  "demo user",
  "example user",
  "sample user",
  "test user",
  // Column headers and placeholder tokens that share the "Two Capitalized Words" shape.
  "display name",
  "employee name",
  "first last",
  "full name",
  "your name",
]);

/**
 * One part of a personal name. Unicode-aware on purpose: the data this guard
 * exists to keep out was Romanian, so an ASCII-only `[A-Z][a-z]+` would sail
 * past the most likely next paste. A hyphen or apostrophe is part of a surname
 * (`García-Lopez`, `O'Brien`), not a boundary. Must start upper and end lower,
 * so a CamelCase identifier (`TaskManager`) cannot pose as two names.
 */
const NAME_PART = String.raw`\p{Lu}(?:\p{Ll}|['’-]\p{Lu}?)*\p{Ll}`;

/** A middle name abbreviated to an initial: `D` or `D.`. */
const NAME_INITIAL = String.raw`\p{Lu}\.?`;

/** Not preceded by another letter or digit — a Unicode-aware `\b`. */
const NAME_BOUNDARY = String.raw`(?<![\p{L}\p{N}_])`;

/** A personal name: two or three parts, a middle one possibly an initial. */
const PERSON_NAME_CORE = `${NAME_PART}(?: (?:${NAME_PART}|${NAME_INITIAL})){1,2}`;
const PERSON_NAME_SOURCE = `${NAME_BOUNDARY}${PERSON_NAME_CORE}`;

/** `"Last, First"` — one person written backwards inside one RFC-4180 field. */
const QUOTED_PERSON_NAME_SOURCE = `"${NAME_PART}, *${NAME_PART}(?: ${NAME_PART})?"`;

/** The field delimiters a real timesheet export uses (EU exports use `;`). */
const RECORD_DELIMITER = String.raw`[,;\t]`;

/**
 * Spell a literal token so it matches in ANY case without an `i` flag. The flag
 * is not usable here: it would also relax the capitalized-name half of these
 * patterns, and the capitalization is what makes a name a name. Building only
 * lowercase and UPPER_CASE variants was not enough either — `On_Leave_Maternity`
 * is a spelling real exports emit.
 */
function anyCase(token: string): string {
  return [...token]
    .map((char) => {
      const lower = char.toLowerCase();
      const upper = char.toUpperCase();
      return lower === upper ? char : `[${lower}${upper}]`;
    })
    .join("");
}

/**
 * Build a status alternation, longest token first so the regex prefers the most
 * specific match.
 */
function statusAlternation(tokens: string[]): string {
  return [...tokens]
    .sort((a, b) => b.length - a.length)
    .map(anyCase)
    .join("|");
}

const QUOTED_LAST_FIRST = new RegExp(`"(${NAME_PART}), *(${NAME_PART}(?: ${NAME_PART})?)"`, "gu");
const NAME_CANDIDATE = new RegExp(PERSON_NAME_SOURCE, "u");

/**
 * The person a match is about, normalized for the placeholder allowlist. The
 * name is not always the first delimited field: an RFC-4180 export quotes it as
 * `"Last, First"`, which is one person, not two fields.
 */
function personNameFromMatch(match: string): string {
  const normalized = match.replace(QUOTED_LAST_FIRST, (_all, last, first) => `${first} ${last}`);
  return NAME_CANDIDATE.exec(normalized)?.[0].trim().toLowerCase() ?? "";
}

const isSyntheticPerson = (match: string): boolean =>
  SYNTHETIC_PERSON_NAMES.has(personNameFromMatch(match));

/**
 * Personal contact PII.
 *
 * E.164 phone numbers are word-boundaried so we don't match inside longer digit
 * runs (hashes, ids). North-American (+1) numbers with a 555 area code are treated
 * as documentation examples and ignored.
 *
 * The email rule targets CONSUMER mail providers only. A project naming its own
 * maintainer contact at its own domain is public-by-definition and intentionally
 * NOT matched; what must never ship is a third party's personal mailbox.
 */
const PII_RULES: ScanRule[] = [
  {
    id: "e164-phone",
    category: "pii-contact",
    description: "E.164 phone number",
    pattern: /(?<![\d+])\+[1-9]\d{7,14}(?!\d)/,
    isExample: (match) => /^\+1555/.test(match),
  },
  {
    id: "personal-email",
    category: "pii-contact",
    description: "Personal email address at a consumer mail provider",
    pattern:
      /\b[A-Za-z0-9._%+-]+@(?:gmail|googlemail|outlook|hotmail|yahoo|ymail|icloud|protonmail|proton|aol|gmx|yandex)\.[a-z]{2,}\b/i,
  },
];

/**
 * Keys that name a PERSON specifically. Deliberately excludes bare `name`,
 * which labels workflow steps, packages and everything else.
 */
const PERSON_KEY_SOURCE = String.raw`["']?(?:employee_name|employeeName|employee|staff_name|staffName|staff|person_name|personName|person|full_name|fullName)["']?`;

/** Any `*status` / `*Status` key: `employee_status`, `employmentStatus`, `status`. */
const STATUS_KEY_SOURCE = String.raw`["']?[A-Za-z_]{0,20}[sS]tatus["']?`;

/** How far apart two fields of the same record may sit — roughly a few lines. */
const RECORD_PROXIMITY = 200;

const PERSON_KEY_VALUE_SOURCE = `${PERSON_KEY_SOURCE} *[:=] *["']?(${PERSON_NAME_CORE})`;
const STATUS_KEY_VALUE_SOURCE = `${STATUS_KEY_SOURCE} *[:=] *["']?(?:${statusAlternation(EMPLOYMENT_STATUS_TOKENS)})\\b`;

const PERSON_KEY_VALUE = new RegExp(PERSON_KEY_VALUE_SOURCE, "u");

/** The allowlist check for `person-record-status`: the name bound to the person key. */
const isSyntheticPersonRecord = (match: string): boolean => {
  const name = PERSON_KEY_VALUE.exec(match)?.[1];
  return name !== undefined && SYNTHETIC_PERSON_NAMES.has(name.toLowerCase());
};

/**
 * Personal data ABOUT an identified individual.
 *
 * `person-employment-status` matches the CSV / TSV / semicolon record shape that
 * produced the original leak — a personal name, a delimiter, then an employment
 * status. A NEUTRAL status additionally requires a third field, because two
 * comma-separated fields are also the shape of ordinary prose (`In Task Manager,
 * active tasks are listed first.`) and of a two-column table row (`Web
 * Server,active`); a leave/HR status needs no such corroboration.
 *
 * `person-leave-status` covers table and key/value shapes (`|`, `:`), which
 * carry no record structure at all, so it is restricted to the leave/HR
 * vocabulary. The tokens that double as process states (`terminated`,
 * `suspended`, …) are excluded here on purpose — see AMBIGUOUS_STATUS_TOKENS.
 *
 * `person-record-status` covers the JSON and YAML export shapes, where the name
 * and the status are separate keys of one record rather than two adjacent
 * fields — including across lines, which is why it scans the whole text. The
 * timesheet skill documents "Export to CSV or JSON format", so a JSON example is
 * exactly as likely a recurrence path as the CSV one that leaked.
 *
 * `government-id` requires a real-LOOKING value: a bare `ssn:` schema field or a
 * detection regex inside a scanner skill is a definition, not somebody's data, and
 * must not trip the guard.
 */
const PII_PERSONAL_RULES: ScanRule[] = [
  {
    id: "person-employment-status",
    category: "pii-personal",
    description: "Personal name paired with an employment/HR status in a CSV/TSV record",
    pattern: new RegExp(
      `(?:${PERSON_NAME_SOURCE}|${QUOTED_PERSON_NAME_SOURCE}) *${RECORD_DELIMITER} *(?:` +
        `(?:${statusAlternation(EMPLOYMENT_STATUS_TOKENS)})\\b *${RECORD_DELIMITER}` +
        `|(?:${statusAlternation(LEAVE_STATUS_TOKENS)})\\b)`,
      "u",
    ),
    isExample: isSyntheticPerson,
  },
  {
    id: "person-leave-status",
    category: "pii-personal",
    description: "Personal name paired with a leave or HR status",
    pattern: new RegExp(`${PERSON_NAME_SOURCE} *[|:] *(?:${statusAlternation(LEAVE_STATUS_TOKENS)})\\b`, "u"),
    isExample: isSyntheticPerson,
  },
  {
    id: "person-record-status",
    category: "pii-personal",
    description: "Personal name in a person-keyed record alongside an employment status (JSON/YAML)",
    multiline: true,
    pattern: new RegExp(
      `(?:${PERSON_KEY_VALUE_SOURCE}[\\s\\S]{0,${RECORD_PROXIMITY}}?${STATUS_KEY_VALUE_SOURCE}` +
        `|${STATUS_KEY_VALUE_SOURCE}[\\s\\S]{0,${RECORD_PROXIMITY}}?${PERSON_KEY_VALUE_SOURCE})`,
      "u",
    ),
    isExample: isSyntheticPersonRecord,
  },
  {
    id: "government-id",
    category: "pii-personal",
    description: "Government identifier carrying a real-looking value",
    pattern: new RegExp(
      [
        // US SSN shape.
        String.raw`(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])`,
        // A labelled identifier assigned an actual value (not a type or a regex).
        String.raw`\b(?:ssn|cnp|national_id|nationalId|passport_number|passportNumber|tax_id|taxId)\b *[:=] *["'][A-Za-z0-9][A-Za-z0-9 .-]{5,}["']`,
      ].join("|"),
    ),
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
  ...PII_PERSONAL_RULES,
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
 * PII (phone numbers, emails, personal names and identifiers) keeps only a short
 * two-character locating prefix; private-context matches (hostnames, paths, CLI
 * names — not credentials) are shown verbatim so a maintainer can locate and
 * remove them.
 *
 * Personal data must be masked here as well as elsewhere: findings are printed
 * into (potentially public) CI logs, so reporting a leaked name in full would
 * republish the very data the rule exists to catch. The rule id plus file:line is
 * enough for a maintainer to find it in the working tree.
 */
export function redactMatch(category: ScanCategory, ruleId: string, match: string): string {
  if (category === "secret-value") {
    return `[redacted secret-value:${ruleId}]`;
  }
  if (category === "pii-contact" || category === "pii-personal") {
    const head = match.slice(0, 2); // "+<countryDigit>" / first two chars of a name
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

    if (rule.multiline) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const value = match[0];
        if (value.length === 0) {
          regex.lastIndex++;
          continue;
        }
        if (rule.isExample?.(value)) continue;
        // Line/column are derived from the offset so a whole-text rule reports
        // the same coordinates a per-line rule would.
        const before = text.slice(0, match.index);
        const lastBreak = before.lastIndexOf("\n");
        findings.push({
          file,
          line: before.length === 0 ? 1 : before.split(/\r?\n/).length,
          column: match.index - lastBreak,
          category: rule.category,
          ruleId: rule.id,
          redacted: redactMatch(rule.category, rule.id, value),
        });
      }
      continue;
    }

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
  // Composite key. The separator is NUL because it cannot appear in a path or a
  // rule id, so the key is unambiguous. It MUST be written as the escape sequence:
  // a raw NUL byte here makes grep treat this whole file as binary and silently
  // report no matches, which hid this module from two reviewers.
  const allowed = new Set(allowlist.map((entry) => `${entry.file}\0${entry.ruleId}`));
  return findings.filter((finding) => !allowed.has(`${finding.file}\0${finding.ruleId}`));
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
