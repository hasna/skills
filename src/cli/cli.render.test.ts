import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { useDefaultTestTimeout } from "../test-preload.js";
import { SKILLS_RENDER_MANIFEST, SKILLS_RENDER_MARKER } from "../lib/skill-render.js";
import { runCli } from "./cli.test-utils.js";

useDefaultTestTimeout();

const temporaryHomes: string[] = [];

afterEach(() => {
  for (const path of temporaryHomes.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("skills render", () => {
  test("renders merged instruction skills with marker, manifest, and verbatim auxiliary files", async () => {
    const fixture = createFixture();
    const custom = join(fixture.data, "installed", "custom-instructions");
    mkdirSync(join(custom, "references"), { recursive: true });
    mkdirSync(join(custom, "scripts"), { recursive: true });
    writeFileSync(join(custom, "SKILL.md"), instructionSkillMd("custom-instructions"));
    writeFileSync(join(custom, "references", "guide.bin"), Uint8Array.from([0, 1, 2, 255]));
    writeFileSync(join(custom, "scripts", "run.sh"), "#!/bin/sh\nprintf custom\n");
    chmodSync(join(custom, "scripts", "run.sh"), 0o751);

    const rendered = await runCli(["render", "--to", "claude", "--json"], fixture.env);
    expect(rendered.exitCode).toBe(0);
    const payload = JSON.parse(rendered.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.homes).toHaveLength(1);
    expect(payload.homes[0].rendered).toContain("custom-instructions");

    const home = join(fixture.home, ".claude", "skills");
    const skillMd = readFileSync(join(home, "custom-instructions", "SKILL.md"), "utf8");
    expect(skillMd.startsWith("---\n")).toBe(true);
    expect(skillMd).toContain(SKILLS_RENDER_MARKER);
    expect(readFileSync(join(home, "custom-instructions", "references", "guide.bin"))).toEqual(
      readFileSync(join(custom, "references", "guide.bin")),
    );
    expect(readFileSync(join(home, "custom-instructions", "scripts", "run.sh"))).toEqual(
      readFileSync(join(custom, "scripts", "run.sh")),
    );
    expect(statSync(join(home, "custom-instructions", "scripts", "run.sh")).mode & 0o777).toBe(0o751);
    expect(existsSync(join(home, "audio-extract"))).toBe(false);

    const manifest = JSON.parse(readFileSync(join(home, SKILLS_RENDER_MANIFEST), "utf8"));
    expect(manifest).toMatchObject({ version: 1, home: "claude" });
    expect(manifest.skills["custom-instructions"]).toMatchObject({
      sourceHash: expect.any(String),
      renderedHash: expect.any(String),
      provenance: { source: "custom", sourcePath: custom, version: "1.0.0" },
    });

    const checked = await runCli(["render", "--to", "claude", "--check", "--json"], fixture.env);
    expect(checked.exitCode).toBe(0);
    expect(JSON.parse(checked.stdout)).toMatchObject({
      ok: true,
      homes: [{ missing: [], drifted: [], stray: [], stale: [], errors: [] }],
    });
  });

  test("check exits non-zero and lists missing, drifted, stray, and stale entries", async () => {
    const fixture = createFixture();
    expect((await runCli(["render", "--to", "claude", "--json"], fixture.env)).exitCode).toBe(0);
    const home = join(fixture.home, ".claude", "skills");

    writeFileSync(join(home, "blog-article", "SKILL.md"), "manually changed\n");
    rmSync(join(home, "ad-creative-pack"), { recursive: true, force: true });
    mkdirSync(join(home, "my-unmanaged-skill"), { recursive: true });
    writeFileSync(join(home, "my-unmanaged-skill", "SKILL.md"), "user owned\n");
    const manifestPath = join(home, SKILLS_RENDER_MANIFEST);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.skills["email-sequence"].sourceHash = "stale-source-hash";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const checked = await runCli(["render", "--to", "claude", "--check", "--json"], fixture.env);
    expect(checked.exitCode).not.toBe(0);
    const result = JSON.parse(checked.stdout).homes[0];
    expect(result.missing).toContain("ad-creative-pack");
    expect(result.drifted).toContain("blog-article");
    expect(result.stray).toContain("my-unmanaged-skill");
    expect(result.stale).toContain("email-sequence");
  });

  test("archives explicit strays and ledger-covered removals, but refuses unknown removals", async () => {
    const fixture = createFixture();
    expect((await runCli(["render", "--to", "claude", "--json"], fixture.env)).exitCode).toBe(0);
    const home = join(fixture.home, ".claude", "skills");
    const stray = join(home, "user-skill");
    mkdirSync(stray, { recursive: true });
    writeFileSync(join(stray, "SKILL.md"), "keep me\n");

    const withoutArchive = await runCli(["render", "--to", "claude", "--json"], fixture.env);
    expect(withoutArchive.exitCode).not.toBe(0);
    expect(existsSync(stray)).toBe(true);
    expect(JSON.parse(withoutArchive.stdout).homes[0].stray).toContain("user-skill");

    const withArchive = await runCli(
      ["render", "--to", "claude", "--archive-strays", "--json"],
      fixture.env,
    );
    expect(withArchive.exitCode).toBe(0);
    expect(existsSync(stray)).toBe(false);
    const date = new Date().toISOString().slice(0, 10);
    expect(readFileSync(join(fixture.data, "archive", "claude", date, "user-skill", "SKILL.md"), "utf8"))
      .toBe("keep me\n");

    const manifestPath = join(home, SKILLS_RENDER_MANIFEST);
    const beforeUnknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    beforeUnknown.skills["unknown-old-skill"] = beforeUnknown.skills["blog-article"];
    writeFileSync(manifestPath, `${JSON.stringify(beforeUnknown, null, 2)}\n`);
    mkdirSync(join(home, "unknown-old-skill"), { recursive: true });
    writeFileSync(join(home, "unknown-old-skill", "SKILL.md"), "must survive\n");
    const manifestWithUnknown = readFileSync(manifestPath, "utf8");

    const refused = await runCli(["render", "--to", "claude", "--json"], fixture.env);
    expect(refused.exitCode).not.toBe(0);
    expect(JSON.parse(refused.stdout).error).toContain("without a rename/removal ledger entry");
    expect(existsSync(join(home, "unknown-old-skill", "SKILL.md"))).toBe(true);
    expect(readFileSync(manifestPath, "utf8")).toBe(manifestWithUnknown);

    const covered = JSON.parse(manifestWithUnknown);
    delete covered.skills["unknown-old-skill"];
    covered.skills["create-blog-article"] = covered.skills["blog-article"];
    writeFileSync(manifestPath, `${JSON.stringify(covered, null, 2)}\n`);
    rmSync(join(home, "unknown-old-skill"), { recursive: true, force: true });
    mkdirSync(join(home, "create-blog-article"), { recursive: true });
    writeFileSync(join(home, "create-blog-article", "SKILL.md"), "renamed instructions\n");

    const removed = await runCli(["render", "--to", "claude", "--json"], fixture.env);
    expect(removed.exitCode).toBe(0);
    expect(existsSync(join(home, "create-blog-article"))).toBe(false);
    expect(readFileSync(join(fixture.data, "archive", "claude", date, "create-blog-article", "SKILL.md"), "utf8"))
      .toBe("renamed instructions\n");
  });
});

function createFixture(): { home: string; data: string; env: Record<string, string> } {
  const home = mkdtempSync(join(tmpdir(), "skills-render-home-"));
  temporaryHomes.push(home);
  const data = join(home, "hasna-data");
  return { home, data, env: { HOME: home, HASNA_SKILLS_DIR: data } };
}

function instructionSkillMd(name: string): string {
  return `---\nname: ${name}\ndescription: Custom instruction fixture.\nkind: instruction\nversion: 1.0.0\n---\n\n# Custom\n\nFollow these instructions.\n`;
}
