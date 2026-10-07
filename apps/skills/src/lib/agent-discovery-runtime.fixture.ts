/** Child-process runner for PATH-sensitive discovery tests. Bun.which reads the
 * PATH a process starts with, so each step runs in its own child with the PATH
 * under test. Usage: <action> <home> [nonce]; prints {ok} or {error} as JSON. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration, planClaudeHookEventsUpdate } from "./agent-integration.js";

const [action, home, nonce = "0"] = process.argv.slice(2);
if (!home) throw new Error("usage: <action> <home> [nonce]");
const dataDir = join(home, "data");
try {
  if (action === "install") applyAgentIntegration(planAgentIntegration({ home, dataDir, projectDir: home, agents: ["claude", "gemini"] }));
  else if (action === "claude-update") {
    // The cooperating-installer path a hooks bundle uses: replace one Claude
    // event, which verifies every bound agent's discovery first.
    const path = join(home, ".claude", "settings.json"), before = readFileSync(path, "utf8"), next = JSON.parse(before);
    next.hooks = { ...(next.hooks ?? {}), Stop: [{ hooks: [{ type: "command", command: `/opt/hooks/bin/stop-check ${nonce}` }] }] };
    const plan = planClaudeHookEventsUpdate({ home, dataDir, events: ["Stop"], expectedSettingsSha256: createHash("sha256").update(before).digest("hex"), replacement: JSON.stringify(next) });
    if (!plan) throw new Error("no managed policy");
    applyAgentIntegration(plan);
  } else if (action === "gemini-guard") assertManagedAgentBridge("gemini", { home, dataDir, projectDir: home });
  else throw new Error(`unknown action ${action}`);
  console.log(JSON.stringify({ ok: true }));
} catch (error) {
  console.log(JSON.stringify({ error: (error as Error).message }));
}
