import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";

// The public command boundary on the station shape: `hook install` plans and
// applies beside the Cua driver copy, and `migrate native` reports the copy as
// an explicit allowed row instead of a retirement candidate.
useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-cua-cli-"));
const entry = join(scratch, "entry.ts"), binary = join(scratch, "skills.js");
beforeAll(async () => {
  writeFileSync(entry, `import { Command } from ${JSON.stringify(require.resolve("commander"))};
import { registerAgentIntegration } from ${JSON.stringify(resolve(import.meta.dir, "commands/agent-integration.ts"))};
const program = new Command(); registerAgentIntegration(program); await program.parseAsync(process.argv);
`);
  await buildCliFixture(entry, binary);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const CUA_DOCUMENT = `---
name: cua-driver
description: Synthetic Cua driver GUI automation skill
metadata:
  version: 0.44.0
  openclaw:
    requires:
      bins:
        - cua-driver
---
# Cua Driver

Synthetic native GUI automation instructions.
`;
const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
function fixture() {
  const home = realpathSync(mkdtempSync(join(scratch, "home-"))), data = join(home, ".hasna", "skills");
  mkdirSync(data, { recursive: true });
  for (const directory of [join(home, ".cua-driver", "skills", "cua-driver"), join(home, ".claude", "skills", "cua-driver")]) {
    put(join(directory, "SKILL.md"), CUA_DOCUMENT);
    put(join(directory, "references", "usage.md"), "Synthetic Cua usage.\n");
  }
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_SKILLS_DIR: data, NO_COLOR: "1", TMPDIR: scratch };
  const run = async (args: string[]) => {
    const child = Bun.spawn([process.execPath, "--no-env-file", binary, ...args], { cwd: home, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, status };
  };
  return { home, data, run, copy: join(home, ".claude", "skills", "cua-driver") };
}

test("the real hook install and migrate native commands accept, record and report the Cua allowance", async () => {
  const f = fixture();
  const planned = await f.run(["hook", "install", "--agent", "claude", "--json"]);
  expect([planned.status, planned.stderr]).toEqual([0, ""]);
  const plan = JSON.parse(planned.stdout);
  expect(plan.applied).toBe(false);
  expect(plan.nativeSkillAllowances).toHaveLength(1);
  expect(plan.nativeSkillAllowances[0]).toMatchObject({ id: "cua-driver", agent: "claude", name: "cua-driver", path: f.copy });
  expect(plan.nativeSkills.find((item: any) => item.path === f.copy)?.allowed?.id).toBe("cua-driver");
  expect(plan.requiresNativeRetirement).toBe(false);

  const applied = await f.run(["hook", "install", "--agent", "claude", "--apply", "--json"]);
  expect([applied.status, applied.stderr]).toEqual([0, ""]);
  expect(JSON.parse(applied.stdout).applied).toBe(true);

  const reviewed = await f.run(["migrate", "native", "--agent", "claude", "--project", f.home, "--include-unmanaged", "--json"]);
  expect([reviewed.status, reviewed.stderr]).toEqual([0, ""]);
  const inventory = JSON.parse(reviewed.stdout);
  expect(inventory.applied).toBe(false);
  expect(inventory.inventory.find((item: any) => item.path === f.copy)?.allowed).toMatchObject({ id: "cua-driver" });
  expect(inventory.nativeSkillAllowances).toEqual([{ id: "cua-driver", agent: "claude", path: f.copy, treeSha256: expect.stringMatching(/^[0-9a-f]{64}$/) }]);

  // A broad --apply review leaves the allowed copy in place and archives nothing.
  const migrated = await f.run(["migrate", "native", "--agent", "claude", "--project", f.home, "--include-unmanaged", "--apply", "--json"]);
  expect([migrated.status, migrated.stderr]).toEqual([0, ""]);
  expect(JSON.parse(migrated.stdout).entries).toEqual([]);
  expect(existsSync(join(f.copy, "SKILL.md"))).toBe(true);
});
