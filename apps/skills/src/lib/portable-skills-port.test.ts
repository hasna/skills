/**
 * `skills port` must not rewrite what the candidate declared.
 *
 * The defect these tests hold shut: an imported `kind: instruction` skill lost
 * its whole `commands` array (and its `inputs`) in port. `port` copies the
 * candidate folder verbatim, then rebuilds skill.json and merges it over the
 * copy — so anything the rebuild dropped was destroyed on disk, and the port
 * still reported `valid: true` with no issue. The manifest was left
 * self-inconsistent as well: `runtime.entrypoint` named an entry that no
 * command declared any more.
 *
 * The loss was invisible to the reporter because nothing in the port path
 * complained: the validator only *requires* commands for executable skills, and
 * `run` refuses an instruction skill before it would ever read them. A helper
 * command on an instruction skill is legitimate — skill-validation.ts permits a
 * package.json bin on one for exactly that reason — so the ported declaration
 * has to survive both the import and the validate/prepare round trip.
 *
 * Fix: ensureInstructionSkillFiles() carries the candidate's own arrays through
 * instead of hard-coding `inputs: [], commands: []`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { portPortableSkill, validatePortableSkillDirectory } from "./portable-skills.js";
import { prepareSkill } from "./prepare-skill.js";

useDefaultTestTimeout();

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A declared helper command, of the shape hasna-email-style shipped. */
const DECLARED_COMMAND = {
  name: "probe-lint",
  description: "Lint a draft.",
  entry: "scripts/probe_lint.py",
  args: ["--strict"],
};

const DECLARED_INPUT = { name: "topic", type: "string", required: true, description: "The topic." };

interface CandidateOptions {
  kind: "instruction" | "executable";
  declared: boolean;
}

/**
 * Build a candidate folder to import and an empty corpus to import it into,
 * both under a throwaway home. `homeDir` is synthetic so the authoring-path
 * guard never consults the developer's real native discovery policy.
 */
function fixture(options: CandidateOptions) {
  const root = mkdtempSync(join(tmpdir(), "skills-port-"));
  roots.push(root);
  const source = join(root, "candidate");
  const corpus = join(root, "corpus");
  mkdirSync(join(source, "scripts"), { recursive: true });
  mkdirSync(join(source, "src"), { recursive: true });
  mkdirSync(corpus, { recursive: true });

  const manifest: Record<string, unknown> = {
    $schema: "https://hasna.dev/schemas/skill.v1.json",
    standard: "hasna.skill.v1",
    name: "ported-command-fixture",
    description: "Fixture skill for the port declaration guard.",
    version: "1.2.3",
    displayName: "Ported Command Fixture",
    category: "Fixture",
    tags: ["alpha", "beta"],
    kind: options.kind,
    inputs: options.declared ? [DECLARED_INPUT] : [],
    commands: options.declared ? [DECLARED_COMMAND] : [],
    runtime: { runtime: "python3", entrypoint: "scripts/probe_lint.py", timeout: 42 },
    provenance: { source_commit: "deadbeef" },
    // A key this package does not model. The port merge must not drop it either.
    x_vendor_block: [1, 2, 3],
  };
  writeFileSync(join(source, "skill.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    join(source, "SKILL.md"),
    `---\nname: ported-command-fixture\ndescription: "Fixture skill."\nkind: ${options.kind}\nversion: 1.2.3\n---\n\n# Ported Command Fixture\n\nFixture prose.\n`,
  );
  writeFileSync(join(source, "scripts/probe_lint.py"), '#!/usr/bin/env python3\nprint("ok")\n');
  writeFileSync(join(source, "src/index.ts"), '#!/usr/bin/env bun\nconsole.log("ok");\n');
  writeFileSync(join(source, "AGENTS.md"), "# Fixture\n");
  writeFileSync(join(source, "package.json"), `${JSON.stringify({ name: "ported-command-fixture", version: "1.2.3", bin: { "probe-lint": "scripts/probe_lint.py" } }, null, 2)}\n`);

  return { root, source, corpus, homeDir: root, rootDir: corpus };
}

/** The manifest as it landed on disk — the surface the defect actually damaged. */
function portedManifest(corpus: string, name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(corpus, name, "skill.json"), "utf8"));
}

describe("skills port preserves declared commands and inputs", () => {
  test("an imported instruction skill keeps the command it declares", () => {
    const f = fixture({ kind: "instruction", declared: true });

    const result = portPortableSkill(f.source, { rootDir: f.rootDir, homeDir: f.homeDir, allowShadow: true });
    const onDisk = portedManifest(f.corpus, result.name);

    // The declaration the candidate carried, unchanged and in order.
    expect(onDisk.commands).toEqual([DECLARED_COMMAND]);
    // The returned manifest must agree with the file, or `port --json` reports a
    // declaration it did not write.
    expect(result.manifest.commands).toEqual([DECLARED_COMMAND]);
    // Same root cause, same merge: declared inputs were erased too.
    expect(onDisk.inputs).toEqual([DECLARED_INPUT]);
    expect(result.manifest.inputs).toEqual([DECLARED_INPUT]);
    // Unmodelled keys survive the rebuild-over-copy merge.
    expect(onDisk.x_vendor_block).toEqual([1, 2, 3]);
  });

  test("the ported instruction declaration survives validate and prepare", () => {
    const f = fixture({ kind: "instruction", declared: true });
    const result = portPortableSkill(f.source, { rootDir: f.rootDir, homeDir: f.homeDir, allowShadow: true });

    const validation = validatePortableSkillDirectory(result.name, result.path);
    expect(validation.issues).toEqual([]);
    expect(validation.valid).toBe(true);

    const prepared = prepareSkill(result.name, { version: "1.2.4", rootDir: f.rootDir, homeDir: f.homeDir });
    expect(prepared.written).toBe(true);
    expect(prepared.kind).toBe("instruction");

    // prepare rewrites skill.json for the new version; the declaration is not its to drop.
    const onDisk = portedManifest(f.corpus, result.name);
    expect(onDisk.commands).toEqual([DECLARED_COMMAND]);
    expect(onDisk.inputs).toEqual([DECLARED_INPUT]);

    // And the rewritten manifest still validates against the contract.
    expect(validatePortableSkillDirectory(result.name, result.path).valid).toBe(true);
  });

  test("an instruction skill that declares nothing still ports with explicit empty arrays", () => {
    // Negative control: the guard above must not be satisfied by simply never
    // writing an empty array, which is the scaffold's schema-valid shape.
    const f = fixture({ kind: "instruction", declared: false });

    const result = portPortableSkill(f.source, { rootDir: f.rootDir, homeDir: f.homeDir, allowShadow: true });
    const onDisk = portedManifest(f.corpus, result.name);

    expect(onDisk.commands).toEqual([]);
    expect(onDisk.inputs).toEqual([]);
    expect(validatePortableSkillDirectory(result.name, result.path).valid).toBe(true);
  });

  test("the executable branch still preserves its declared command", () => {
    // The sibling path was never broken; this holds it that way, so a future
    // change to the instruction branch cannot regress it by accident.
    const f = fixture({ kind: "executable", declared: true });

    const result = portPortableSkill(f.source, { rootDir: f.rootDir, homeDir: f.homeDir, allowShadow: true });
    const onDisk = portedManifest(f.corpus, result.name);

    expect(onDisk.commands).toEqual([DECLARED_COMMAND]);
    expect(onDisk.inputs).toEqual([DECLARED_INPUT]);
    expect(validatePortableSkillDirectory(result.name, result.path).valid).toBe(true);
  });
});
