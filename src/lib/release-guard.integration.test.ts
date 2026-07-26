import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GUARD = join(import.meta.dir, "..", "..", "scripts", "release-guard.ts");

interface GuardResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function makePkg(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "release-guard-it-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "@hasna/skills-fixture", version: "0.0.0", files }, null, 2),
  );
  writeFileSync(join(dir, "README.md"), "# Fixture\n\nA clean readme.\n");
  return dir;
}

function addSkill(dir: string, slug: string, files: Record<string, string>): void {
  const skillDir = join(dir, "skills", slug);
  mkdirSync(skillDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const target = join(skillDir, name);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
}

function runGuard(cwd: string): GuardResult {
  const result = Bun.spawnSync(["bun", GUARD], { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

describe("release-guard end-to-end (S1 + S2)", () => {
  test("passes on a clean package", () => {
    const dir = makePkg(["skills/", "README.md"]);
    try {
      addSkill(dir, "clean-skill", {
        "SKILL.md": "---\nname: clean-skill\n---\n\n# Clean\n\nSummarizes text.\n",
        "package.json": JSON.stringify({ name: "clean-skill", skills: { visibility: "public" } }),
      });
      const result = runGuard(dir);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain("Release guard passed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("S2: blocks a package whose body leaks a phone number", () => {
    const dir = makePkg(["skills/", "README.md"]);
    try {
      addSkill(dir, "leaky", {
        "SKILL.md": "---\nname: leaky\n---\n\nCall +13128675309 for support.\n",
      });
      const result = runGuard(dir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("secrets, PII, or private context");
      expect(result.stderr).toContain("e164-phone");
      // Redacted output must not reprint the raw number.
      expect(result.stderr).not.toContain("+13128675309");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("S2: blocks a package whose body leaks a fleet hostname and internal CLI", () => {
    const dir = makePkg(["skills/", "README.md"]);
    try {
      addSkill(dir, "fleety", {
        "SKILL.md": "---\nname: fleety\n---\n\nssh spark03 then run `domains r53 list_hosted_zones`.\n",
      });
      const result = runGuard(dir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("fleet-hostname");
      expect(result.stderr).toContain("internal-cli");
      // The failure output goes to (possibly public) CI logs: it must NOT
      // re-surface the raw hostname or internal CLI verbatim — they are masked.
      expect(result.stderr).not.toContain("spark03");
      expect(result.stderr).not.toContain("domains r53");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("S1: blocks a private skill that leaks into the packed file list", () => {
    const dir = makePkg(["skills/", "README.md"]);
    try {
      addSkill(dir, "private-fleet", {
        ".private": "",
        "SKILL.md": "---\nname: private-fleet\n---\n\n# Private fleet ops\n",
      });
      const result = runGuard(dir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("private skills leaked");
      expect(result.stderr).toContain("skills/private-fleet/");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("S1: a private skill excluded via files globs does NOT trip the boundary", () => {
    const dir = makePkg(["skills/", "!skills/private-fleet", "README.md"]);
    try {
      addSkill(dir, "private-fleet", {
        ".private": "",
        "SKILL.md": "---\nname: private-fleet\n---\n\n# Private fleet ops\n",
      });
      addSkill(dir, "clean-skill", {
        "SKILL.md": "---\nname: clean-skill\n---\n\n# Clean\n",
      });
      const result = runGuard(dir);
      expect(result.exitCode, result.stderr).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("S3: blocks a hosted skill whose implementation source enters the packed file list", () => {
    const dir = makePkg(["skills/", "README.md"]);
    try {
      addSkill(dir, "hosted-thing", {
        "SKILL.md": "---\nname: hosted-thing\n---\n\n# Hosted thing\n",
        "package.json": JSON.stringify({ name: "hosted-thing", skills: { runtime: "hosted" } }),
        "src/index.ts": "export const secretSauce = 1;\n",
      });
      const result = runGuard(dir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("hosted skill implementation source leaked");
      expect(result.stderr).toContain("skills/hosted-thing/src/index.ts");
      // The printed fix must be a glob npm actually honours: a one-element
      // `{slug}` brace is inert under `npm pack`, so the bare form is emitted.
      expect(result.stderr).toContain("!skills/hosted-thing/src");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("S3: a hosted skill whose src is excluded via files globs does NOT trip the boundary", () => {
    const dir = makePkg(["skills/", "!skills/hosted-thing/src", "README.md"]);
    try {
      addSkill(dir, "hosted-thing", {
        "SKILL.md": "---\nname: hosted-thing\n---\n\n# Hosted thing\n",
        "package.json": JSON.stringify({ name: "hosted-thing", skills: { runtime: "hosted" } }),
        "src/index.ts": "export const secretSauce = 1;\n",
      });
      const result = runGuard(dir);
      expect(result.exitCode, result.stderr).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
