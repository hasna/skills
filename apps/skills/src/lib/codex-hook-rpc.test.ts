import { admitCorpusFixture, wrapNativeInspectionFixture } from "./codex-corpus.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync as writeOriginal, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { connectCodexHookRpc } from "./codex-hook-rpc.js";
import { KernelLock } from "@hasna/contracts/kernel-lock";

const writeFileSync: typeof writeOriginal = (path,data,options)=>writeOriginal(path,typeof path==="string" && path.endsWith("/codex") && typeof data==="string" ? wrapNativeInspectionFixture(data) : data,options);

for (const version of ["0.999.0", "0.160.2", "0.154.0", "0.155.1", "0.156.1", "0.157.0", "0.157.1", "0.158.0"]) test(`native transport refuses ${["0.999.0", "0.160.2"].includes(version) ? "unknown versions" : "malformed response envelopes"}`, async () => {
  const home = mkdtempSync(join(tmpdir(), "skills-rpc-refusal-")), command = join(home, "codex");
  try {
    admitCorpusFixture(home); admitCorpusFixture(join(home,".codex"));
    writeFileSync(command, `#!/bin/sh\nif [ "$1" = "--version" ]; then printf 'codex-cli ${version}\\n'; exit 0; fi\nprintf 'null\\n'\n`, { mode: 0o700 });
    await expect(connectCodexHookRpc({ command, home, codexHome: home })).rejects.toThrow(["0.999.0", "0.160.2"].includes(version) ? "NATIVE_UNSUPPORTED_VERSION" : "NATIVE_UNSUPPORTED");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

for (const version of ["0.157.0", "0.157.1", "0.158.0", "0.159.0", "0.159.2", "0.160.0", "0.160.1", "0.161.0", "0.162.0"]) test(`native transport accepts the ${version} protocol`, async () => {
  const home = mkdtempSync(join(tmpdir(), "skills-rpc-supported-")), command = join(home, "codex");
  try {
    admitCorpusFixture(home); admitCorpusFixture(join(home,".codex"));
    writeFileSync(command, `#!/usr/bin/env bun
import { createInterface } from "node:readline";
if (process.argv[2] === "--version") { console.log("codex-cli ${version}"); process.exit(0); }
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.method === "initialize") console.log(JSON.stringify({ id: request.id, result: { userAgent: "skills-native-hook-enrollment/${version} synthetic" } }));
  if (request.method === "hooks/list") console.log(JSON.stringify({ id: request.id, result: { data: [{ cwd: request.params.cwds[0], hooks: [], errors: [], warnings: [] }] } }));
}
`, { mode: 0o700 });
    const rpc = await connectCodexHookRpc({ command, home });
    try {
      expect(rpc.version).toBe(`codex-cli ${version}`);
      expect(await rpc.request("hooks/list", { cwds: [home] })).toEqual({ data: [{ cwd: home, hooks: [], errors: [], warnings: [] }] });
    } finally { await rpc.close(); }
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("native close waits past its TERM grace for the actual child close and retains shared admission", async () => {
  const home = mkdtempSync(join(tmpdir(), "skills-rpc-slow-close-")), corpus = join(home, ".codex"), command = join(home, "codex");
  const termSeen = join(home, "term-seen"), childClosed = join(home, "child-closed");
  let rpc: Awaited<ReturnType<typeof connectCodexHookRpc>> | undefined;
  let closeSettled = false, closeError: unknown, closeTask: Promise<void> | undefined;
  try {
    admitCorpusFixture(home); admitCorpusFixture(corpus);
    writeFileSync(command, `#!/usr/bin/env bun
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
if (process.argv[2] === "--version") { console.log("codex-cli 0.162.0"); process.exit(0); }
if (process.argv[2] === "corpus-admission-inspect") { process.exit(2); }
process.on("SIGTERM", () => writeFileSync(${JSON.stringify(termSeen)}, "seen"));
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.method === "initialize") console.log(JSON.stringify({ id: request.id, result: { userAgent: "skills-native-hook-enrollment/0.162.0 synthetic" } }));
}
await new Promise(resolve => setTimeout(resolve, 7000));
writeFileSync(${JSON.stringify(childClosed)}, "closed");
`, { mode: 0o700 });
    rpc = await connectCodexHookRpc({ command, home, codexHome: corpus });
    const started = performance.now();
    closeTask = rpc.close().then(() => { closeSettled = true; }, error => { closeSettled = true; closeError = error; });
    const signalDeadline = Date.now() + 3000;
    while (!existsSync(termSeen) && Date.now() < signalDeadline) await Bun.sleep(10);
    expect(existsSync(termSeen)).toBe(true);
    await Bun.sleep(4100);
    expect({ closeSettled, childClosed: existsSync(childClosed) }).toEqual({ closeSettled: false, childClosed: false });
    const writer = new KernelLock(corpus, ".native-corpus-admission", { existingOnly: true });
    try { expect(writer.trySync(10)).toBe(false); } finally { writer.close(); }
    await closeTask;
    expect(closeError).toBeUndefined();
    expect(existsSync(childClosed)).toBe(true);
    expect(performance.now() - started).toBeGreaterThanOrEqual(5000);
    expect(performance.now() - started).toBeLessThan(10_000);
    const writerAfterClose = new KernelLock(corpus, ".native-corpus-admission", { existingOnly: true });
    try { expect(writerAfterClose.trySync(1000)).toBe(true); } finally { writerAfterClose.close(); }
  } finally {
    if (rpc) {
      const childCloseDeadline = Date.now() + 7000;
      while (!existsSync(childClosed) && Date.now() < childCloseDeadline) await Bun.sleep(10);
      if (closeTask) await closeTask;
      else await rpc.close().catch(() => {});
    }
    rmSync(home, { recursive: true, force: true });
  }
});

/** A complete protocol fixture: the transport must refuse on version evidence alone. */
function handshakeFixture(home: string, versionLine: string, userAgentVersion: string, spawned?: string): string {
  const command = join(home, "codex");
  writeFileSync(command, `#!/usr/bin/env bun
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
if (process.argv[2] === "--version") { process.stdout.write(${JSON.stringify(versionLine + "\n")}); process.exit(0); }
${spawned ? `writeFileSync(${JSON.stringify(spawned)}, "spawned");` : ""}
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.method === "initialize") console.log(JSON.stringify({ id: request.id, result: { userAgent: "skills-native-hook-enrollment/${userAgentVersion} synthetic" } }));
}
`, { mode: 0o700 });
  return command;
}

for (const versionLine of ["codex-cli 0.160.2", "codex-cli 0.161.1", "codex-cli 0.162.1", "codex-cli 0.163.0", "codex-cli 0.162.0-alpha.1", "codex-cli 0.162.0-rc.1", "codex-cli 0.162.0+build.1", "codex-cli 0.159.1", "codex-cli 0.159.3", "codex-cli 0.160.10",
  "codex-cli 0.160.1-alpha.1", "codex-cli 0.160.1+build.1", "codex-cli 0.160", "codex-cli v0.160.1", "Codex-CLI 0.160.1", "codex-cli  0.160.1", "0.160.1"])
  test(`native transport refuses the unmeasured neighbour ${JSON.stringify(versionLine)} before RPC`, async () => {
    const home = mkdtempSync(join(tmpdir(), "skills-rpc-neighbour-")), spawned = join(home, "spawned");
    try {
      admitCorpusFixture(home); admitCorpusFixture(join(home, ".codex"));
      const command = handshakeFixture(home, versionLine, versionLine.split(" ").at(-1)!, spawned);
      await expect(connectCodexHookRpc({ command, home, codexHome: home })).rejects.toThrow("CODEX_HOOK_TRUST_NATIVE_UNSUPPORTED_VERSION");
      expect(existsSync(spawned)).toBe(false);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

for (const [versionLine, userAgentVersion] of [["codex-cli 0.161.0", "0.160.1"], ["codex-cli 0.161.0", "0.161.1"], ["codex-cli 0.162.0", "0.161.0"], ["codex-cli 0.161.0", "0.162.0"], ["codex-cli 0.162.0", "0.162.0-alpha.1"], ["codex-cli 0.162.0", "0.162.0+build.1"], ["codex-cli 0.160.1", "0.160.0"], ["codex-cli 0.160.1", "0.160.10"], ["codex-cli 0.160.1", "0.160.1-alpha.1"], ["codex-cli 0.160.1", "0.160.2"]] as const)
  test(`native transport refuses ${versionLine} paired with a ${userAgentVersion} native handshake`, async () => {
    const home = mkdtempSync(join(tmpdir(), "skills-rpc-mismatch-"));
    try {
      admitCorpusFixture(home); admitCorpusFixture(join(home, ".codex"));
      const command = handshakeFixture(home, versionLine, userAgentVersion);
      await expect(connectCodexHookRpc({ command, home, codexHome: home })).rejects.toThrow(new Error("CODEX_HOOK_TRUST_NATIVE_UNSUPPORTED: native hooks/list and versioned config writes are required"));
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

for (const nativeVersion of ["0.160.1", "0.161.0", "0.162.0"]) test(`native transport admits ${nativeVersion} only through an existing shared corpus admission`, async () => {
  const home = mkdtempSync(join(tmpdir(), "skills-rpc-0160-1-admission-")), spawned = join(home, "spawned");
  try {
    const command = handshakeFixture(home, `codex-cli ${nativeVersion}`, nativeVersion, spawned);
    mkdirSync(join(home, ".codex"), { mode: 0o700 });
    await expect(connectCodexHookRpc({ command, home, codexHome: join(home, ".codex") })).rejects.toThrow("CODEX_CORPUS_ADMISSION_REQUIRED");
    expect(existsSync(spawned)).toBe(false);
    expect(existsSync(join(home, ".codex", ".native-corpus-admission.flock-v1"))).toBe(false);
    admitCorpusFixture(join(home, ".codex"));
    const rpc = await connectCodexHookRpc({ command, home, codexHome: join(home, ".codex") });
    try { expect(rpc.version).toBe(`codex-cli ${nativeVersion}`); expect(existsSync(spawned)).toBe(true); } finally { await rpc.close(); }
  } finally { rmSync(home, { recursive: true, force: true }); }
});

for (const explicit of [false, true]) test(`native transport ${explicit ? "retains an explicit" : "does not manufacture a default"} CODEX_HOME`, async () => {
  const home = mkdtempSync(join(tmpdir(), "skills-rpc-native-home-")), command = join(home, "codex"), witness = join(home, "native-home.txt");
  try {
    admitCorpusFixture(home); admitCorpusFixture(join(home,".codex"));
    writeFileSync(command, `#!/bin/sh\nif [ "$1" = "--version" ]; then printf 'codex-cli 0.154.0\\n'; exit 0; fi\nprintf '%s' "\${CODEX_HOME-unset}" > '${witness}'\nprintf 'null\\n'\n`, { mode: 0o700 });
    await expect(connectCodexHookRpc({ command, home, ...(explicit ? { codexHome: home } : {}) })).rejects.toThrow("NATIVE_UNSUPPORTED");
    expect(readFileSync(witness, "utf8")).toBe(explicit ? home : "unset");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("native transport refuses a writable launcher before executing it", async () => {
  const home = mkdtempSync(join(tmpdir(), "skills-native-mode-"));
  const command = join(home, "codex");
  try {
    admitCorpusFixture(home); admitCorpusFixture(join(home,".codex"));
    writeFileSync(command, "#!/bin/sh\nexit 99\n", { mode: 0o700 });
    chmodSync(command, 0o777);
    await expect(connectCodexHookRpc({ command, home, codexHome: home })).rejects.toThrow("UNSAFE_EXECUTABLE");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
