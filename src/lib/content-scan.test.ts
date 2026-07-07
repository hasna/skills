import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyAllowlist,
  scanFile,
  scanFiles,
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

describe("content-scan does NOT false-positive on legitimate public content", () => {
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
