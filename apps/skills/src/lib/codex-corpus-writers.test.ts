import { applyAgentIntegration, planAgentIntegration, archiveNativeSkills, inventoryNativeSkills } from "./agent-integration.js";
import { connectCodexHookRpc } from "./codex-hook-rpc.js";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { corpusFixture, assertPublication } from "./codex-corpus.fixture.js";
import { KernelLock } from "@hasna/contracts/kernel-lock";
import { removeManagedAgentSkill, writeManagedSkillDir } from "./agent-sync.js";

const fixtures: string[] = [];
afterEach(() => { for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "codex-writer-")); fixtures.push(home);
  const root = join(home, ".codex"), dir = join(root, "skills", "sample");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "SKILL.md"), "original\n", { mode: 0o600 });
  writeFileSync(join(dir, ".hasna-skills.json"), JSON.stringify({ managedBy: "@hasna/skills", skill: "sample" }), { mode: 0o600 });
  return { home, root, dir };
}

describe("Codex corpus writer exclusion", () => {
  test("a publication descriptor excludes the real managed skill replacement", () => {
    const { root, dir } = fixture();
    const publication = new KernelLock(root, ".native-corpus-admission");
    try {
      expect(publication.trySync(1000)).toBe(true);
      expect(() => writeManagedSkillDir(dir, "replacement\n", { skill: "sample" })).toThrow("CODEX_CORPUS");
      expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toBe("original\n");
    } finally { publication.close(); }
  });
  test("a publication descriptor excludes the direct managed skill removal", () => {
    const { home, root, dir } = fixture();
    const publication = new KernelLock(root, ".native-corpus-admission");
    try {
      expect(publication.trySync(1000)).toBe(true);
      expect(() => removeManagedAgentSkill("sample", "codex", home)).toThrow("CODEX_CORPUS");
      expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toBe("original\n");
    } finally { publication.close(); }
  });
});

test("managed replacement holds admission through rollback and preserves the original", () => {
  const f = corpusFixture(), dir = join(f.root, "skills", "sample");
  mkdirSync(dir, {recursive:true,mode:0o700});
  writeFileSync(join(dir,"SKILL.md"),"original\n");
  writeFileSync(join(dir,".hasna-skills.json"),JSON.stringify({managedBy:"@hasna/skills",skill:"sample"}));
  let renames=0;
  expect(()=>writeManagedSkillDir(dir,"replacement\n",{skill:"sample",...f.options,renameDirectory:(from,to)=>{
    assertPublication(f.root,false);renames++;
    if (renames===2) throw new Error("synthetic commit failure");
    renameSync(from,to);
  }})).toThrow("synthetic commit failure");
  expect(renames).toBe(3);expect(readFileSync(join(dir,"SKILL.md"),"utf8")).toBe("original\n");
  assertPublication(f.root,true);
});
test("admitted managed replacement and removal complete, then release publication",()=>{
  const f=corpusFixture(),dir=join(f.root,"skills","sample");
  expect(writeManagedSkillDir(dir,"hello\n",{skill:"sample",...f.options}).action).toBe("create");
  expect(readFileSync(join(dir,"SKILL.md"),"utf8")).toBe("hello\n");
  expect(removeManagedAgentSkill("sample","codex",f.home,f.options)).toBe(true);
  assertPublication(f.root,true);
});
test("non-Codex skill directories remain usable without native admission",()=>{
  const f=corpusFixture(false),dir=join(f.home,".claude/skills/sample");
  expect(writeManagedSkillDir(dir,"hello\n",{skill:"sample",codexCommand:"/not-installed"}).action).toBe("create");
});

test("native hook RPC close waits for child close while holding shared admission",async()=>{
  const f=corpusFixture();const rpc=await connectCodexHookRpc({command:f.command,home:f.home,codexHome:f.root});
  const closing=rpc.close();assertPublication(f.root,false);await closing;assertPublication(f.root,true);
});


test("native config application and skill archival refuse publication then complete under admission",()=>{
  const f=corpusFixture(),dataDir=join(f.home,"data");
  writeFileSync(join(f.root,"config.toml"),"[skills.bundled]\nenabled = false\n",{mode:0o600});
  const plan=planAgentIntegration({home:f.home,dataDir,agents:["codex"],command:"skills",profileId:"fleet",projectDir:f.home});
  const publication=new KernelLock(f.root,".native-corpus-admission",{existingOnly:true});
  try {
    expect(publication.trySync(1000)).toBe(true);
    expect(()=>applyAgentIntegration(plan,f.options)).toThrow("CODEX_CORPUS");
  } finally {publication.close();}
  expect(applyAgentIntegration(plan,f.options).changed.length).toBeGreaterThan(0);
  assertPublication(f.root,true);
  const dir=join(f.root,"skills","archival-fixture");mkdirSync(dir,{recursive:true,mode:0o700});
  writeFileSync(join(dir,"SKILL.md"),"---\nname: archival-fixture\ndescription: synthetic archival test\n---\nFixture\n",{mode:0o600});
  const inventory=inventoryNativeSkills(f.home,{agents:["codex"],projectDir:f.home}).filter(row=>row.path===dir);
  expect(inventory).toHaveLength(1);
  const blocker=new KernelLock(f.root,".native-corpus-admission",{existingOnly:true});
  try {
    expect(blocker.trySync(1000)).toBe(true);
    expect(()=>archiveNativeSkills(inventory,{dataDir,includeUnmanaged:true,...f.options})).toThrow("CODEX_CORPUS");
    expect(readFileSync(join(dir,"SKILL.md"),"utf8")).toContain("Fixture");
  } finally {blocker.close();}
  const result=archiveNativeSkills(inventory,{dataDir,includeUnmanaged:true,...f.options});
  expect(result.entries).toHaveLength(1);
  expect(readFileSync(join(result.entries[0]!.archive,"SKILL.md"),"utf8")).toContain("Fixture");
  assertPublication(f.root,true);
});
