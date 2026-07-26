import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyAllowlist,
  scanFile,
  scanFiles,
  scanPaths,
  scanText,
  toRedactedJson,
  type ScanCategory,
} from "./content-scan";

// Fake, non-real planted values assembled from fragments so this test file itself
// never contains a contiguous credential-shaped literal.
const FAKE_ANTHROPIC_KEY = ["sk", "ant", "AAAABBBBCCCC1234"].join("-");
const FAKE_GITHUB_PAT = ["ghp", "AAAABBBBCCCCDDDD1111"].join("_");
const FAKE_AWS_KEY = "AK" + "IA" + "1234567890AB";
// Jenny's number (867-5309) — famously fictional, but NOT in the 555 example block,
// so it MUST be treated as a real E.164 phone and blocked.
const PLANTED_PHONE = "+13128675309";
// A documentation example: +1 area code 555 is reserved for fiction and allowed.
const EXAMPLE_PHONE = "+15551234567";

function categories(findings: { category: ScanCategory }[]): Set<ScanCategory> {
  return new Set(findings.map((f) => f.category));
}

describe("content-scan planted fixtures MUST block", () => {
  test("blocks a fake secret token in a skill body", () => {
    const findings = scanText(`API key = ${FAKE_ANTHROPIC_KEY}\n`, "skills/leaky/SKILL.md");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].category).toBe("secret-value");
    expect(findings[0].ruleId).toBe("anthropic-api-key");
  });

  test("blocks additional credential shapes (github PAT, AWS key)", () => {
    expect(categories(scanText(`token: ${FAKE_GITHUB_PAT}`)).has("secret-value")).toBe(true);
    expect(categories(scanText(`aws: ${FAKE_AWS_KEY}`)).has("secret-value")).toBe(true);
  });

  test("blocks an E.164 phone number (PII contact)", () => {
    const findings = scanText(`call ${PLANTED_PHONE} for support`);
    expect(findings.some((f) => f.category === "pii-contact" && f.ruleId === "e164-phone")).toBe(true);
  });

  test("blocks the internal 'domains r53' CLI", () => {
    const findings = scanText("run `domains r53 list_hosted_zones` to inspect DNS");
    expect(findings.some((f) => f.category === "private-context" && f.ruleId === "internal-cli")).toBe(true);
  });

  test("blocks a private fleet hostname", () => {
    for (const host of ["spark03", "apple06", "spark01", "apple01"]) {
      const findings = scanText(`ssh into ${host} and restart the daemon`);
      expect(findings.some((f) => f.ruleId === "fleet-hostname")).toBe(true);
    }
  });

  test("blocks a home-directory path leaking an OS username", () => {
    const findings = scanText("cd /home/hasna/Workspace/thing && bun run build");
    expect(findings.some((f) => f.ruleId === "home-directory-path")).toBe(true);
  });

  test("blocks internal infra / account names", () => {
    expect(scanText("deploy to hasna-xyz-infra").some((f) => f.ruleId === "internal-infra-name")).toBe(true);
    expect(scanText("account hasna-tools").some((f) => f.ruleId === "internal-infra-name")).toBe(true);
  });
});

// An unmistakably invented person who is NOT on the synthetic-placeholder
// allowlist. Using a made-up name keeps this test file from planting a real
// person's data while still exercising the deny-by-default behaviour.
const UNAPPROVED_NAME = "Zorvax Kellstrom";

describe("content-scan blocks personal data about an identified individual", () => {
  // Regression: a CSV example in a skill README once shipped real employees'
  // names alongside their employment and maternity-leave status.
  test("blocks a name paired with an employment status in a CSV row", () => {
    const csv = `employee,employee_status,daily_hours\n${UNAPPROVED_NAME},active,8\n`;
    const findings = scanText(csv, "skills/timesheet/README.md");
    expect(findings.some((f) => f.category === "pii-personal" && f.ruleId === "person-employment-status")).toBe(true);
  });

  test("blocks a name paired with a leave/health status", () => {
    for (const status of ["on_leave_maternity", "on_leave_sick", "terminated"]) {
      const findings = scanText(`${UNAPPROVED_NAME},${status},8,0`);
      expect(findings.some((f) => f.category === "pii-personal")).toBe(true);
    }
  });

  test("blocks a name + sensitive status in a markdown table or key/value pair", () => {
    expect(
      scanText(`| ${UNAPPROVED_NAME} | on_leave_maternity |`).some((f) => f.ruleId === "person-leave-status"),
    ).toBe(true);
    expect(scanText(`${UNAPPROVED_NAME}: sick_leave`).some((f) => f.ruleId === "person-leave-status")).toBe(true);
  });

  test("blocks a personal email at a consumer mail provider", () => {
    for (const address of ["jane.doe1987@gmail.com", "someone@outlook.com", "a.person@proton.me"]) {
      const findings = scanText(`reach me at ${address}`);
      expect(findings.some((f) => f.category === "pii-contact" && f.ruleId === "personal-email")).toBe(true);
    }
  });

  test("blocks a government identifier carrying a real-looking value", () => {
    expect(scanText("ssn 078-05-1120 on file").some((f) => f.ruleId === "government-id")).toBe(true);
    expect(scanText(`passport_number: "X1234567"`).some((f) => f.ruleId === "government-id")).toBe(true);
  });

  // Review finding: the guard advertised deny-by-default, but the name half was
  // ASCII-and-comma-only, so every shape below walked straight through it. The
  // names actually removed from the timesheet README were Romanian, which makes
  // the accented spelling the single most likely next paste.
  test("blocks the record shapes a real export actually emits", () => {
    const shapes: Record<string, string> = {
      diacritics: "Zorvax Kellstrøm,on_leave_maternity,8,0",
      "hyphenated surname": "Zorvax Kell-Strom,terminated,8",
      "quoted RFC-4180 last-first": `"Kellstrom, Zorvax",on_leave_maternity,8,0`,
      // Review finding: the rule only understood the last-first spelling, which
      // needs an internal comma. Every OTHER quoted shape walked through, because
      // the closing `"` sat between the name and the delimiter. Quote-all is what
      // csv.QUOTE_ALL, Excel and most BI tools emit, so re-pasting a real CSV
      // timesheet export — the exact leak this guard exists to stop — is the one
      // recurrence path it missed.
      "quote-all, leave status": `"Zorvax Kellstrom","on_leave_maternity","8","0"`,
      "quote-all, neutral status": `"Zorvax Kellstrom","active","8","160"`,
      "quote-all last-first": `"Kellstrom, Zorvax","on_leave_maternity","8","0"`,
      "quoted name, bare status": `"Zorvax Kellstrom",active,8,160`,
      "bare name, quoted status": `Zorvax Kellstrom,"active","8","160"`,
      "semicolon-delimited EU export": "Zorvax Kellstrom;on_leave_maternity;8;0",
      "quote-all EU export": `"Zorvax Kellstrom";"on_leave_maternity";"8";"0"`,
      "middle initial": "Zorvax D Kellstrom,on_leave_maternity,8,0",
      "Title-case status": "Zorvax Kellstrom,On_Leave_Maternity,8,0",
    };
    // Assert as a map so a failure names the shape that got through.
    const blocked = Object.fromEntries(
      Object.entries(shapes).map(([shape, row]) => [shape, scanText(row).some((f) => f.category === "pii-personal")]),
    );
    expect(blocked).toEqual(Object.fromEntries(Object.keys(shapes).map((shape) => [shape, true])));
  });

  test("blocks a person-keyed record in JSON or YAML, including across lines", () => {
    // skills/timesheet/README.md advertises "Export to CSV or JSON format", so
    // re-adding the identical leak as a JSON example is a live recurrence path.
    const json = `{"employee": "${UNAPPROVED_NAME}", "employee_status": "on_leave_maternity"}`;
    expect(scanText(json).some((f) => f.ruleId === "person-record-status")).toBe(true);

    const yaml = `employee: ${UNAPPROVED_NAME}\nemployee_status: on_leave_maternity\n`;
    expect(scanText(yaml).some((f) => f.ruleId === "person-record-status")).toBe(true);

    // Either order — the status key may be written first.
    const reversed = `{"employmentStatus": "terminated", "staff_name": "${UNAPPROVED_NAME}"}`;
    expect(scanText(reversed).some((f) => f.ruleId === "person-record-status")).toBe(true);
  });

  // Review finding: the proximity window opens at the FIRST person key, so one
  // match can span two records. The allowlist check read only the first bound
  // name, so a placeholder sitting above a pasted real record suppressed the
  // whole span — and the multiline scan had already advanced past the real
  // record, so it was never re-examined. That is deny-by-default inverted: the
  // more example content a README carries, the easier it is to launder.
  test("a placeholder person record does not launder a real one beside it", () => {
    const afterPlaceholder = `employee: John Doe\nemployee: ${UNAPPROVED_NAME}\nemployee_status: on_leave_maternity\n`;
    expect(scanText(afterPlaceholder).some((f) => f.ruleId === "person-record-status")).toBe(true);

    // A schema/column-header line is enough: `employee name` is on the
    // placeholder allowlist because it shares the "Two Capitalized Words" shape.
    const afterSchemaHeader = `employee: Employee Name\nemployee: ${UNAPPROVED_NAME}\nemployee_status: active\n`;
    expect(scanText(afterSchemaHeader).some((f) => f.ruleId === "person-record-status")).toBe(true);

    // ...and the real record first, with the placeholder between it and the status.
    const beforePlaceholder = `employee: ${UNAPPROVED_NAME}\nemployee: Jane Doe\nemployee_status: terminated\n`;
    expect(scanText(beforePlaceholder).some((f) => f.ruleId === "person-record-status")).toBe(true);
  });

  test("personal-data findings never print the name or identifier", () => {
    const findings = scanText(`${UNAPPROVED_NAME},on_leave_maternity,8,0`);
    const json = toRedactedJson(findings);
    expect(json).not.toContain(UNAPPROVED_NAME);
    expect(json).not.toContain("Kellstrom");
    expect(findings[0]?.redacted).toContain("*");
  });
});

describe("content-scan does NOT false-positive on legitimate public content", () => {
  test("allows documented synthetic placeholder people", () => {
    const csv =
      "employee,employee_status,daily_hours\n" +
      "Alex Rivera,active,8\n" +
      "Sam Chen,on_leave_maternity,8\n" +
      "John Doe,terminated,8\n";
    expect(scanText(csv).some((f) => f.category === "pii-personal")).toBe(false);
  });

  test("allows documented synthetic placeholder people in a quote-all export", () => {
    // The allowlist has to survive the quoted spellings too, or teaching the rule
    // to read csv.QUOTE_ALL would fail CI on the corpus's own examples.
    const csv =
      `"employee","employee_status","daily_hours"\n` +
      `"Alex Rivera","active","8"\n` +
      `"Chen, Sam","on_leave_maternity","8"\n` +
      `"John Doe",terminated,8\n`;
    expect(scanText(csv).some((f) => f.category === "pii-personal")).toBe(false);
  });

  test("a stray quote beside a delimiter is not a field boundary", () => {
    // Regression: matching an OPTIONAL quote on either side of the delimiter —
    // rather than quoting each field as a whole — turned an ordinary source
    // literal into a three-field record, and this very file tripped its own
    // guard. A two-field row is prose or a two-column table, quoted or not.
    expect(scanText(`  "Web Server,active",`).some((f) => f.category === "pii-personal")).toBe(false);
    expect(scanText(`["Redis Cache,active", "Batch Worker,inactive"]`).some((f) => f.category === "pii-personal")).toBe(
      false,
    );
    expect(scanText(`"Web Server","active"`).some((f) => f.category === "pii-personal")).toBe(false);
  });

  test("allows a neutral status in a markdown table cell", () => {
    // Not a person — the `|` rule deliberately only covers sensitive statuses.
    expect(scanText("| Some Feature | active |")).toEqual([]);
    expect(scanText("| Legacy Runner | inactive |")).toEqual([]);
  });

  test("allows ordinary process/job/session state prose", () => {
    // Review finding: `terminated` / `suspended` / `resigned` / `probation` are
    // ordinary technical English, and `<Two Capitalized Words>: <state>` is the
    // standard shape of a status line in a README. This guard blocks every PR,
    // so a doc that describes a worker's lifecycle must not fail CI with a
    // two-character-masked marker nobody can act on.
    const prose = [
      "Process Status: suspended",
      "Connection State: terminated",
      "Session Lifecycle: terminated",
      "Container Runtime: suspended",
      "The Docker Daemon: terminated the container.",
      "| Batch Worker | terminated |",
      "| Legacy Runner | suspended |",
      "In Task Manager, active tasks are listed first.",
      "With Docker Compose, active containers restart automatically.",
      "Web Server,active",
    ];
    const flagged = prose.filter((line) => scanText(line).some((f) => f.category === "pii-personal"));
    expect(flagged).toEqual([]);
  });

  test("allows a non-person record keyed by something other than a person", () => {
    // `person-record-status` needs a PERSON key. A job or deployment record
    // carrying a status is not personal data.
    expect(scanText(`{"job": "Batch Worker", "job_status": "terminated"}`)).toEqual([]);
    expect(scanText("name: Build Docker Image\nstatus: active\n")).toEqual([]);
  });

  test("allows the project's own maintainer contact at its own domain", () => {
    // A package naming its own author is public-by-definition; only consumer
    // mailboxes belonging to third parties are blocked.
    expect(scanText("**Owner:** Hasna (dev@hasna.com)").some((f) => f.ruleId === "personal-email")).toBe(false);
    expect(scanText("author: andrei@hasna.com").some((f) => f.ruleId === "personal-email")).toBe(false);
  });

  test("allows identifier schema fields and detection regexes (definitions, not data)", () => {
    expect(scanText("  ssn: {").some((f) => f.ruleId === "government-id")).toBe(false);
    expect(scanText("  tax_id: string | null;").some((f) => f.ruleId === "government-id")).toBe(false);
  });

  test("allows a 555 documentation phone example", () => {
    const findings = scanText(`e.g. '${EXAMPLE_PHONE}'`);
    expect(findings.some((f) => f.category === "pii-contact")).toBe(false);
  });

  test("allows the public @hasnaxyz npm scope and ~/.hasna config path", () => {
    const text = "bun install -g @hasnaxyz/service-apidocs\nconfig lives in ~/.hasna/skills";
    expect(scanText(text)).toEqual([]);
  });

  test("allows generic example home paths like /home/user/", () => {
    expect(scanText("place it in /home/user/project").length).toBe(0);
  });

  test("clean prose yields no findings", () => {
    expect(scanText("This skill summarizes a transcript into bullet points.")).toEqual([]);
  });
});

describe("scanPaths blocks committed tool output", () => {
  // Regression: a real merchant product catalog, written by an actual tool run,
  // was committed under a skill's exports/ directory and published to npm.
  test("blocks a timestamped export committed under a skill", () => {
    const findings = scanPaths(["skills/consolelog/exports/products-2025-12-14T13-50-53-041Z.csv"]);
    expect(findings.some((f) => f.ruleId === "timestamped-artifact-filename")).toBe(true);
    expect(findings.some((f) => f.ruleId === "committed-artifact-directory")).toBe(true);
    expect(findings.every((f) => f.category === "committed-output")).toBe(true);
  });

  test("blocks a data file under an artifact directory even without a timestamp", () => {
    for (const path of [
      "skills/x/exports/catalog.csv",
      "skills/x/output/dump.json",
      "skills/x/runs/result.jsonl",
      "skills/x/results/scrape.sql",
    ]) {
      expect(scanPaths([path]).some((f) => f.ruleId === "committed-artifact-directory")).toBe(true);
    }
  });

  test("blocks a timestamped artifact anywhere, not just under exports/", () => {
    expect(
      scanPaths(["skills/x/report-2025-12-14T13-50-53-041Z.json"]).some(
        (f) => f.ruleId === "timestamped-artifact-filename",
      ),
    ).toBe(true);
  });

  test("reports the path verbatim so a maintainer can delete the file", () => {
    const path = "skills/x/exports/catalog.csv";
    const [finding] = scanPaths([path]);
    expect(finding.file).toBe(path);
    expect(finding.redacted).toBe(path);
    // 0/0 denotes the whole file rather than a position inside it.
    expect(finding.line).toBe(0);
  });
});

describe("scanPaths does NOT false-positive on ordinary package files", () => {
  test("allows source, docs and config", () => {
    expect(
      scanPaths([
        "skills/x/src/index.ts",
        "skills/x/package.json",
        "skills/x/README.md",
        "skills/x/tsconfig.json",
        "src/lib/content-scan.ts",
        "migrations/0001_initial.sql",
        "dist/index.js",
      ]),
    ).toEqual([]);
  });

  test("allows a source module that merely lives in an output/ directory", () => {
    // Code is not an artifact: `src/` trees are exempt from the directory rule.
    expect(scanPaths(["skills/x/src/output/formatter.ts"])).toEqual([]);
    expect(scanPaths(["skills/x/src/output/schema.json"])).toEqual([]);
  });

  test("does not match a bare date or an epoch number in a filename", () => {
    // Deliberately not matched: indistinguishable from migration prefixes and ids.
    expect(scanPaths(["migrations/20251214_add_table.sql"])).toEqual([]);
    expect(scanPaths(["skills/x/src/fixtures/1734182453000.json"])).toEqual([]);
  });
});

describe("content-scan redaction never prints raw secrets", () => {
  test("secret-value findings redact the value entirely", () => {
    const findings = scanText(`key=${FAKE_ANTHROPIC_KEY}`);
    const json = toRedactedJson(findings);
    expect(json).not.toContain(FAKE_ANTHROPIC_KEY);
    expect(json).toContain("[redacted secret-value:anthropic-api-key]");
  });

  test("phone findings mask all but the leading country context", () => {
    const findings = scanText(`ph ${PLANTED_PHONE}`);
    const phone = findings.find((f) => f.category === "pii-contact");
    expect(phone).toBeDefined();
    expect(phone?.redacted).not.toContain(PLANTED_PHONE);
    expect(phone?.redacted.startsWith("+1")).toBe(true);
    expect(phone?.redacted).toContain("*");
  });

  test("toRedactedJson reports ok:true when clean", () => {
    expect(JSON.parse(toRedactedJson([]))).toEqual({ ok: true, count: 0, findings: [] });
  });
});

describe("applyAllowlist suppresses only exact (file, ruleId) matches", () => {
  const findings = scanText(`ssh spark03\ncontact ${PLANTED_PHONE}`, "skills/x/SKILL.md");

  test("removes only the allowlisted rule for the allowlisted file", () => {
    const survivors = applyAllowlist(findings, [
      { file: "skills/x/SKILL.md", ruleId: "fleet-hostname", reason: "doc example" },
    ]);
    expect(survivors.some((f) => f.ruleId === "fleet-hostname")).toBe(false);
    expect(survivors.some((f) => f.ruleId === "e164-phone")).toBe(true);
  });

  test("does not suppress the same rule in a different file", () => {
    const survivors = applyAllowlist(findings, [
      { file: "skills/OTHER/SKILL.md", ruleId: "fleet-hostname", reason: "wrong file" },
    ]);
    expect(survivors.some((f) => f.ruleId === "fleet-hostname")).toBe(true);
  });

  test("empty allowlist is a no-op", () => {
    expect(applyAllowlist(findings, [])).toEqual(findings);
  });
});

describe("content-scan file helpers", () => {
  test("scanFile reads and scans a file; scanFiles maps reported names", () => {
    const dir = mkdtempSync(join(tmpdir(), "content-scan-"));
    try {
      const file = join(dir, "SKILL.md");
      writeFileSync(file, `contact ${PLANTED_PHONE}\n`);
      const direct = scanFile(file);
      expect(direct.some((f) => f.category === "pii-contact")).toBe(true);

      const mapped = scanFiles([file], () => "skills/x/SKILL.md");
      expect(mapped[0]?.file).toBe("skills/x/SKILL.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("binary files are skipped", () => {
    const dir = mkdtempSync(join(tmpdir(), "content-scan-bin-"));
    try {
      const file = join(dir, "blob.bin");
      writeFileSync(file, Buffer.from([0x00, 0x01, 0x02, 0x00, 0x2b, 0x31]));
      expect(scanFile(file)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
