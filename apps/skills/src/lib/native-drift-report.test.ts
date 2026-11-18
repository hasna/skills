/**
 * Native drift owner report (HC-01432): the receipt records the report's
 * state, the agent notice says what really happened, an unconfigured station
 * starts nothing, a configured one starts exactly one worker under its lock,
 * and the worker files one task through a fake `todos` executable, then finds
 * that task instead of filing again. The worker runs in process here; no
 * detached process is started.
 */
import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
import { clearNativeDriftReceipt, nativeDriftAgentNotice, nativeDriftBridgeNotice, nativeDriftFailOpen, readNativeDriftReceipts, recordNativeDriftReceipt, runNativeDriftReport } from "./native-drift-receipt.js";
import {
  DRIFT_REPORT_RETRY_MS, DriftReportError, driftReportKey, driftReportStation, planNativeDriftReport, resolveDriftReportTarget, resolveTodosBinary, todosChildEnvironment,
} from "./native-drift-report.js";

useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const scratch = () => { const root = realpathSync(mkdtempSync(join(tmpdir(), "skills-drift-report-"))); roots.push(root); return root; };
const MESSAGE = "NATIVE_SKILL_DRIFT: Native discovery input changed; run skills hook install with a fresh discovery review: /home/u/.claude/settings.json";
const PROJECT = "0b7c6a52-6f8e-4b0e-9a54-2d4f1c3e8a10";
const SECRET = "argv-sentinel-value-that-must-never-appear";

function station() {
  const root = scratch(), data = join(root, "data"); mkdirSync(data);
  const spawned: string[][] = [];
  let clock = Date.parse("2026-11-18T10:00:00.000Z");
  const env: Record<string, string | undefined> = { HOME: root, PATH: "/usr/bin:/bin", HASNA_STATION: "station-test" };
  const report = { env, now: () => clock, spawnWorker: (args: string[]) => { spawned.push(args); } };
  const prompt = (agent = "claude", bridgeUnverified = false) => nativeDriftFailOpen(data, agent, "UserPromptSubmit", "UserPromptSubmit", MESSAGE, { bridgeUnverified, report }) as any;
  const receipt = (agent = "claude") => JSON.parse(readFileSync(join(data, "native-drift", `${agent}.json`), "utf8"));
  return { root, data, env, spawned, report, prompt, receipt, advance: (ms: number) => { clock += ms; } };
}

/** A fake todos CLI: an absolute script that keeps tasks in a JSON file and logs argv, stdin and env names. */
function fakeTodos(root: string, mode = 0o700): { bin: string; tasks: () => any[]; argv: () => string[][]; stdin: () => string[]; envNames: () => string[][] } {
  const dir = join(root, "fake-bin"); mkdirSync(dir, { recursive: true });
  const db = join(root, "fake-todos.json"), log = join(root, "fake-todos.log");
  writeFileSync(db, "[]");
  const bin = join(dir, "todos");
  writeFileSync(bin, `#!${process.execPath}
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const input = args.includes("--description-file") ? readFileSync(0, "utf8") : null;
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, input, env: Object.keys(process.env).sort() }) + "\\n");
const tasks = JSON.parse(readFileSync(${JSON.stringify(db)}, "utf8"));
const command = args.find(arg => arg === "list" || arg === "add");
if (command === "list") {
  const tag = args[args.indexOf("--tags") + 1];
  console.log(JSON.stringify({ tasks: tasks.filter(task => task.tags.includes(tag) && ["pending", "in_progress"].includes(task.status)), has_more: false, next_offset: null, next_cursor: null }));
} else if (command === "add") {
  const value = name => args[args.indexOf(name) + 1];
  const task = { id: crypto.randomUUID(), short_id: "SKD-" + String(tasks.length + 1).padStart(5, "0"), title: args[args.indexOf("add") + 1], status: "pending", tags: value("--tags").split(","), project_id: value("--project"), assigned_to: value("--assign"), description: input };
  tasks.push(task); writeFileSync(${JSON.stringify(db)}, JSON.stringify(tasks));
  console.log(JSON.stringify(task));
} else process.exit(2);
`);
  chmodSync(bin, mode);
  const entries = () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  return { bin, tasks: () => JSON.parse(readFileSync(db, "utf8")), argv: () => entries().map(entry => entry.args), stdin: () => entries().map(entry => entry.input).filter(Boolean), envNames: () => entries().map(entry => entry.env) };
}

test("receipts round-trip the report state, and receipts without one still parse", () => {
  const s = station();
  // A receipt written before 0.10.98 has no report and is still listed.
  recordNativeDriftReceipt(s.data, "codex", "UserPromptSubmit", MESSAGE);
  expect(readNativeDriftReceipts(s.data)).toEqual([expect.not.objectContaining({ report: expect.anything() })]);
  s.prompt();
  const recorded = s.receipt();
  expect(recorded.report).toEqual({ status: "not-configured", attemptedAt: "2026-11-18T10:00:00.000Z" });
  expect(readNativeDriftReceipts(s.data).find(receipt => receipt.agent === "claude")?.report).toEqual(recorded.report);
  // A report with unvalidated extra fields keeps only the validated ones.
  const path = join(s.data, "native-drift", "claude.json");
  writeFileSync(path, JSON.stringify({ ...recorded, report: { status: "filed", taskId: "HC-01432", attemptedAt: "2026-11-18T10:00:00.000Z", extra: "dropped" } }));
  expect(readNativeDriftReceipts(s.data).find(receipt => receipt.agent === "claude")?.report).toEqual({ status: "filed", taskId: "HC-01432", attemptedAt: "2026-11-18T10:00:00.000Z" });
  // An invalid report makes the receipt unreadable rather than half-trusted.
  for (const report of [{ status: "filed", attemptedAt: "2026-11-18T10:00:00.000Z" }, { status: "reported", attemptedAt: "2026-11-18T10:00:00.000Z" }, { status: "failed", attemptedAt: "yesterday" }, { status: "filed", taskId: "bad id; rm", attemptedAt: "2026-11-18T10:00:00.000Z" }]) {
    writeFileSync(path, JSON.stringify({ ...recorded, report }));
    expect(readNativeDriftReceipts(s.data).map(receipt => receipt.agent)).toEqual(["codex"]);
  }
  // Clearing keeps the report as history.
  writeFileSync(path, JSON.stringify(recorded));
  clearNativeDriftReceipt(s.data, "claude");
  expect(s.receipt()).toMatchObject({ status: "cleared", report: recorded.report });
});

test("an unconfigured station starts nothing and says the drift was recorded locally only", () => {
  const s = station();
  for (let index = 0; index < 3; index++) {
    const output = s.prompt();
    expect(output.hookSpecificOutput.additionalContext).toBe(nativeDriftAgentNotice({ status: "not-configured", attemptedAt: "2026-11-18T10:00:00.000Z" }));
    expect(output.hookSpecificOutput.additionalContext).toContain("this station recorded it locally only (no owner report is configured); an operator can list it with `skills hook drift`.");
    expect(output.hookSpecificOutput.additionalContext).not.toContain("reported to the operator");
  }
  expect(s.spawned).toEqual([]);
  expect(existsSync(join(s.data, "native-drift", "claude.report.lock"))).toBe(false);
  // An invalid target is not configured either, with its code recorded.
  s.env.HASNA_SKILLS_DRIFT_REPORT_PROJECT = "not-a-uuid"; s.env.HASNA_SKILLS_DRIFT_REPORT_ASSIGNEE = "skills-owner";
  expect(s.prompt().hookSpecificOutput.additionalContext).toContain("no owner report is configured");
  expect(s.receipt().report).toMatchObject({ status: "not-configured", code: "DRIFT_REPORT_CONFIG_INVALID" });
  expect(s.spawned).toEqual([]);
  // The bridge variant keeps its own guidance.
  expect(s.prompt("claude", true).hookSpecificOutput.additionalContext).toBe(nativeDriftBridgeNotice({ status: "not-configured", attemptedAt: "2026-11-18T10:00:00.000Z" }));
});

test("a configured station starts exactly one worker under the lock and says the task is being filed", () => {
  const s = station();
  s.env.HASNA_SKILLS_DRIFT_REPORT_PROJECT = PROJECT; s.env.HASNA_SKILLS_DRIFT_REPORT_ASSIGNEE = "skills-owner";
  const outputs = [s.prompt(), s.prompt(), s.prompt("claude", true)];
  expect(s.spawned).toHaveLength(1);
  expect(s.spawned[0]!.slice(0, 4)).toEqual(["hook", "drift-report", "--agent", "claude"]);
  expect(s.spawned[0]![4]).toBe("--operation-id");
  expect(s.spawned[0]![5]).toMatch(/^[a-f0-9-]{36}$/);
  expect(s.spawned[0]!.join(" ")).not.toContain(PROJECT);
  for (const output of outputs.slice(0, 2)) expect(output.hookSpecificOutput.additionalContext).toContain("this station recorded it locally and is filing one task for the Skills owner. Continue the user's task.");
  expect(outputs[2].hookSpecificOutput.additionalContext).toContain("is filing one task for the Skills owner. Continue the user's task, but do not invoke the skills-cli native skill");
  expect(s.receipt().report).toMatchObject({ status: "pending" });
  expect(existsSync(join(s.data, "native-drift", "claude.report.lock"))).toBe(true);
  // The receipt list ignores the report's own files.
  expect(readNativeDriftReceipts(s.data).map(receipt => receipt.agent)).toEqual(["claude"]);
  // Concurrent plans for one episode: only the lock holder may start a worker.
  const episode = { reasonSha256: s.receipt().reasonSha256, firstSeenAt: s.receipt().firstSeenAt };
  expect(planNativeDriftReport(s.data, "claude", episode, s.report).start).toBeUndefined();
  // Another agent has its own lock.
  s.prompt("codex");
  expect(s.spawned.map(args => args[3])).toEqual(["claude", "codex"]);
});

test("a worker that cannot start is reported as failed and retried only after the window", () => {
  const s = station();
  s.env.HASNA_SKILLS_DRIFT_REPORT_PROJECT = PROJECT; s.env.HASNA_SKILLS_DRIFT_REPORT_ASSIGNEE = "skills-owner";
  let attempts = 0;
  const report = { ...s.report, spawnWorker: () => { attempts++; throw new Error("EAGAIN"); } };
  const prompt = () => nativeDriftFailOpen(s.data, "claude", "UserPromptSubmit", "UserPromptSubmit", MESSAGE, { report }) as any;
  expect(prompt().hookSpecificOutput.additionalContext).toContain("this station recorded it locally only (the owner report failed); an operator can list it with `skills hook drift`.");
  expect(s.receipt().report).toMatchObject({ status: "failed", code: "DRIFT_REPORT_NOT_STARTED" });
  expect(existsSync(join(s.data, "native-drift", "claude.report.lock"))).toBe(false);
  prompt(); s.advance(DRIFT_REPORT_RETRY_MS - 1); prompt();
  expect(attempts).toBe(1);
  s.advance(2); prompt();
  expect(attempts).toBe(2);
});

test("the worker files one task through the todos CLI, then finds it instead of filing again", async () => {
  const s = station();
  const todos = fakeTodos(s.root);
  Object.assign(s.env, { HASNA_SKILLS_DRIFT_REPORT_PROJECT: PROJECT, HASNA_SKILLS_DRIFT_REPORT_ASSIGNEE: "skills-owner", HASNA_SKILLS_DRIFT_REPORT_TODOS_BIN: todos.bin,
    HASNA_SKILLS_API_KEY: SECRET, HASNA_TODOS_LOCAL: "1", AWS_SECRET_ACCESS_KEY: SECRET, TODOS_AGENT_ID: "station-filer" });
  s.prompt();
  const operationId = s.spawned[0]![5]!;
  const first = await runNativeDriftReport(s.data, "claude", operationId, { env: s.env, now: () => Date.parse("2026-11-18T10:00:05.000Z") });
  expect(first).toMatchObject({ status: "filed", report: { status: "filed", taskId: "SKD-00001" } });
  expect(todos.tasks()).toHaveLength(1);
  const receipt = s.receipt();
  expect(receipt.report).toEqual({ status: "filed", taskId: "SKD-00001", attemptedAt: "2026-11-18T10:00:05.000Z" });
  const key = driftReportKey("station-test", "claude", receipt.reasonSha256);
  expect(key).toBe(`[skills-drift station-test:claude:${receipt.reasonSha256.slice(0, 12)}]`);
  const [task] = todos.tasks();
  expect(task).toMatchObject({ title: `Skills native discovery drift on station-test (claude) ${key}`, project_id: PROJECT, assigned_to: "skills-owner", tags: ["skills-drift"] });
  // The description is safe metadata only, and it travels on stdin.
  for (const field of ["- Station: station-test", "- Agent: claude", "- Event: UserPromptSubmit", "/home/u/.claude/settings.json", `- Reason SHA-256: ${receipt.reasonSha256}`, "- First seen: 2026-11-18T10:00:00.000Z", "- Occurrences: 1", "skills hook install --agent claude --apply", `- Receipt: ${join(s.data, "native-drift", "claude.json")}`]) expect(task.description).toContain(field);
  expect(task.description).not.toContain(SECRET);
  // The lock is released and the next prompt names the task.
  expect(existsSync(join(s.data, "native-drift", "claude.report.lock"))).toBe(false);
  expect(s.prompt().hookSpecificOutput.additionalContext).toBe("Skills context is unavailable for this turn because the station's native skill discovery changed; this station recorded it and filed one task for the Skills owner (Todos SKD-00001). Continue the user's task. Load a selected skill explicitly with `skills load <slug>` if one is needed, and do not load native skill copies.");
  expect(s.spawned).toHaveLength(1);

  // A later episode of the same drift (after a clean prompt), or another
  // session after a restart, finds the open task instead of filing again.
  clearNativeDriftReceipt(s.data, "claude");
  s.advance(60_000);
  expect(s.prompt().hookSpecificOutput.additionalContext).toContain("is filing one task");
  expect(s.spawned).toHaveLength(2);
  const second = await runNativeDriftReport(s.data, "claude", s.spawned[1]![5]!, { env: s.env });
  expect(second).toMatchObject({ status: "existing", report: { status: "existing", taskId: "SKD-00001" } });
  expect(todos.tasks()).toHaveLength(1);
  expect(s.prompt().hookSpecificOutput.additionalContext).toContain("filed one task for the Skills owner (Todos SKD-00001)");

  // argv never carries a secret, the description or an environment value; the
  // child environment drops the Skills credential, other secrets and the
  // local-store opt-in, and keeps the todos identity.
  const argv = todos.argv();
  expect(argv.map(args => args.find(arg => arg === "list" || arg === "add"))).toEqual(["list", "add", "list"]);
  expect(argv.flat().join("\n")).not.toContain(SECRET);
  expect(argv.flat().join("\n")).not.toContain("/home/u/.claude/settings.json");
  expect(todos.stdin()).toHaveLength(1);
  for (const names of todos.envNames()) {
    expect(names).not.toContain("HASNA_SKILLS_API_KEY");
    expect(names).not.toContain("HASNA_SKILLS_DRIFT_REPORT_PROJECT");
    expect(names).not.toContain("HASNA_TODOS_LOCAL");
    expect(names).not.toContain("AWS_SECRET_ACCESS_KEY");
    expect(names).toContain("TODOS_AGENT_ID");
    expect(names).toContain("HASNA_STATION");
  }
  // A stray invocation with another operation id does nothing.
  expect(await runNativeDriftReport(s.data, "claude", "00000000-0000-4000-8000-000000000000", { env: s.env })).toEqual({ status: "superseded" });
  expect(todos.argv()).toHaveLength(3);
});

test("a todos failure is recorded as failed, and the notice never claims a report", async () => {
  const s = station();
  const todos = fakeTodos(s.root);
  writeFileSync(todos.bin, "#!/bin/sh\nexit 3\n"); chmodSync(todos.bin, 0o700);
  Object.assign(s.env, { HASNA_SKILLS_DRIFT_REPORT_PROJECT: PROJECT, HASNA_SKILLS_DRIFT_REPORT_ASSIGNEE: "skills-owner", HASNA_SKILLS_DRIFT_REPORT_TODOS_BIN: todos.bin });
  s.prompt();
  expect(await runNativeDriftReport(s.data, "claude", s.spawned[0]![5]!, { env: s.env, now: () => Date.parse("2026-11-18T10:00:05.000Z") })).toMatchObject({ status: "failed", report: { code: "DRIFT_REPORT_SEARCH_FAILED" } });
  s.advance(10_000);
  const notice = s.prompt().hookSpecificOutput.additionalContext;
  expect(notice).toContain("recorded it locally only (the owner report failed)");
  expect(notice).not.toContain("Todos ");
  expect(s.spawned).toHaveLength(1);
});

test("the todos executable must be absolute, present, executable and writable only by its owner", () => {
  const root = scratch(), dir = join(root, "bin"); mkdirSync(dir);
  const bin = join(dir, "todos"); writeFileSync(bin, "#!/bin/sh\n");
  const code = (run: () => unknown) => { try { run(); return "accepted"; } catch (error) { return error instanceof DriftReportError ? error.code : String(error); } };
  chmodSync(bin, 0o700);
  expect(resolveTodosBinary(bin, {})).toBe(realpathSync(bin));
  expect(code(() => resolveTodosBinary("bin/todos", {}))).toBe("DRIFT_REPORT_TODOS_RELATIVE");
  expect(code(() => resolveTodosBinary("todos", {}))).toBe("DRIFT_REPORT_TODOS_RELATIVE");
  expect(code(() => resolveTodosBinary(join(dir, "missing"), {}))).toBe("DRIFT_REPORT_TODOS_MISSING");
  chmodSync(bin, 0o770); expect(code(() => resolveTodosBinary(bin, {}))).toBe("DRIFT_REPORT_TODOS_UNSAFE");
  chmodSync(bin, 0o707); expect(code(() => resolveTodosBinary(bin, {}))).toBe("DRIFT_REPORT_TODOS_UNSAFE");
  chmodSync(bin, 0o600); expect(code(() => resolveTodosBinary(bin, {}))).toBe("DRIFT_REPORT_TODOS_UNSAFE");
  mkdirSync(join(dir, "dir-todos")); expect(code(() => resolveTodosBinary(join(dir, "dir-todos"), {}))).toBe("DRIFT_REPORT_TODOS_UNSAFE");
  // Links are resolved and the real file is judged and run.
  chmodSync(bin, 0o755);
  const link = join(root, "link"); mkdirSync(link); symlinkSync(bin, join(link, "todos"));
  expect(resolveTodosBinary(undefined, { PATH: `relative-dir:${link}:/usr/bin` })).toBe(realpathSync(bin));
  chmodSync(bin, 0o775);
  expect(code(() => resolveTodosBinary(undefined, { PATH: link }))).toBe("DRIFT_REPORT_TODOS_UNSAFE");
  // A relative PATH entry is never searched.
  const relativeOnly = mkdtempSync(join(root, "cwd-"));
  expect(code(() => resolveTodosBinary(undefined, { PATH: `.:bin:${relativeOnly}` }))).toBe("DRIFT_REPORT_TODOS_NOT_FOUND");
});

test("the target and station come from validated settings, environment first", () => {
  const root = scratch();
  expect(resolveDriftReportTarget(root, {})).toEqual({ configured: false });
  expect(resolveDriftReportTarget(root, { HASNA_SKILLS_DRIFT_REPORT_PROJECT: PROJECT })).toEqual({ configured: false, code: "DRIFT_REPORT_CONFIG_INVALID" });
  expect(resolveDriftReportTarget(root, { HASNA_SKILLS_DRIFT_REPORT_PROJECT: PROJECT, HASNA_SKILLS_DRIFT_REPORT_ASSIGNEE: "Bad Owner" })).toEqual({ configured: false, code: "DRIFT_REPORT_CONFIG_INVALID" });
  expect(resolveDriftReportTarget(root, { HASNA_SKILLS_DRIFT_REPORT_PROJECT: PROJECT, HASNA_SKILLS_DRIFT_REPORT_ASSIGNEE: "skills-owner", HASNA_SKILLS_DRIFT_REPORT_TODOS_BIN: "todos" })).toEqual({ configured: false, code: "DRIFT_REPORT_CONFIG_INVALID" });
  // The global Skills configuration supplies station settings; the environment wins.
  writeFileSync(join(root, "config.json"), JSON.stringify({ driftReportProject: PROJECT.toUpperCase(), driftReportAssignee: "skills-owner", driftReportTodosBin: "/opt/todos/bin/todos" }));
  expect(resolveDriftReportTarget(root, {})).toEqual({ configured: true, project: PROJECT, assignee: "skills-owner", todosBin: "/opt/todos/bin/todos" });
  expect(resolveDriftReportTarget(root, { HASNA_SKILLS_DRIFT_REPORT_ASSIGNEE: "other-owner" })).toMatchObject({ configured: true, assignee: "other-owner" });
  expect(driftReportStation({ HASNA_STATION: "station 07/../x" })).toBe("station_07_.._x");
  expect(todosChildEnvironment({ HOME: "/h", PATH: "/usr/bin", TERM: "x", HASNA_STATION: "s", HASNA_SKILLS_API_KEY: SECRET, TODOS_LOCAL: "1", TODOS_AGENT_ID: "a" })).toEqual({ HOME: "/h", PATH: "/usr/bin", HASNA_STATION: "s", TODOS_AGENT_ID: "a", NO_COLOR: "1" });
});
