import { acquireCodexCorpusWrite } from "./codex-corpus-write.js";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import { supportsCodexNativeCapability } from "./codex-native-compatibility.js";

export { SUPPORTED_CODEX_HOOK_VERSIONS } from "./codex-native-compatibility.js";

export interface CodexHookRpc {
  version: string;
  processId?: number;
  request(method: string, params: unknown): Promise<any>;
  close(): Promise<void>;
}

/** An owned, short-lived native client. It cannot reload other app servers. */
export async function connectCodexHookRpc(options: { command: string; home: string; codexHome?: string; timeoutMs?: number }): Promise<CodexHookRpc> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 20_000) throw new Error("CODEX_HOOK_TRUST_INVALID_TIMEOUT");
  const found = isAbsolute(options.command) ? options.command : Bun.which(options.command, { PATH: process.env.PATH });
  if (!found) throw new Error("CODEX_HOOK_TRUST_NATIVE_UNAVAILABLE: install Codex or pass --codex-command");
  const binary = realpathSync(found), stat = statSync(binary);
  if (!stat.isFile() || (stat.mode & 0o022) !== 0) throw new Error("CODEX_HOOK_TRUST_UNSAFE_EXECUTABLE");
  let version: string;
  try {
    const output = await promisify(execFile)(binary, ["--version"], { timeout: Math.min(5000, timeoutMs), maxBuffer: 4096 });
    version = output.stdout.trim();
  } catch { throw new Error("CODEX_HOOK_TRUST_NATIVE_UNAVAILABLE"); }
  // Enrollment is allowed only for native releases whose protocol and native
  // dispatch have been verified; future versions require a compatibility test.
  if (!supportsCodexNativeCapability(version, "hooks")) throw new Error("CODEX_HOOK_TRUST_NATIVE_UNSUPPORTED_VERSION");
  const current = statSync(binary);
  if (realpathSync(found) !== binary || ["dev", "ino", "size", "mtimeMs", "ctimeMs"].some(k => stat[k as keyof typeof stat] !== current[k as keyof typeof current])) throw new Error("CODEX_HOOK_TRUST_NATIVE_EXECUTABLE_CHANGED");
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: options.home, NO_COLOR: "1" };
  // Native Codex canonicalizes explicit CODEX_HOME, but its default ~/.codex
  // path remains lexical. Preserve absence instead of manufacturing an override.
  if (options.codexHome === undefined) delete env.CODEX_HOME;
  else env.CODEX_HOME = options.codexHome;
  const corpusLease = acquireCodexCorpusWrite([options.codexHome ?? join(options.home, ".codex")], { codexCommand: binary });
  const child = spawn(binary, ["app-server", "--strict-config", "--stdio"], {
    cwd: options.home,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let childClosed = false;
  const actualClose = new Promise<void>(resolve => child.once("close", () => { childClosed = true; corpusLease.close(); resolve(); }));
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let nextId = 1, buffer = Buffer.alloc(0), stopped = false, diagnosticBytes = 0;
  const fail = () => {
    stopped = true;
    for (const value of pending.values()) { clearTimeout(value.timer); value.reject(new Error("CODEX_HOOK_TRUST_NATIVE_RPC_FAILED")); }
    pending.clear();
  };
  child.on("error", fail); child.on("exit", fail); child.stdin.on("error", fail);
  child.stderr.on("data", (bytes: Buffer) => { diagnosticBytes += bytes.length; if (diagnosticBytes > 2 * 1024 * 1024) { fail(); child.kill(); } });
  child.stdout.on("data", (bytes: Buffer) => {
    if (buffer.length + bytes.length > 8 * 1024 * 1024) { fail(); child.kill(); return; }
    buffer = Buffer.concat([buffer, bytes]);
    for (;;) {
      const index = buffer.indexOf(10); if (index < 0) break;
      const line = buffer.subarray(0, index); buffer = buffer.subarray(index + 1);
      let value: any;
      try { value = JSON.parse(line.toString("utf8")); } catch { fail(); child.kill(); return; }
      if (!value || typeof value !== "object" || Array.isArray(value)) { fail(); child.kill(); return; }
      const waiting = pending.get(value.id);
      if (!waiting) continue;
      pending.delete(value.id); clearTimeout(waiting.timer);
      // Native config errors may include credential-bearing input. Never forward them.
      if (value.error || !("result" in value)) waiting.reject(new Error("CODEX_HOOK_TRUST_NATIVE_RPC_REFUSED"));
      else waiting.resolve(value.result);
    }
  });
  const rpc: CodexHookRpc = {
    version,
    processId: child.pid,
    request(method, params) {
      if (stopped) return Promise.reject(new Error("CODEX_HOOK_TRUST_NATIVE_RPC_CLOSED"));
      return new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => { fail(); child.kill(); }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
      });
    },
    async close() {
      fail(); child.stdin.end();
      if (childClosed) return;
      await new Promise<void>((resolve, reject) => {
        const terminate = setTimeout(() => { child.kill(); }, 1000);
        const deadline = setTimeout(() => { clearTimeout(terminate); reject(new Error("CODEX_HOOK_TRUST_NATIVE_CLOSE_UNCONFIRMED")); }, 10_000);
        actualClose.then(() => { clearTimeout(terminate); clearTimeout(deadline); resolve(); });
      });
    },
  };
  try {
    const initialized = await rpc.request("initialize", { clientInfo: { name: "skills-native-hook-enrollment", version: "1" }, capabilities: { experimentalApi: true } });
    const nativeVersion = version.slice("codex-cli ".length);
    if (typeof initialized?.userAgent !== "string" || !(initialized.userAgent === `skills-native-hook-enrollment/${nativeVersion}` || initialized.userAgent.startsWith(`skills-native-hook-enrollment/${nativeVersion} `))) throw new Error("CODEX_HOOK_TRUST_NATIVE_VERSION_MISMATCH");
    child.stdin.write('{"method":"initialized"}\n');
    return rpc;
  } catch { await rpc.close(); throw new Error("CODEX_HOOK_TRUST_NATIVE_UNSUPPORTED: native hooks/list and versioned config writes are required"); }
}
