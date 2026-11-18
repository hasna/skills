/**
 * Native drift owner report (HC-01432): the receipt records the report's
 * state, the agent notice says what really happened, an unconfigured station
 * starts nothing, a configured one starts exactly one worker under its lock,
 * and the worker files one task through a fake `todos` executable, then finds
 * that task instead of filing again. The worker runs in process here; no
 * detached process is started.
 */
import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
import { clearNativeDriftReceipt, nativeDriftAgentNotice, nativeDriftBridgeNotice, nativeDriftFailOpen, readNativeDriftReceipts, recordNativeDriftReceipt, runNativeDriftReport } from "./native-drift-receipt.js";
import {
  DRIFT_REPORT_RETRY_MS, DRIFT_REPORT_WORKER_DEADLINE_MS, DriftReportError, driftReasonKeySha256, driftReportDescription, driftReportKey, driftReportStation, planNativeDriftReport,
  resolveDriftReportTarget, resolveTodosBinary, runTodosChild, todosChildEnvironment, withHomeAsTilde,
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
  const key = driftReportKey("station-test", "claude", driftReasonKeySha256(receipt.reason));
  expect(key).toBe(`[skills-drift station-test:claude:${driftReasonKeySha256(receipt.reason).slice(0, 12)}]`);
  const [task] = todos.tasks();
  expect(task).toMatchObject({ title: `Skills native discovery drift on station-test (claude) ${key}`, project_id: PROJECT, assigned_to: "skills-owner", tags: ["skills-drift"] });
  // The description is safe metadata only, and it travels on stdin.
  for (const field of ["- Station: station-test", "- Agent: claude", "- Event: UserPromptSubmit", "/home/u/.claude/settings.json", `- Reason SHA-256: ${receipt.reasonSha256}`, "- First seen: 2026-11-18T10:00:00.000Z", "- Occurrences: 1", "skills hook install --agent claude --apply", "- Receipt: ~/data/native-drift/claude.json"]) expect(task.description).toContain(field);
  expect(task.description).not.toContain(SECRET);
  expect(task.description).not.toContain(s.root);
  // The task carries no due date.
  expect(todos.argv().flat()).not.toContain("--due");
  // The lock is released and the next prompt names the task.
  expect(existsSync(join(s.data, "native-drift", "claude.report.lock"))).toBe(false);
  expect(s.prompt().hookSpecificOutput.additionalContext).toBe("Skills context is unavailable for this turn because the station's native skill discovery changed; this station recorded it and filed one task for the Skills owner (Todos SKD-00001). Continue the user's task. Load a selected skill explicitly with `skills load <slug>` if one is needed, and do not load native skill copies.");
  expect(s.spawned).toHaveLength(1);

  // A later episode of the same drift within the retry window reuses the
  // filed task and starts no worker.
  clearNativeDriftReceipt(s.data, "claude");
  s.advance(60_000);
  expect(s.prompt().hookSpecificOutput.additionalContext).toContain("filed one task for the Skills owner (Todos SKD-00001)");
  expect(s.spawned).toHaveLength(1);
  // After the window, another episode, or another session after a restart,
  // finds the open task instead of filing again.
  clearNativeDriftReceipt(s.data, "claude");
  s.advance(DRIFT_REPORT_RETRY_MS);
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
  // Only the todos CLI's own names and the shared Hasna home, profile and
  // station names: another app's credentials, a local store, a direct
  // database or storage route and server-side keys are not passed.
  expect(todosChildEnvironment({
    HOME: "/h", HASNA_PROFILE: "p", HASNA_CONFIG_HOME: "/h/c", HASNA_MAILERY_API_KEY: SECRET, HASNA_API_KEY: SECRET, HASNA_TODOS_API_KEY: "kept", HASNA_TODOS_API_URL: "https://todos.invalid",
    TODOS_DB_PATH: "/x.db", HASNA_TODOS_DB_PATH: "/y.db", HASNA_TODOS_DATABASE_URL: SECRET, TODOS_DATABASE_SSL: "1", HASNA_TODOS_S3_SECRET_ACCESS_KEY: SECRET, HASNA_TODOS_SERVER_API_KEY: SECRET,
    HASNA_TODOS_API_SIGNING_KEY: SECRET, HASNA_TODOS_RDS_CLUSTER: "c", HASNA_TODOS_LOCAL: "1", TODOS_PROFILE: "t",
  })).toEqual({ HOME: "/h", HASNA_PROFILE: "p", HASNA_CONFIG_HOME: "/h/c", HASNA_TODOS_API_KEY: "kept", HASNA_TODOS_API_URL: "https://todos.invalid", TODOS_PROFILE: "t", NO_COLOR: "1" });
});

// ---------------------------------------------------------------- HC-01435 bounds

/** A receipt for a given drift message, written the way the hook writes it. */
function promptWith(s: ReturnType<typeof station>, message: string, report = s.report) {
  return nativeDriftFailOpen(s.data, "claude", "UserPromptSubmit", "UserPromptSubmit", message, { report }) as any;
}

test("a reason that flips back and forth, or clears and reopens, reuses its filed task and starts no new worker", async () => {
  const s = station();
  const todos = fakeTodos(s.root);
  Object.assign(s.env, { HASNA_SKILLS_DRIFT_REPORT_PROJECT: PROJECT, HASNA_SKILLS_DRIFT_REPORT_ASSIGNEE: "skills-owner", HASNA_SKILLS_DRIFT_REPORT_TODOS_BIN: todos.bin });
  const A = MESSAGE, B = "NATIVE_SKILL_DRIFT: Native discovery input changed; run skills hook install with a fresh discovery review: /home/u/.codex/config.toml extra";
  promptWith(s, A);
  await runNativeDriftReport(s.data, "claude", s.spawned[0]![5]!, { env: s.env, now: () => Date.parse("2026-11-18T10:00:05.000Z") });
  s.advance(10_000); promptWith(s, B);
  expect(s.spawned).toHaveLength(2);
  await runNativeDriftReport(s.data, "claude", s.spawned[1]![5]!, { env: s.env, now: () => Date.parse("2026-11-18T10:00:15.000Z") });
  expect(todos.tasks()).toHaveLength(2);
  // A, B, A, B, cleared, A again: each reason is remembered, so no new worker.
  for (const message of [A, B, A, B]) { s.advance(5_000); expect(promptWith(s, message).hookSpecificOutput.additionalContext).toMatch(/filed one task for the Skills owner \(Todos SKD-0000[12]\)/); }
  clearNativeDriftReceipt(s.data, "claude"); s.advance(5_000);
  expect(promptWith(s, A).hookSpecificOutput.additionalContext).toContain("(Todos SKD-00001)");
  expect(s.spawned).toHaveLength(2);
  expect(todos.argv().filter(args => args.includes("add"))).toHaveLength(2);
});

test("reasons that differ only in their paths key one task", () => {
  const one = "NATIVE_SKILL_DRIFT: native skill copy /Users/a/work/p1/.claude/skills/skills-cli differs from the bridge";
  const two = "NATIVE_SKILL_DRIFT: native skill copy /Users/a/work/p2/.claude/skills/skills-cli differs from the bridge";
  const three = "NATIVE_SKILL_DRIFT: native skill copy ~/x/.claude/skills/skills-cli  differs from the bridge";
  expect(driftReasonKeySha256(one)).toBe(driftReasonKeySha256(two));
  expect(driftReasonKeySha256(one)).toBe(driftReasonKeySha256(three));
  expect(driftReasonKeySha256(one)).not.toBe(driftReasonKeySha256("NATIVE_SKILL_DRIFT: plugin root added /Users/a/x"));
});

test("a failure of the todos CLI holds every reason for the retry window; a changed receipt holds none", async () => {
  const s = station();
  const todos = fakeTodos(s.root);
  writeFileSync(todos.bin, "#!/bin/sh\nexit 3\n"); chmodSync(todos.bin, 0o700);
  Object.assign(s.env, { HASNA_SKILLS_DRIFT_REPORT_PROJECT: PROJECT, HASNA_SKILLS_DRIFT_REPORT_ASSIGNEE: "skills-owner", HASNA_SKILLS_DRIFT_REPORT_TODOS_BIN: todos.bin });
  promptWith(s, MESSAGE);
  await runNativeDriftReport(s.data, "claude", s.spawned[0]![5]!, { env: s.env, now: () => Date.parse("2026-11-18T10:00:05.000Z") });
  // A different reason within the window starts nothing and says the report failed.
  s.advance(60_000);
  expect(promptWith(s, `${MESSAGE} (another cause)`).hookSpecificOutput.additionalContext).toContain("the owner report failed");
  expect(s.spawned).toHaveLength(1);
  s.advance(DRIFT_REPORT_RETRY_MS);
  promptWith(s, `${MESSAGE} (another cause)`);
  expect(s.spawned).toHaveLength(2);
  // The receipt changes before the worker runs: that failure is the reason's own.
  const s2 = station();
  Object.assign(s2.env, { HASNA_SKILLS_DRIFT_REPORT_PROJECT: PROJECT, HASNA_SKILLS_DRIFT_REPORT_ASSIGNEE: "skills-owner", HASNA_SKILLS_DRIFT_REPORT_TODOS_BIN: todos.bin });
  promptWith(s2, MESSAGE);
  clearNativeDriftReceipt(s2.data, "claude");
  expect(await runNativeDriftReport(s2.data, "claude", s2.spawned[0]![5]!, { env: s2.env })).toMatchObject({ status: "failed", report: { code: "DRIFT_RECEIPT_CHANGED" } });
  s2.advance(1_000); promptWith(s2, `${MESSAGE} (next)`);
  expect(s2.spawned).toHaveLength(2);
});

test("a lock path no worker can hold is reported as failed, and a lock dated in the future expires", () => {
  const s = station();
  Object.assign(s.env, { HASNA_SKILLS_DRIFT_REPORT_PROJECT: PROJECT, HASNA_SKILLS_DRIFT_REPORT_ASSIGNEE: "skills-owner" });
  mkdirSync(join(s.data, "native-drift"), { recursive: true });
  const lock = join(s.data, "native-drift", "claude.report.lock");
  mkdirSync(lock);
  expect(promptWith(s, MESSAGE).hookSpecificOutput.additionalContext).toContain("the owner report failed");
  expect(s.receipt().report).toMatchObject({ status: "failed", code: "DRIFT_REPORT_LOCK_UNUSABLE" });
  expect(s.spawned).toEqual([]);
  rmSync(lock, { recursive: true });
  // A lock written under a clock that has since gone back an hour.
  const s2 = station();
  Object.assign(s2.env, { HASNA_SKILLS_DRIFT_REPORT_PROJECT: PROJECT, HASNA_SKILLS_DRIFT_REPORT_ASSIGNEE: "skills-owner" });
  mkdirSync(join(s2.data, "native-drift"), { recursive: true });
  writeFileSync(join(s2.data, "native-drift", "claude.report.lock"), JSON.stringify({ schema: "hasna.skills.native-drift-report-lock.v1", agent: "claude", operationId: "00000000-0000-4000-8000-000000000000", createdAt: "2026-11-18T11:00:00.000Z", spawnerPid: 1 }));
  promptWith(s2, MESSAGE);
  expect(s2.spawned).toHaveLength(1);
});

test("the worker stops before its deadline and creates nothing once it no longer owns the lock", async () => {
  const s = station();
  const todos = fakeTodos(s.root);
  Object.assign(s.env, { HASNA_SKILLS_DRIFT_REPORT_PROJECT: PROJECT, HASNA_SKILLS_DRIFT_REPORT_ASSIGNEE: "skills-owner", HASNA_SKILLS_DRIFT_REPORT_TODOS_BIN: todos.bin });
  promptWith(s, MESSAGE);
  // A clock that jumps past the deadline after the first call.
  let calls = 0; const base = Date.parse("2026-11-18T10:00:05.000Z");
  const late = await runNativeDriftReport(s.data, "claude", s.spawned[0]![5]!, { env: s.env, now: () => base + (calls++ > 1 ? DRIFT_REPORT_WORKER_DEADLINE_MS : 0) });
  expect(late).toMatchObject({ status: "failed", report: { code: "DRIFT_REPORT_DEADLINE" } });
  expect(todos.argv().filter(args => args.includes("add"))).toHaveLength(0);
  // The lock is taken over while the worker searches: it does not create.
  const s2 = station();
  const todos2 = fakeTodos(s2.root);
  Object.assign(s2.env, { HASNA_SKILLS_DRIFT_REPORT_PROJECT: PROJECT, HASNA_SKILLS_DRIFT_REPORT_ASSIGNEE: "skills-owner", HASNA_SKILLS_DRIFT_REPORT_TODOS_BIN: todos2.bin });
  promptWith(s2, MESSAGE);
  const lockPath = join(s2.data, "native-drift", "claude.report.lock");
  const runTodos = async (command: string, args: string[], input: string | undefined, env: Record<string, string>, timeoutMs: number) => {
    const result = await runTodosChild(command, args, input, env, timeoutMs);
    if (args.includes("list")) writeFileSync(lockPath, JSON.stringify({ schema: "hasna.skills.native-drift-report-lock.v1", agent: "claude", operationId: "00000000-0000-4000-8000-000000000000", createdAt: new Date().toISOString(), spawnerPid: 1 }));
    return result;
  };
  expect(await runNativeDriftReport(s2.data, "claude", s2.spawned[0]![5]!, { env: s2.env, runTodos })).toMatchObject({ status: "failed", report: { code: "DRIFT_REPORT_LOCK_LOST" } });
  expect(todos2.tasks()).toHaveLength(0);
});

test("a todos call runs in its own process group from /, capped, and is not held open by a grandchild", async () => {
  const root = scratch();
  const script = join(root, "child.sh");
  // Prints its working folder, then leaves a grandchild holding stdout open.
  writeFileSync(script, "#!/bin/sh\npwd\nsleep 30 &\nexit 0\n"); chmodSync(script, 0o700);
  const started = Date.now();
  const result = await runTodosChild(script, [], undefined, { PATH: "/usr/bin:/bin" }, 20_000);
  expect(result).toMatchObject({ exitCode: 0, timedOut: false });
  expect(result.stdout.trim()).toBe("/");
  expect(Date.now() - started).toBeLessThan(10_000);
  // A child that never ends is killed with its whole group at the limit.
  writeFileSync(script, "#!/bin/sh\nsleep 30 &\nsleep 30\n"); chmodSync(script, 0o700);
  const hung = await runTodosChild(script, [], undefined, { PATH: "/usr/bin:/bin" }, 500);
  expect(hung.timedOut).toBe(true);
  // Output past the cap is never buffered whole.
  writeFileSync(script, "#!/bin/sh\nhead -c 9000000 /dev/zero\nsleep 30\n"); chmodSync(script, 0o700);
  const large = await runTodosChild(script, [], undefined, { PATH: "/usr/bin:/bin" }, 20_000);
  expect(large).toMatchObject({ outputTooLarge: true, stdout: "", exitCode: null });
});

test("a todos executable in a folder others can write to is refused", () => {
  const root = scratch(), dir = join(root, "shared"); mkdirSync(dir);
  const bin = join(dir, "todos"); writeFileSync(bin, "#!/bin/sh\n"); chmodSync(bin, 0o700);
  expect(resolveTodosBinary(bin, {})).toBe(realpathSync(bin));
  chmodSync(dir, 0o777);
  expect(() => resolveTodosBinary(bin, {})).toThrow("DRIFT_REPORT_TODOS_UNSAFE");
  // A sticky shared folder (as /tmp is) cannot have the file swapped by others.
  // Bun's chmodSync drops the sticky bit, so the system chmod sets it.
  expect(Bun.spawnSync(["chmod", "1777", dir]).exitCode).toBe(0);
  expect(lstatSync(dir).mode & 0o1777).toBe(0o1777);
  expect(resolveTodosBinary(bin, {})).toBe(realpathSync(bin));
  chmodSync(dir, 0o700);
});

test("the description writes the home folder as ~ and cuts the reason", () => {
  expect(withHomeAsTilde("/Users/andrei/.claude/settings.json and /Users/andrei", "/Users/andrei")).toBe("~/.claude/settings.json and ~");
  expect(withHomeAsTilde("/Users/andreiX/file and /Users/andrei/f", "/Users/andrei/")).toBe("/Users/andreiX/file and ~/f");
  expect(withHomeAsTilde("/a/b", "/")).toBe("/a/b");
  const receipt = { agent: "claude", status: "active" as const, event: "UserPromptSubmit", reason: "r", reasonSha256: "a".repeat(64), repair: "x", firstSeenAt: "2026-11-18T10:00:00.000Z", lastSeenAt: "2026-11-18T10:00:00.000Z", occurrences: 1, path: "/Users/andrei/.hasna/skills/native-drift/claude.json" };
  const text = driftReportDescription("st", receipt, "drift at /Users/andrei/.claude/settings.json", "/Users/andrei");
  expect(text).toContain("- Reason: drift at ~/.claude/settings.json");
  expect(text).toContain("- Receipt: ~/.hasna/skills/native-drift/claude.json");
  expect(text).not.toContain("/Users/andrei");
});
