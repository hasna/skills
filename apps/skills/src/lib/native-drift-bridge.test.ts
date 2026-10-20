import { useDefaultTestTimeout } from "../test-preload.js";
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isNativeBridgeIntegrityRefusal, isNativeSkillDrift, NATIVE_DRIFT_AGENT_NOTICE, NATIVE_DRIFT_BRIDGE_NOTICE, NativeBridgeIntegrityRefusal, NativeSkillPolicyRefusal, nativeDriftFailOpen } from "./native-drift-receipt.js";

// Review finding (2026-10-20): an unverified skills-cli bridge is not ordinary
// drift. The tool call that would load it is refused; the prompt proceeds with
// a notice that says not to invoke the bridge.
useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const scratch = () => { const root = realpathSync(mkdtempSync(join(tmpdir(), "skills-bridge-refusal-"))); roots.push(root); return root; };

test("an unverified skills-cli bridge is a policy refusal, and its prompt notice says not to invoke the bridge", () => {
  const root = scratch(), data = join(root, "data"); mkdirSync(data);
  const message = "NATIVE_SKILL_DRIFT: the native Skills bridge is missing or modified; repair it before continuing";
  const refusal = new NativeBridgeIntegrityRefusal(message);
  expect(refusal).toBeInstanceOf(NativeSkillPolicyRefusal);
  expect(isNativeBridgeIntegrityRefusal(refusal)).toBe(true);
  expect(isNativeSkillDrift(refusal)).toBe(false);
  expect(isNativeBridgeIntegrityRefusal(new NativeSkillPolicyRefusal(message))).toBe(false);
  for (const [agent, event] of [["claude", "UserPromptSubmit"], ["claude", "SessionStart"], ["codex", "SubagentStart"]] as const) {
    const output = nativeDriftFailOpen(data, agent, event, event, message, { bridgeUnverified: true }) as any;
    expect(output.decision).toBeUndefined(); expect(output.continue).toBeUndefined();
    expect(output.systemMessage).toContain("bridge is missing or modified");
    expect(output.hookSpecificOutput.additionalContext).toBe(NATIVE_DRIFT_BRIDGE_NOTICE);
    expect(NATIVE_DRIFT_BRIDGE_NOTICE).toContain("do not invoke the skills-cli native skill");
  }
  expect((nativeDriftFailOpen(data, "sumi", "UserPromptSubmit", "UserPromptSubmit", message, { bridgeUnverified: true }) as any).hookSpecificOutput.additionalContext).toEndWith(NATIVE_DRIFT_BRIDGE_NOTICE);
  expect((nativeDriftFailOpen(data, "hermes", "UserPromptSubmit", "pre_llm_call", message, { bridgeUnverified: true }) as any).context).toEndWith(NATIVE_DRIFT_BRIDGE_NOTICE);
  // Ordinary drift keeps the ordinary notice.
  expect((nativeDriftFailOpen(data, "claude", "UserPromptSubmit", "UserPromptSubmit", message) as any).hookSpecificOutput.additionalContext).toBe(NATIVE_DRIFT_AGENT_NOTICE);
});
