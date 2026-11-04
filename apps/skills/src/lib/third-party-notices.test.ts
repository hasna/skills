import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanText } from "./content-scan.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

// SH-00058. The release guard exempts a personal-email finding in
// THIRD_PARTY_NOTICES only inside an entry byte-identical to what the bundled
// package's own licence file produces, read afresh; nothing else is exempt.
const { renderNotices, verifiedNoticeLineSpans, exemptVerifiedNoticeEmails, NOTICES_FILE } = await import(join(import.meta.dir, "../../scripts/third-party-notices.ts"));
const root = mkdtempSync(join(tmpdir(), "skills-third-party-notices-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
mkdirSync(join(root, "bin")); mkdirSync(join(root, "node_modules", "fixture-licensed"), { recursive: true });
writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@hasna/skills", version: "0.0.1" }));
writeFileSync(join(root, "bin", "index.js"), "// node_modules/fixture-licensed/index.js\nexport {};\n");
writeFileSync(join(root, "node_modules", "fixture-licensed", "package.json"), JSON.stringify({ name: "fixture-licensed", version: "2.0.0", license: "MIT" }));
writeFileSync(join(root, "node_modules", "fixture-licensed", "LICENSE"), "MIT License\n\nCopyright (c) Fixture Author <fixture.author@gmail.com>\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.\n");
const shipped = renderNotices(root) as string;
const remaining = (text: string) => exemptVerifiedNoticeEmails(scanText(text, NOTICES_FILE).filter(finding => finding.ruleId === "personal-email"), verifiedNoticeLineSpans(root, text));

test("an author's email inside an entry identical to the package's own licence file is exempt", () => {
  expect(scanText(shipped, NOTICES_FILE).filter(finding => finding.ruleId === "personal-email")).toHaveLength(1);
  expect(remaining(shipped)).toEqual([]);
});

test("an email injected outside any entry still fails", () => {
  expect(remaining(shipped.replace("Each is listed", "Write to someone.fixture@gmail.com. Each is listed"))).toHaveLength(1);
  expect(remaining(`${shipped}\n${"=".repeat(80)}\nfixture-injected 1.0.0\nLicense: MIT\n\nCopyright (c) Someone <someone.fixture@gmail.com>\n`)).toHaveLength(1);
});

test("one changed byte inside an entry removes its exemption", () => {
  expect(remaining(shipped.replace("free of charge", "free of chargE"))).toHaveLength(1);
  expect(remaining(shipped.replace("fixture.author@gmail.com", "fixture.authoR@gmail.com"))).toHaveLength(1);
});

test("a package root the guard cannot render exempts nothing", () => {
  expect(verifiedNoticeLineSpans(join(root, "missing"), shipped)).toEqual([]);
});
