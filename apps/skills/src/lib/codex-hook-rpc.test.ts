import { admitCorpusFixture, wrapNativeInspectionFixture } from "./codex-corpus.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync as writeOriginal, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { connectCodexHookRpc } from "./codex-hook-rpc.js";

const writeFileSync: typeof writeOriginal = (path,data,options)=>writeOriginal(path,typeof path==="string" && path.endsWith("/codex") && typeof data==="string" ? wrapNativeInspectionFixture(data) : data,options);

for (const version of ["0.999.0", "0.160.1", "0.154.0", "0.155.1", "0.156.1", "0.157.0", "0.157.1", "0.158.0"]) test(`native transport refuses ${["0.999.0", "0.160.1"].includes(version) ? "unknown versions" : "malformed response envelopes"}`, async () => {
  const home = mkdtempSync(join(tmpdir(), "skills-rpc-refusal-")), command = join(home, "codex");
  try {
    admitCorpusFixture(home); admitCorpusFixture(join(home,".codex"));
    writeFileSync(command, `#!/bin/sh\nif [ "$1" = "--version" ]; then printf 'codex-cli ${version}\\n'; exit 0; fi\nprintf 'null\\n'\n`, { mode: 0o700 });
    await expect(connectCodexHookRpc({ command, home, codexHome: home })).rejects.toThrow(["0.999.0", "0.160.1"].includes(version) ? "NATIVE_UNSUPPORTED_VERSION" : "NATIVE_UNSUPPORTED");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

for (const version of ["0.157.0", "0.157.1", "0.158.0", "0.159.0", "0.159.2", "0.160.0"]) test(`native transport accepts the ${version} protocol`, async () => {
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
