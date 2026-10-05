import { afterEach, describe, expect, test } from "bun:test";
import { KernelLock } from "@hasna/contracts/kernel-lock";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withCodexCorpusWrite, withCodexCorpusWriteAsync } from "./codex-corpus-write.js";

import { corpusFixture as fixture, assertPublication as publication } from "./codex-corpus.fixture.js";
describe("Codex shared writer admission", () => {
  test("holds a shared descriptor throughout synchronous writes and releases on exception", () => {
    const f=fixture();
    expect(() => withCodexCorpusWrite([f.root], () => { publication(f.root,false); throw new Error("rollback"); },f.options)).toThrow("rollback");
    publication(f.root,true);
  });
  test("two asynchronous writers exclude publication until both settle", async () => {
    const f=fixture(); let releaseA!:()=>void, releaseB!:()=>void;
    const a=withCodexCorpusWriteAsync([f.root],async()=>{ await new Promise<void>(r=>releaseA=r); },f.options);
    const b=withCodexCorpusWriteAsync([f.root],async()=>{ await new Promise<void>(r=>releaseB=r); },f.options);
    publication(f.root,false); releaseA(); await a; publication(f.root,false); releaseB(); await b; publication(f.root,true);
  });
  test("never creates a missing lock or treats unenrolled as permission", () => {
    const f=fixture(false); let called=false;
    expect(()=>withCodexCorpusWrite([f.root],()=>{called=true;},f.options)).toThrow("CODEX_CORPUS");
    expect(called).toBe(false); expect(existsSync(join(f.root,".native-corpus-admission.flock-v1"))).toBe(false);
  });
  for (const state of ["unenrolled","pending","wrong-identity","extra"]) test(`refuses ${state} before the writer`,()=>{
    const f=fixture();writeFileSync(join(f.root,"fixture-mode"),state);let called=false;
    expect(()=>withCodexCorpusWrite([f.root],()=>{called=true;},f.options)).toThrow("CODEX_CORPUS");
    expect(called).toBe(false);publication(f.root,true);
  });
  test("detects root alias drift while retaining the original descriptor",()=>{
    const f=fixture();
    expect(()=>withCodexCorpusWrite([f.root],()=>{renameSync(f.root,f.root+"-old");mkdirSync(f.root,{mode:0o700});},f.options)).toThrow();
  });
  test("unrelated transactions do not need a Codex executable",()=>{
    expect(withCodexCorpusWrite([],()=>42,{codexCommand:"/not-installed"})).toBe(42);
  });
});
