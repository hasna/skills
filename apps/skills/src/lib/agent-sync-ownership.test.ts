import { admitCorpusFixture, corpusInspectorPathFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { corpusProcessGuardFixture } from "./codex-corpus-guard.fixture.js";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); });
type OwnershipApi = Pick<typeof import("./agent-sync.js"), "writeManagedSkillDir" | "removeManagedAgentSkill">
  & Pick<typeof import("./installer.js"), "removeSkillForAgent">;
const installed = process.env.SKILLS_SYNC_OWNERSHIP_TEST_PACKAGE;
const api: OwnershipApi = installed
  ? await import(pathToFileURL(join(installed, "dist/index.js")).href)
  : { ...await import("./agent-sync.js"), ...await import("./installer.js") };
const markerName = ".hasna-skills.json";
const markers = {
  unmarked: undefined,
  foreign: JSON.stringify({ managedBy: "another-tool" }),
  malformed: "{ invalid JSON\n",
  wrongCase: JSON.stringify({ managedBy: "@hasna/Skills" }),
  trailingSpace: JSON.stringify({ managedBy: "@hasna/skills " }),
  missingOwner: JSON.stringify({ source: "adopted" }),
  null: "null",
  directory: undefined,
  owned: JSON.stringify({ managedBy: "@hasna/skills", source: "adopted" }),
};
type MarkerKind = keyof typeof markers;
function snapshot(path: string): unknown {
  const stat = lstatSync(path);
  if (stat.isDirectory()) return [stat.mode, stat.ino, stat.mtimeMs, readdirSync(path).sort().map(name => [name, snapshot(join(path, name))])];
  if (!stat.isFile()) throw new Error("Unexpected fixture file");
  return [stat.mode, stat.ino, stat.mtimeMs, createHash("sha256").update(readFileSync(path)).digest("hex")];
}
function seed(dir: string, kind: MarkerKind, withSkill = true) {
  mkdirSync(dir, { recursive: true });
  if (withSkill) writeFileSync(join(dir, "SKILL.md"), "Existing local content\n", { mode: 0o640 });
  writeFileSync(join(dir, "keep.txt"), "Existing local resource\n", { mode: 0o600 });
  if (kind === "directory") mkdirSync(join(dir, markerName));
  else if (markers[kind] !== undefined) writeFileSync(join(dir, markerName), markers[kind]!, { mode: 0o640 });
}

async function removeInFreshHome(root: string, home: string, project: string, options: Parameters<OwnershipApi["removeSkillForAgent"]>[1]) {
  // os.homedir() may be cached by the runtime. Supply HOME before the actual
  // source/installed module loads rather than changing an already-loaded process.
  const guard = join(root, "guard.js"), denied = join(root, "denied.log");
  const inspector = join(corpusInspectorPathFixture(), "codex");
  const guardSource = corpusProcessGuardFixture(inspector, [join(home, ".codex"), join(project, ".codex")]);
  writeFileSync(guard, `import {appendFileSync} from "node:fs";import child from "node:child_process";import {syncBuiltinESMExports} from "node:module";
const deny=()=>{appendFileSync(process.env.QA_DENIED,"blocked\\n");throw Error("OWNED_INSTALLER_IO_REFUSED")};const original=globalThis.fetch;
globalThis.fetch=(input,options)=>{if(/^https?:/.test(String(input instanceof Request?input.url:input)))return Promise.reject(deny());return original(input,options)};
${guardSource}
syncBuiltinESMExports();Bun.spawn=deny;Bun.spawnSync=deny;`);
  const entry = installed ? join(installed, "dist/index.js") : join(import.meta.dir, "installer.ts");
  const script = `const api=await import(${JSON.stringify(pathToFileURL(entry).href)});const options=${JSON.stringify({ ...options, codexCommand: inspector })};
const removed=api.removeSkillForAgent("target",options);const repeated=api.removeSkillForAgent("target",options);console.log(JSON.stringify({removed,repeated}));`;
  const before = snapshot(root);
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, "-e", script], {
    cwd: project, env: { HOME: home, USERPROFILE: home, PATH: "", TMPDIR: join(root, "tmp"), HASNA_SKILLS_DIR: join(root, "data"), BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", QA_DENIED: denied },
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 10_000);
  try {
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(timedOut).toBe(false); expect(exit).toBe(0); expect(stderr).toBe(""); expect(stdout.length).toBeLessThan(1000); expect(existsSync(denied)).toBe(false);
    return { result: JSON.parse(stdout) as { removed: boolean; repeated: boolean }, before };
  } finally { clearTimeout(timer); }
}

for (const kind of Object.keys(markers) as MarkerKind[]) {
  test(`writer requires exact ownership or explicit force for ${kind} marker`, () => {
    const root = mkdtempSync(join(tmpdir(), "skills-write-ownership-"));
    try {
      const source = join(root, "source"); mkdirSync(source);
      writeFileSync(join(source, "resource.txt"), "Canonical resource\n", { mode: 0o640 });
      const sourceBefore = snapshot(source);
      for (const force of [false, true]) for (const dryRun of [true, false]) for (const withSkill of [true, false]) {
        const target = join(root, `${force}-${dryRun}-${withSkill}`); seed(target, kind, withSkill);
        const before = snapshot(root), authorized = kind === "owned" || (force && withSkill);
        const result = api.writeManagedSkillDir(target, "Canonical content\n", { skill: "owned-fixture", source: "source", resourceDir: source, force, dryRun });
        expect(result.action).toBe(authorized ? "update" : "skip");
        expect(result.path).toBe(join(target, "SKILL.md"));
        expect(snapshot(source)).toEqual(sourceBefore);
        if (!authorized || dryRun) {
          expect(snapshot(root)).toEqual(before);
          if (!authorized) expect(result.reason).toContain("unmanaged");
        } else {
          expect(readFileSync(join(target, "SKILL.md"), "utf8")).toBe("Canonical content\n");
          expect(readFileSync(join(target, "resource.txt"), "utf8")).toBe("Canonical resource\n");
          expect(existsSync(join(target, "keep.txt"))).toBe(false);
          expect(JSON.parse(readFileSync(join(target, markerName), "utf8"))).toMatchObject({ managedBy: "@hasna/skills", skill: "owned-fixture", source: "source" });
        }
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test(`removal preserves every directory without an exact owned marker: ${kind}`, () => {
    const home = mkdtempSync(join(tmpdir(), "skills-remove-ownership-"));
    try {
      const target = join(home, ".codex", "skills", "target"), unrelated = join(home, ".codex", "skills", "unrelated");
      seed(target, kind); seed(unrelated, "owned");
      admitCorpusFixture(join(home, ".codex"));
      const before = snapshot(home), unrelatedBefore = snapshot(unrelated);
      const removed = api.removeManagedAgentSkill("target", "codex", home);
      expect(removed).toBe(kind === "owned");
      expect(existsSync(target)).toBe(kind !== "owned");
      expect(snapshot(unrelated)).toEqual(unrelatedBefore);
      if (kind !== "owned") expect(snapshot(home)).toEqual(before);
      else expect(api.removeManagedAgentSkill("target", "codex", home)).toBe(false);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  for (const scope of ["project", "global"] as const) {
    test(`installer removal requires exact ownership for ${scope} ${kind} marker`, async () => {
      const root = mkdtempSync(join(tmpdir(), "skills-installer-ownership-"));
      const home = join(root, "home"), project = join(root, "project");
      try {
        mkdirSync(join(root, "tmp")); mkdirSync(join(root, "data"));
        const globalTarget = join(home, ".codex", "skills", "target"), projectTarget = join(project, ".codex", "skills", "target");
        seed(globalTarget, kind); seed(projectTarget, kind);
        admitCorpusFixture(join(home, ".codex")); admitCorpusFixture(join(project, ".codex"));
        const target = scope === "project" ? projectTarget : globalTarget;
        const other = scope === "project" ? home : project;
        const unrelated = join(scope === "project" ? project : home, ".codex", "skills", "unrelated");
        seed(unrelated, "owned");
        const otherBefore = snapshot(other), unrelatedBefore = snapshot(unrelated);
        const options = { agent: "codex" as const, scope, projectDir: project };
        const { result, before } = await removeInFreshHome(root, home, project, options);
        expect(result.removed).toBe(kind === "owned");
        expect(result.repeated).toBe(false);
        expect(existsSync(target)).toBe(kind !== "owned");
        expect(snapshot(other)).toEqual(otherBefore);
        expect(snapshot(unrelated)).toEqual(unrelatedBefore);
        if (kind !== "owned") expect(snapshot(root)).toEqual(before);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
}

if (installed) test("shared ownership predicate is not a new public package export", () => {
  expect(Object.hasOwn(api, "hasSkillsOwnershipMarker")).toBe(false);
  expect(Object.hasOwn(api, "isSkillsOwnershipMarker")).toBe(false);
});
