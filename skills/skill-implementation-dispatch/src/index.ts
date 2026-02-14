#!/usr/bin/env bun

import { execFileSync, spawnSync, spawn } from "child_process";
import * as path from "path";
import minimist from "minimist";

// Validation for session names to prevent command injection
const DANGEROUS_CHARS = /[;&|`$(){}[\]<>\\!*?'"\/\n\r\t]/;

function validateSessionName(name: string): void {
  if (!name || name.length === 0) {
    throw new Error("Session name cannot be empty");
  }
  if (name.length > 100) {
    throw new Error("Session name too long (max 100 characters)");
  }
  if (DANGEROUS_CHARS.test(name)) {
    throw new Error(`Invalid characters in session name: ${name}. Session names cannot contain shell metacharacters.`);
  }
  // Tmux session names must start with alphanumeric or underscore
  if (!/^[a-zA-Z0-9_]/.test(name)) {
    throw new Error("Session name must start with a letter, number, or underscore");
  }
}

// Types
interface WindowConfig {
  name: string;
  index: number;
}

const WINDOWS: WindowConfig[] = [
  { name: "todo", index: 0 },
  { name: "plan", index: 1 },
  { name: "audit", index: 2 },
  { name: "index", index: 3 },
];

const AGENTS = ["claude", "codex", "gemini"] as const;
type Agent = (typeof AGENTS)[number];

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ["agent", "window", "message", "batch", "session"],
  boolean: ["init", "status", "attach", "help"],
  default: {
    agent: "claude",
    delay: 5,
    interval: 5,
  },
  alias: {
    a: "agent",
    w: "window",
    m: "message",
    b: "batch",
    s: "session",
    d: "delay",
    i: "interval",
    h: "help",
  },
});

// Show help
if (args.help) {
  console.log(`
Implementation Dispatch - Manage tmux sessions for implementation workflows

Usage:
  skills run implementation-dispatch [options]

Options:
  --init                  Initialize new tmux session with windows
  -a, --agent <name>      AI agent: claude, codex, gemini (default: claude)
  -w, --window <name>     Target window: todo, plan, audit, index, or all
  -m, --message <text>    Message to dispatch to window(s)
  -b, --batch <windows>   Comma-separated windows for batch dispatch
  -d, --delay <seconds>   Delay before enter key (default: 5, min: 5)
  -i, --interval <sec>    Delay between batch dispatches (default: 5, min: 5)
  -s, --session <name>    Custom session name (default: repo-impl)
  --status                Show session and window status
  --attach                Attach to session after operation
  -h, --help              Show this help

Examples:
  skills run implementation-dispatch -- --init --agent claude
  skills run implementation-dispatch -- --window todo --message "Create todo for auth"
  skills run implementation-dispatch -- --batch todo,plan --message "Start implementation"
  skills run implementation-dispatch -- --status
  skills run implementation-dispatch -- --attach
`);
  process.exit(0);
}

// Check if tmux is installed
function checkTmux(): boolean {
  try {
    execFileSync("which", ["tmux"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// Check if agent is installed (agent is already validated against AGENTS array)
function checkAgent(agent: Agent): boolean {
  try {
    execFileSync("which", [agent], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// Get default session name from current directory
function getDefaultSessionName(): string {
  // Use SKILLS_CWD if available (user's working directory from remote execution)
  const repoName = path.basename(process.env.SKILLS_CWD || process.cwd());
  return `${repoName}-impl`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

// Check if session exists (sessionName already validated)
function sessionExists(sessionName: string): boolean {
  try {
    const result = spawnSync("tmux", ["has-session", "-t", sessionName], { stdio: "pipe" });
    return result.status === 0;
  } catch {
    return false;
  }
}

// Create tmux session with windows (sessionName already validated, agent validated against AGENTS)
function createSession(sessionName: string, agent: Agent): void {
  console.log(`Creating tmux session: ${sessionName}`);
  console.log(`Agent: ${agent}\n`);

  // Create session with first window (using spawnSync with array args for safety)
  spawnSync("tmux", ["new-session", "-d", "-s", sessionName, "-n", WINDOWS[0].name], { stdio: "inherit" });
  console.log(`  Created window: ${WINDOWS[0].name}`);

  // Create remaining windows
  for (let i = 1; i < WINDOWS.length; i++) {
    const win = WINDOWS[i];
    spawnSync("tmux", ["new-window", "-t", sessionName, "-n", win.name], { stdio: "inherit" });
    console.log(`  Created window: ${win.name}`);
  }

  // Start agent in each window (agent is already validated against AGENTS array)
  console.log(`\nStarting ${agent} in each window...`);
  for (const win of WINDOWS) {
    // Send the agent command followed by Enter key
    spawnSync("tmux", ["send-keys", "-t", `${sessionName}:${win.name}`, agent, "C-m"], { stdio: "inherit" });
    console.log(`  Started ${agent} in: ${win.name}`);
  }

  console.log(`\nSession "${sessionName}" created with ${WINDOWS.length} windows.`);
  console.log(`\nTo attach: tmux attach -t "${sessionName}"`);
}

// Get session status (sessionName already validated)
function getSessionStatus(sessionName: string): void {
  console.log(`\nSession Status: ${sessionName}`);
  console.log("=".repeat(40));

  if (!sessionExists(sessionName)) {
    console.log("Session does not exist.");
    console.log(`\nCreate with: skills run implementation-dispatch -- --init`);
    return;
  }

  try {
    // Using spawnSync with array args for safety
    const result = spawnSync("tmux", [
      "list-windows",
      "-t", sessionName,
      "-F", "#{window_index}: #{window_name} (#{pane_current_command})"
    ], { encoding: "utf-8" });

    if (result.stdout) {
      console.log("\nWindows:");
      console.log(result.stdout);
    }
  } catch (error) {
    console.error("Error getting session status");
  }
}

// Sleep for specified milliseconds
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Dispatch message to a window (sessionName and windowName already validated)
async function dispatchToWindow(sessionName: string, windowName: string, message: string, delay: number): Promise<void> {
  console.log(`\nDispatching to window: ${windowName}`);
  console.log(`Message: ${message.substring(0, 50)}${message.length > 50 ? "..." : ""}`);

  // Send the message as a literal argument to tmux send-keys (no shell escaping needed with spawnSync)
  const target = `${sessionName}:${windowName}`;
  spawnSync("tmux", ["send-keys", "-t", target, message], { stdio: "inherit" });

  console.log(`  Message sent, waiting ${delay} seconds before enter...`);

  // Wait before sending enter
  await sleep(delay * 1000);

  // Send enter key
  spawnSync("tmux", ["send-keys", "-t", target, "C-m"], { stdio: "inherit" });

  console.log(`  Enter sent to ${windowName}`);
}

// Dispatch to multiple windows
async function batchDispatch(sessionName: string, windowNames: string[], message: string, delay: number, interval: number): Promise<void> {
  console.log(`\nBatch dispatch to ${windowNames.length} windows`);

  for (let i = 0; i < windowNames.length; i++) {
    const windowName = windowNames[i];

    // Validate window name
    const validWindow = WINDOWS.find((w) => w.name === windowName);
    if (!validWindow) {
      console.error(`  Invalid window name: ${windowName}`);
      continue;
    }

    await dispatchToWindow(sessionName, windowName, message, delay);

    // Wait between dispatches (except for last one)
    if (i < windowNames.length - 1) {
      console.log(`\n  Waiting ${interval} seconds before next dispatch...`);
      await sleep(interval * 1000);
    }
  }
}

// Attach to session
function attachSession(sessionName: string): void {
  console.log(`\nAttaching to session: ${sessionName}`);
  const tmux = spawn("tmux", ["attach", "-t", sessionName], {
    stdio: "inherit",
  });
  tmux.on("exit", (code) => {
    process.exit(code || 0);
  });
}

// Main execution
async function main(): Promise<void> {
  console.log(`\nImplementation Dispatch`);
  console.log(`=======================\n`);

  // Check tmux
  if (!checkTmux()) {
    console.error("Error: tmux is not installed");
    console.error("Install with: brew install tmux (macOS) or apt install tmux (Linux)");
    process.exit(1);
  }

  const sessionName = (args.session as string) || getDefaultSessionName();

  // Validate session name to prevent command injection
  try {
    validateSessionName(sessionName);
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  const agent = args.agent as Agent;
  const delay = Math.max(5, parseInt(args.delay) || 5);
  const interval = Math.max(5, parseInt(args.interval) || 5);

  // Initialize session
  if (args.init) {
    // Validate agent
    if (!AGENTS.includes(agent)) {
      console.error(`Error: Invalid agent "${agent}". Must be one of: ${AGENTS.join(", ")}`);
      process.exit(1);
    }

    // Check if agent is installed
    if (!checkAgent(agent)) {
      console.error(`Error: Agent "${agent}" is not installed or not in PATH`);
      console.error(`Install with: npm install -g @anthropic-ai/claude-code (for claude)`);
      process.exit(1);
    }

    // Check if session already exists
    if (sessionExists(sessionName)) {
      console.error(`Error: Session "${sessionName}" already exists`);
      console.error(`Kill it with: tmux kill-session -t "${sessionName}"`);
      console.error(`Or use: --session <different-name>`);
      process.exit(1);
    }

    createSession(sessionName, agent);

    if (args.attach) {
      attachSession(sessionName);
    }

    return;
  }

  // Show status
  if (args.status) {
    getSessionStatus(sessionName);
    return;
  }

  // Attach to session
  if (args.attach && !args.window && !args.batch) {
    if (!sessionExists(sessionName)) {
      console.error(`Error: Session "${sessionName}" does not exist`);
      console.error(`Create with: skills run implementation-dispatch -- --init`);
      process.exit(1);
    }
    attachSession(sessionName);
    return;
  }

  // Dispatch message
  const message = args.message as string;

  if (!message) {
    console.error("Error: --message is required for dispatch");
    console.error("Usage: skills run implementation-dispatch -- --window <name> --message <text>");
    process.exit(1);
  }

  // Check session exists
  if (!sessionExists(sessionName)) {
    console.error(`Error: Session "${sessionName}" does not exist`);
    console.error(`Create with: skills run implementation-dispatch -- --init`);
    process.exit(1);
  }

  // Batch dispatch
  if (args.batch) {
    const windowNames = (args.batch as string).split(",").map((w) => w.trim());
    await batchDispatch(sessionName, windowNames, message, delay, interval);

    if (args.attach) {
      attachSession(sessionName);
    }
    return;
  }

  // Single window dispatch
  const windowName = args.window as string;

  if (!windowName) {
    console.error("Error: --window or --batch is required");
    console.error("Usage: skills run implementation-dispatch -- --window <name> --message <text>");
    process.exit(1);
  }

  // Handle "all" window
  if (windowName === "all") {
    const allWindows = WINDOWS.map((w) => w.name);
    await batchDispatch(sessionName, allWindows, message, delay, interval);

    if (args.attach) {
      attachSession(sessionName);
    }
    return;
  }

  // Validate window name
  const validWindow = WINDOWS.find((w) => w.name === windowName);
  if (!validWindow) {
    console.error(`Error: Invalid window name "${windowName}"`);
    console.error(`Valid windows: ${WINDOWS.map((w) => w.name).join(", ")}, all`);
    process.exit(1);
  }

  await dispatchToWindow(sessionName, windowName, message, delay);

  if (args.attach) {
    attachSession(sessionName);
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`\nDispatch complete!`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
