import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { describe, expect, test, afterEach, beforeEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { lstatSync, renameSync, symlinkSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SYNC_MARKER_FILE, SYNC_MARKER_MANAGED_BY, type SyncMarker } from "./agent-sync.js";
import { INSTALLED_SKILLS_DIRNAME } from "./config.js";
import {
  CONFLICTS_LEDGER_FILE,
  ROLLBACK_DIRNAME,
  adoptUnmarkedHomes,
  pruneStrayHomes,
  scanUnmarkedHomes,
  type HomeConflict,
} from "./home-adoption.js";
import { hashSkillMarkdown } from "./skill-hash.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

/**
 * Unmarked-home adoption: hash each unmarked home SKILL.md against the
 * canonical corpus; exact match -> marker + adopt, differs -> conflicts ledger
 * + skip, no canonical entry -> unknown + skip. Dry-run by default; --apply
 * writes markers. Prune removes only marked-and-stray dirs, recorded before
 * removal. Nothing is ever deleted by adoption.
 */

const created: string[] = [];
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "skills-adoption-home-"));
  created.push(dir);
  admitCorpusFixture(join(dir, ".codex"));
  return dir;
}

function corpusDir(home: string): string {
  return join(home, ".hasna", "skills", INSTALLED_SKILLS_DIRNAME);
}

function writeSkillMd(dir: string, content: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), content);
}

const SKILL_CONTENT = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\n\n# ${name}\nbody\n`;

afterEach(() => {
  restoreInspector();
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function readMarker(dir: string): SyncMarker {
  return JSON.parse(readFileSync(join(dir, SYNC_MARKER_FILE), "utf-8")) as SyncMarker;
}

describe("scanUnmarkedHomes", () => {
  test("exact match (modulo user_invocable) is adoptable; claude-style copies match canonical", () => {
    const home = tempHome();
    const corpus = corpusDir(home);
    writeSkillMd(join(corpus, "alpha"), SKILL_CONTENT("alpha"));
    // A claude home copy carries user_invocable; the canonical one does not.
    const claudeCopy = SKILL_CONTENT("alpha").replace("description:", "user_invocable: true\ndescription:");
    writeSkillMd(join(home, ".claude", "skills", "alpha"), claudeCopy);
    // A codex home copy had user_invocable stripped by sed — identical bytes.
    writeSkillMd(join(home, ".codex", "skills", "alpha"), SKILL_CONTENT("alpha"));

    const scan = scanUnmarkedHomes({ homeDir: home });

    expect(scan.adoptable.map((entry) => `${entry.agent}/${entry.skill}`).sort()).toEqual([
      "claude/alpha",
      "codex/alpha",
    ]);
    expect(scan.conflicts).toEqual([]);
    expect(scan.unknown).toEqual([]);
  });

  test("content differs -> conflict entry with home hash, canonical hash and mtime", () => {
    const home = tempHome();
    const corpus = corpusDir(home);
    writeSkillMd(join(corpus, "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(home, ".claude", "skills", "alpha"), SKILL_CONTENT("alpha") + "drift\n");

    const scan = scanUnmarkedHomes({ homeDir: home });

    expect(scan.adoptable).toEqual([]);
    expect(scan.conflicts).toHaveLength(1);
    const conflict = scan.conflicts[0] as HomeConflict;
    expect(conflict.agent).toBe("claude");
    expect(conflict.skill).toBe("alpha");
    expect(conflict.hash).toBe(hashSkillMarkdown(SKILL_CONTENT("alpha") + "drift\n"));
    expect(conflict.canonicalHash).toBe(hashSkillMarkdown(SKILL_CONTENT("alpha")));
    expect(conflict.mtime).toBeTruthy();
  });

  test("no canonical entry -> unknown and skipped", () => {
    const home = tempHome();
    writeSkillMd(join(home, ".claude", "skills", "orphan"), SKILL_CONTENT("orphan"));

    const scan = scanUnmarkedHomes({ homeDir: home });

    expect(scan.adoptable).toEqual([]);
    expect(scan.unknown.map((entry) => entry.skill)).toEqual(["orphan"]);
  });

  test("marked dirs are counted as managed, never re-scanned", () => {
    const home = tempHome();
    const corpus = corpusDir(home);
    writeSkillMd(join(corpus, "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(home, ".claude", "skills", "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(home, ".claude", "skills", "managed-only"), SKILL_CONTENT("managed-only"));
    writeFileSync(join(home, ".claude", "skills", "managed-only", SYNC_MARKER_FILE), JSON.stringify({ managedBy: SYNC_MARKER_MANAGED_BY }));

    const scan = scanUnmarkedHomes({ homeDir: home });

    expect(scan.managed).toBe(1);
    expect(scan.adoptable.map((entry) => entry.skill)).toEqual(["alpha"]);
  });

  test("unmarked dirs without SKILL.md are never touched or reported", () => {
    const home = tempHome();
    const corpus = corpusDir(home);
    writeSkillMd(join(corpus, "alpha"), SKILL_CONTENT("alpha"));
    mkdirSync(join(home, ".claude", "skills", "empty-dir"), { recursive: true });

    const scan = scanUnmarkedHomes({ homeDir: home });

    expect(scan.adoptable).toEqual([]);
    expect(scan.unknown).toEqual([]);
  });
});

describe("adoptUnmarkedHomes", () => {
  test("dry-run writes no marker, no ledger, no rollback record", () => {
    const home = tempHome();
    const corpus = corpusDir(home);
    writeSkillMd(join(corpus, "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(home, ".claude", "skills", "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(home, ".claude", "skills", "beta"), SKILL_CONTENT("beta") + "drift\n");
    writeSkillMd(join(corpus, "beta"), SKILL_CONTENT("beta"));

    const result = adoptUnmarkedHomes({ homeDir: home });

    expect(result.applied).toBe(false);
    expect(result.rollbackFile).toBeUndefined();
    expect(existsSync(join(home, ".claude", "skills", "alpha", SYNC_MARKER_FILE))).toBe(false);
    expect(existsSync(join(home, ".hasna", "skills", CONFLICTS_LEDGER_FILE))).toBe(false);
    expect(existsSync(join(home, ".hasna", "skills", ROLLBACK_DIRNAME))).toBe(false);
    // The skill content itself is untouched either way.
    expect(readFileSync(join(home, ".claude", "skills", "beta", "SKILL.md"), "utf-8")).toContain("drift");
  });

  test("apply writes markers for exact matches, lands divergers in the ledger, skips both", () => {
    const home = tempHome();
    const corpus = corpusDir(home);
    writeSkillMd(join(corpus, "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(corpus, "beta"), SKILL_CONTENT("beta"));
    writeSkillMd(join(home, ".claude", "skills", "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(home, ".claude", "skills", "beta"), SKILL_CONTENT("beta") + "drift\n");
    writeSkillMd(join(home, ".claude", "skills", "orphan"), SKILL_CONTENT("orphan"));

    const result = adoptUnmarkedHomes({ homeDir: home, apply: true });

    expect(result.applied).toBe(true);
    // alpha: marker written; beta (diverged) and orphan (unknown): untouched.
    const marker = readMarker(join(home, ".claude", "skills", "alpha"));
    expect(marker.managedBy).toBe(SYNC_MARKER_MANAGED_BY);
    expect(marker.skill).toBe("alpha");
    expect(existsSync(join(home, ".claude", "skills", "beta", SYNC_MARKER_FILE))).toBe(false);
    expect(existsSync(join(home, ".claude", "skills", "orphan", SYNC_MARKER_FILE))).toBe(false);
    // Nothing was deleted or rewritten.
    expect(readFileSync(join(home, ".claude", "skills", "beta", "SKILL.md"), "utf-8")).toContain("drift");
    expect(existsSync(join(home, ".claude", "skills", "orphan", "SKILL.md"))).toBe(true);

    // Ledger carries the conflict with the machine-readable fields.
    const ledger = JSON.parse(readFileSync(join(home, ".hasna", "skills", CONFLICTS_LEDGER_FILE), "utf-8"));
    expect(ledger.version).toBe(1);
    expect(ledger.entries).toHaveLength(1);
    const conflict = ledger.entries[0] as HomeConflict;
    expect(conflict.path).toBe(join(home, ".claude", "skills", "beta"));
    expect(conflict.home).toBe(join(home, ".claude", "skills"));
    expect(conflict.skill).toBe("beta");
    expect(conflict.agent).toBe("claude");
    expect(conflict.hash).toBe(hashSkillMarkdown(SKILL_CONTENT("beta") + "drift\n"));
    expect(conflict.canonicalHash).toBe(hashSkillMarkdown(SKILL_CONTENT("beta")));
    expect(conflict.mtime).toBeTruthy();

    // Rollback record lists every marker written.
    expect(result.rollbackFile).toBeTruthy();
    expect(result.rollbackFile).toContain(ROLLBACK_DIRNAME);
    const rollback = JSON.parse(readFileSync(result.rollbackFile as string, "utf-8"));
    expect(rollback.mode).toBe("adopt");
    expect(rollback.entries).toHaveLength(1);
    expect(rollback.entries[0]).toMatchObject({
      agent: "claude",
      skill: "alpha",
      path: join(home, ".claude", "skills", "alpha"),
    });
  });

  test("a re-scan after apply sees the adopted dir as managed", () => {
    const home = tempHome();
    const corpus = corpusDir(home);
    writeSkillMd(join(corpus, "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(home, ".claude", "skills", "alpha"), SKILL_CONTENT("alpha"));

    adoptUnmarkedHomes({ homeDir: home, apply: true });
    const scan = scanUnmarkedHomes({ homeDir: home });

    expect(scan.managed).toBe(1);
    expect(scan.adoptable).toEqual([]);
  });
});

describe("pruneStrayHomes", () => {
  test("dry-run lists marked-and-stray dirs and removes nothing", () => {
    const home = tempHome();
    writeSkillMd(join(home, ".claude", "skills", "stray"), SKILL_CONTENT("stray"));
    writeFileSync(join(home, ".claude", "skills", "stray", SYNC_MARKER_FILE), JSON.stringify({ managedBy: SYNC_MARKER_MANAGED_BY, skill: "stray" }));
    writeSkillMd(join(home, ".claude", "skills", "unmarked-stray"), SKILL_CONTENT("unmarked-stray"));

    const result = pruneStrayHomes({ homeDir: home });

    expect(result.dryRun).toBe(true);
    expect(result.candidates.map((entry) => entry.skill)).toEqual(["stray"]);
    expect(result.pruned).toBe(0);
    expect(existsSync(join(home, ".claude", "skills", "stray", "SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".hasna", "skills", ROLLBACK_DIRNAME))).toBe(false);
  });

  test("apply removes only marked-and-stray dirs, recorded before removal", () => {
    const home = tempHome();
    const corpus = corpusDir(home);
    writeSkillMd(join(corpus, "canonical"), SKILL_CONTENT("canonical"));
    // Marked + no canonical entry -> prune candidate.
    writeSkillMd(join(home, ".claude", "skills", "stray"), SKILL_CONTENT("stray"));
    writeFileSync(join(home, ".claude", "skills", "stray", SYNC_MARKER_FILE), JSON.stringify({ managedBy: SYNC_MARKER_MANAGED_BY, skill: "stray" }));
    // Marked + canonical entry -> kept.
    writeSkillMd(join(home, ".claude", "skills", "canonical"), SKILL_CONTENT("canonical"));
    writeFileSync(join(home, ".claude", "skills", "canonical", SYNC_MARKER_FILE), JSON.stringify({ managedBy: SYNC_MARKER_MANAGED_BY, skill: "canonical" }));
    // Unmarked + no canonical entry -> never touched.
    writeSkillMd(join(home, ".claude", "skills", "hand-authored"), SKILL_CONTENT("hand-authored"));

    const result = pruneStrayHomes({ homeDir: home, apply: true });

    expect(result.dryRun).toBe(false);
    expect(result.pruned).toBe(1);
    expect(result.candidates.map((entry) => entry.skill)).toEqual(["stray"]);
    expect(existsSync(join(home, ".claude", "skills", "stray"))).toBe(false);
    expect(existsSync(join(home, ".claude", "skills", "canonical", "SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".claude", "skills", "hand-authored", "SKILL.md"))).toBe(true);

    // The rollback record was written BEFORE the removal and carries the hash + marker.
    expect(result.rollbackFile).toBeTruthy();
    const rollback = JSON.parse(readFileSync(result.rollbackFile as string, "utf-8"));
    expect(rollback.mode).toBe("prune");
    expect(rollback.entries).toHaveLength(1);
    expect(rollback.entries[0]).toMatchObject({
      agent: "claude",
      skill: "stray",
      path: join(home, ".claude", "skills", "stray"),
      hash: hashSkillMarkdown(SKILL_CONTENT("stray")),
    });
  });
});


test("prune refuses linked, malformed and foreign markers while preserving unrelated user files", () => {
  const home=tempHome(), homes=join(home,".codex/skills"), external=join(home,"external-marker.json");
  const mark={managedBy:SYNC_MARKER_MANAGED_BY,skill:"owned",source:"source",syncedAt:"2026-09-09T00:00:00.000Z"};
  writeFileSync(external,JSON.stringify(mark));
  for(const name of ["owned","linked","malformed","foreign","unmarked"]){
    writeSkillMd(join(homes,name),SKILL_CONTENT(name));writeFileSync(join(homes,name,"user.bin"),Buffer.from([0,128,255]));
  }
  writeFileSync(join(homes,"owned",SYNC_MARKER_FILE),JSON.stringify(mark));
  symlinkSync(external,join(homes,"linked",SYNC_MARKER_FILE));
  writeFileSync(join(homes,"malformed",SYNC_MARKER_FILE),"{broken-json");
  writeFileSync(join(homes,"foreign",SYNC_MARKER_FILE),JSON.stringify({...mark,managedBy:"another-tool"}));
  const paths=[external,...["linked","malformed","foreign","unmarked"].flatMap(name=>[join(homes,name,"SKILL.md"),join(homes,name,"user.bin")])];
  const before=paths.map(path=>[readFileSync(path).toString("hex"),lstatSync(path).ino,lstatSync(path).mtimeMs]);
  const result=pruneStrayHomes({homeDir:home,agents:["codex"],apply:true});
  expect(result.pruned).toBe(1);expect(result.candidates.map(row=>row.skill)).toEqual(["owned"]);expect(existsSync(join(homes,"owned"))).toBe(false);
  expect(paths.map(path=>[readFileSync(path).toString("hex"),lstatSync(path).ino,lstatSync(path).mtimeMs])).toEqual(before);
  expect(lstatSync(join(homes,"linked",SYNC_MARKER_FILE)).isSymbolicLink()).toBe(true);
});

for(const replacement of ["linked","foreign","malformed","removed","same-bytes-new-file"] as const) test(`prune rechecks ownership after rollback recording: ${replacement}`,()=>{
  const home=tempHome(),dir=join(home,".codex/skills/stale"),external=join(home,"external-marker.json"),path=join(dir,SYNC_MARKER_FILE);
  writeSkillMd(dir,SKILL_CONTENT("stale"));writeFileSync(join(dir,"user.bin"),Buffer.from([3,2,1]));
  const marker=JSON.stringify({managedBy:SYNC_MARKER_MANAGED_BY,skill:"stale",source:"source",syncedAt:"2026-09-09T00:00:00.000Z"});
  writeFileSync(path,marker);writeFileSync(external,marker);const before=readFileSync(join(dir,"user.bin"));
  const original=fs.writeFileSync;let changed=false;
  const hook=spyOn(fs,"writeFileSync").mockImplementation(((file:any,...args:any[])=>{
    const result=(original as any)(file,...args);
    if(!changed && String(file).includes("/rollback/prune-")){
      changed=true;rmSync(path);
      if(replacement==="linked")symlinkSync(external,path);
      else if(replacement!=="removed"){
        const temporary=join(home,"replacement.json");original(temporary,replacement==="foreign"?JSON.stringify({managedBy:"another-tool"}):replacement==="malformed"?"{broken-json":marker);renameSync(temporary,path);
      }
    }
    return result;
  }) as typeof fs.writeFileSync);
  try {const result=pruneStrayHomes({homeDir:home,agents:["codex"],apply:true});expect(changed).toBe(true);expect(result.pruned).toBe(0);expect(readFileSync(join(dir,"user.bin"))).toEqual(before);expect(readFileSync(join(dir,"SKILL.md"),"utf8")).toBe(SKILL_CONTENT("stale"));}
  finally{hook.mockRestore();}
});


test("prune refuses a linked marker even when the opener operates without no-follow",()=>{
  const home=tempHome(),external=join(home,"external-marker.json"),linked=join(home,".codex/skills/linked"),owned=join(home,".codex/skills/owned");
  const marker=JSON.stringify({managedBy:SYNC_MARKER_MANAGED_BY,skill:"owned",source:"source",syncedAt:"2026-09-09T00:00:00.000Z"});
  writeFileSync(external,marker);writeSkillMd(linked,SKILL_CONTENT("linked"));writeFileSync(join(linked,"user.txt"),"Keep user data");symlinkSync(external,join(linked,SYNC_MARKER_FILE));
  writeSkillMd(owned,SKILL_CONTENT("owned"));writeFileSync(join(owned,SYNC_MARKER_FILE),marker);
  const original=fs.openSync;const hook=spyOn(fs,"openSync").mockImplementation(((path:any,flags:any,...args:any[])=>(original as any)(path,typeof flags==="number"?flags & ~fs.constants.O_NOFOLLOW:flags,...args)) as typeof fs.openSync);
  try{const result=pruneStrayHomes({homeDir:home,agents:["codex"],apply:true});expect(result.pruned).toBe(1);expect(existsSync(owned)).toBe(false);expect(readFileSync(join(linked,"user.txt"),"utf8")).toBe("Keep user data");expect(lstatSync(join(linked,SYNC_MARKER_FILE)).isSymbolicLink()).toBe(true);}
  finally{hook.mockRestore();}
});
