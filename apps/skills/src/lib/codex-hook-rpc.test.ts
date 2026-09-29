import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { connectCodexHookRpc } from "./codex-hook-rpc.js";

// These fixtures exercise the transport's admission rules. Compatibility with
// a real native release is verified separately in a credential-free HOME.
for (const version of ["0.157.1", "0.158.0"]) {
  test(`native transport accepts ${version} envelopes`, async () => {
    const home = mkdtempSync(join(tmpdir(), "skills-native-rpc-"));
    const command = join(home, "codex");
    try {
      writeFileSync(command, `#!/usr/bin/env bun
import { createInterface } from "node:readline";
if (process.argv[2] === "--version") { console.log("codex-cli ${version}"); process.exit(0); }
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.method === "initialize") console.log(JSON.stringify({ id: request.id, result: {} }));
  if (request.method === "hooks/list") console.log(JSON.stringify({ id: request.id, result: { data: [{ cwd: request.params.cwds[0], hooks: [], errors: [], warnings: [] }] } }));
}
`, { mode: 0o700 });
      const rpc = await connectCodexHookRpc({ command, home, codexHome: home });
      try {
        expect(rpc.version).toBe(`codex-cli ${version}`);
        expect(await rpc.request("hooks/list", { cwds: [home] })).toEqual({
          data: [{ cwd: home, hooks: [], errors: [], warnings: [] }],
        });
      } finally { await rpc.close(); }
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
}

for (const version of ["0.158.0", "0.999.0"]) {
  test(`native transport refuses ${version === "0.999.0" ? "unverified versions" : "malformed native replies"}`, async () => {
    const home = mkdtempSync(join(tmpdir(), "skills-native-refusal-"));
    const command = join(home, "codex");
    try {
      writeFileSync(command, `#!/bin/sh\nif [ "$1" = "--version" ]; then printf 'codex-cli ${version}\\n'; exit 0; fi\nprintf 'null\\n'\n`, { mode: 0o700 });
      await expect(connectCodexHookRpc({ command, home, codexHome: home })).rejects.toThrow(
        version === "0.999.0" ? "NATIVE_UNSUPPORTED_VERSION" : "NATIVE_UNSUPPORTED",
      );
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
}

test("native transport refuses a writable launcher before executing it", async () => {
  const home = mkdtempSync(join(tmpdir(), "skills-native-mode-"));
  const command = join(home, "codex");
  try {
    writeFileSync(command, "#!/bin/sh\nexit 99\n", { mode: 0o700 });
    chmodSync(command, 0o777);
    await expect(connectCodexHookRpc({ command, home, codexHome: home })).rejects.toThrow("UNSAFE_EXECUTABLE");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
