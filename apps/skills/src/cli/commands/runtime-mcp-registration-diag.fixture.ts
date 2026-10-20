// DIAG PLA8-00581 (not for merge). Test-only helpers for the MCP registration
// fixtures: record the environment and per-adapter outcomes of a child, and
// emit them as ONE masked JSON line on fd 2 only when that child exits non-zero.
// fd 2 bypasses the fixture's console capture; passing children print nothing.
import { closeSync, constants, existsSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { dlopen, ptr, read } from "bun:ffi";

/** Mask anything token-shaped. Paths stay readable (segments are short). */
export function diagMask(text: string): string {
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\b(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9]+|\bwhsec_[A-Za-z0-9]+/g, "<masked>")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*/gi, "<url>")
    .replace(/(?<![0-9])[0-9]{12}(?![0-9])/g, "<num12>")
    .replace(/[A-Za-z0-9_+=]{24,}/g, "<masked>")
    .replace(/[A-Za-z0-9_+=.~-]{40,}/g, "<masked>");
}

const AGENT_CLIS = ["claude", "codex", "opencode", "cursor", "cursor-agent", "gemini", "windsurf", "pi", "skills-mcp"];
const ENV_NAMES = /^(HOME|XDG_.*|CODEX_HOME|CLAUDE_CONFIG_DIR|CLAUDE_CODE_.*|OPENCODE_.*|CI|PATH|TMPDIR|HASNA_.*|SKILLS_.*)$/;
const octal = (path: string) => { try { return (lstatSync(path).mode & 0o7777).toString(8); } catch { return null; } };

/** Names only, never values; agent CLIs on PATH by resolved path only. */
export function diagEnvironment(tempRoot: string) {
  const onPath: Record<string, string> = {};
  for (const name of AGENT_CLIS) for (const dir of (process.env.PATH ?? "").split(":").filter(Boolean)) {
    const candidate = join(dir, name);
    if (!existsSync(candidate)) continue;
    try { onPath[name] = realpathSync(candidate); } catch { onPath[name] = candidate; }
    break;
  }
  return { os: process.platform, arch: process.arch, node: process.version, bun: Bun.version, bunRevision: Bun.revision.slice(0, 12),
    umask: process.umask().toString(8).padStart(3, "0"), envNames: Object.keys(process.env).filter(name => ENV_NAMES.test(name)).sort(),
    agentClisOnPath: onPath, tempRoot, tempRootMode: octal(tempRoot), tmpdir: process.env.TMPDIR ?? null, tmpdirMode: process.env.TMPDIR ? octal(process.env.TMPDIR) : null };
}

export function diagBefore(files: Record<string, string>) {
  return Object.fromEntries(Object.entries(files).map(([agent, path]) => [agent,
    { path, existedBefore: existsSync(path), mode: octal(path), parentMode: octal(dirname(path)) }]));
}

const REFUSALS: Record<string, string> = {
  "configuration access metadata could not be verified or preserved": "ACCESS_METADATA_UNAVAILABLE",
  "refused an unsafe or unowned configuration path": "UNSAFE_PATH",
  "configuration ownership cannot be verified on this platform": "OWNERSHIP_UNAVAILABLE",
  "configuration is locked; no foreign lock was removed": "LOCKED",
  "existing configuration is invalid": "INVALID_CONFIG",
  "could not preserve and verify the original configuration": "BACKUP_FAILED",
  "could not prepare the replacement configuration": "WRITE_FAILED",
  "configuration or its path changed during registration": "CONFIG_CHANGED",
  "could not verify the committed configuration; retain the backup for recovery": "VERIFY_FAILED",
  "configuration update was refused": "UNCLASSIFIED_ERROR",
};

/** After registration: what each adapter reported, what its file now holds. */
export function diagAfter(files: Record<string, string>, rendered: string) {
  let results: Array<Record<string, unknown>> = [];
  try { results = JSON.parse(rendered).results ?? []; } catch { /* auth/setup modes render text */ }
  return Object.fromEntries(Object.entries(files).map(([agent, path]) => {
    const result = results.find(entry => entry.agent === agent);
    const error = typeof result?.error === "string" ? result.error : undefined;
    let argsWritten: unknown = "unread";
    try {
      const text = readFileSync(path, "utf8");
      const parsed = agent === "codex" ? Bun.TOML.parse(text) as any : JSON.parse(text);
      const server = agent === "codex" ? parsed?.mcp_servers?.skills : agent === "opencode" ? parsed?.mcp?.skills : parsed?.mcpServers?.skills;
      argsWritten = server === undefined ? "no-skills-entry" : Array.isArray(server.command) ? server.command.slice(1) : server.args ?? null;
    } catch (error) { argsWritten = `unparsed:${(error as Error).name}`; }
    let siblings: string[] = [];
    try { siblings = readdirSync(dirname(path)).filter(name => name.startsWith(basename(path) + ".skills-mcp")).map(name => name.replace(/^.*\.skills-mcp/, ".skills-mcp")); } catch {}
    return [agent, { success: result?.success ?? null, code: result?.code ?? null,
      refusal: error ? Object.entries(REFUSALS).find(([message]) => error.endsWith(message))?.[1] ?? "OTHER" : null,
      argsWritten, siblings, mode: octal(path), parentMode: octal(dirname(path)) }];
  }));
}

/** Linux only: replay the product's fgetxattr presence query and tally the
 * errno values read back. A fresh private directory has no ACL, so every read
 * should be ENODATA (61); anything else is a clobbered or refused read. */
export function diagLinuxErrnoProbe(directory: string, iterations = 200_000) {
  if (process.platform !== "linux") return { skipped: process.platform };
  const tally: Record<string, number> = {};
  const library = dlopen("libc.so.6", {
    fgetxattr: { args: ["i32", "ptr", "ptr", "u64"], returns: "i64" },
    __errno_location: { args: [], returns: "ptr" },
  });
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const errno = library.symbols.__errno_location()!, name = Buffer.from("system.posix_acl_access\0");
    let gcRequests = 0;
    for (let index = 0; index < iterations; index++) {
      if (index % 10_000 === 0) { Bun.gc(false); gcRequests++; }
      const result = Number(library.symbols.fgetxattr(fd, ptr(name), null, 0));
      const key = result === -1 ? String(read.i32(errno)) : `ret${result}`;
      tally[key] = (tally[key] ?? 0) + 1;
    }
    return { iterations, gcRequests, tally };
  } finally { closeSync(fd); library.close(); }
}

/** Register once, early: on a non-zero exit, write one masked line to fd 2. */
export function diagOnFailure(record: Record<string, unknown>, tempRoot: string, probeDirectory: () => string | undefined) {
  const envNamesAtStart = Object.keys(process.env).filter(name => ENV_NAMES.test(name)).sort();
  process.on("exit", code => {
    if (code === 0) return;
    try { record.environment = { ...diagEnvironment(tempRoot), envNamesAtStart }; } catch (error) { record.environment = `failed:${(error as Error).name}`; }
    try {
      const directory = probeDirectory();
      record.exitCode = code;
      record.errnoProbe = directory ? diagLinuxErrnoProbe(directory) : "no-directory";
    } catch (error) { record.errnoProbe = `probe-failed:${(error as Error).name}`; }
    try { writeSync(2, `[pla8-00581-diag] ${diagMask(JSON.stringify(record))}\n`); } catch {}
  });
}
