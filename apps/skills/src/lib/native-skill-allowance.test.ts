import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
import type { ReviewedDiscoveryInputs } from "./agent-discovery.js";
import { applyAgentIntegration, archiveNativeSkills, assertManagedAgentBridge, inventoryNativeSkills, planAgentIntegration } from "./agent-integration.js";
import { normalizeNativeSkillAllowances } from "./native-skill-allowance.js";

// The supported allowance is exactly one reviewed Cua driver copy. These tests
// keep the positive case next to the refusals it must never relax: another
// unmanaged copy, a symlink, a changed copy and an identity that merely reuses
// the path.
useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const CUA_DOCUMENT = `---
name: cua-driver
description: Synthetic Cua driver GUI automation skill
metadata:
  version: 0.44.0
  openclaw:
    requires:
      bins:
        - cua-driver
---
# Cua Driver

Synthetic native GUI automation instructions.
`;
const OTHER_DOCUMENT = `---
name: unrelated-copy
description: Synthetic unmanaged native skill
---
Synthetic unrelated instructions.
`;

const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
function writeCuaTree(directory: string): void {
  put(join(directory, "SKILL.md"), CUA_DOCUMENT);
  put(join(directory, "references", "usage.md"), "Synthetic Cua usage.\n");
}
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "skills-cua-allowance-")); roots.push(home);
  const dataDir = join(home, ".hasna", "skills"), source = join(home, ".cua-driver", "skills", "cua-driver"), copy = join(home, ".claude", "skills", "cua-driver");
  mkdirSync(dataDir, { recursive: true });
  writeCuaTree(source); writeCuaTree(copy);
  return { home, dataDir, source, copy };
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("the exact reviewed Cua driver copy is allowed, recorded and stable across plans", () => {
  const f = fixture(), first = planAgentIntegration({ home: f.home, dataDir: f.dataDir, agents: ["claude"] });
  const entry = first.nativeSkills.find(item => item.path === f.copy);
  expect(entry).toMatchObject({ agent: "claude", managed: false, vendor: false, allowed: { id: "cua-driver" } });
  expect(first.nativeSkillAllowances).toHaveLength(1);
  expect(first.nativeSkillAllowances![0]).toEqual({
    id: "cua-driver", agent: "claude", name: "cua-driver", path: f.copy, source: f.source,
    treeSha256: entry!.hash, sourceTreeSha256: entry!.hash,
  });
  applyAgentIntegration(first);
  expect(() => assertManagedAgentBridge("claude", { home: f.home, dataDir: f.dataDir, projectDir: f.home })).not.toThrow();
  const policyText = readFileSync(join(f.dataDir, "agent-policy.json"), "utf8"), policy = JSON.parse(policyText);
  expect(policy.bridge.nativeSkillAllowances).toEqual(first.nativeSkillAllowances);

  // The allowance is part of the plan, not a discovery mutation: a second plan
  // is a no-op and the canonical discovery binding hashes identically.
  const second = planAgentIntegration({ home: f.home, dataDir: f.dataDir, agents: ["claude"] });
  expect(second.changes).toEqual([]);
  expect(digest(second.discoveryAfter)).toBe(digest(first.discoveryAfter));
  expect(second.nativeSkills.find(item => item.path === f.copy)?.allowed?.id).toBe("cua-driver");
  expect(applyAgentIntegration(second).changed).toEqual([]);
  expect(readFileSync(join(f.dataDir, "agent-policy.json"), "utf8")).toBe(policyText);
});

test("a retained reviewed Claude binding accepts the newly copied Cua skill and records the allowance", () => {
  // Station shape: a reviewed binding was captured while the Claude skills
  // folder held only the bridge. The Cua app later materializes a real copy;
  // plain `hook install` over the retained review must accept that exact
  // identity and record it in the plan instead of refusing drift.
  const home = mkdtempSync(join(tmpdir(), "skills-cua-reviewed-")); roots.push(home);
  const dataDir = join(home, ".hasna", "skills"); mkdirSync(dataDir, { recursive: true });
  applyAgentIntegration(planAgentIntegration({ home, dataDir, agents: ["claude"] }));
  const settings = join(home, ".claude", "settings.json"), registry = join(home, ".claude", "plugins", "installed_plugins.json");
  const review: ReviewedDiscoveryInputs = { version: 1, agents: [{ agent: "claude", roots: [], sources: [{ path: settings, sha256: createHash("sha256").update(readFileSync(settings)).digest("hex") }, { path: registry, sha256: null }], pluginHooks: "reviewed-no-skill-injection" }] };
  applyAgentIntegration(planAgentIntegration({ home, dataDir, agents: ["claude"], discoveryInputs: review }));
  expect(JSON.parse(readFileSync(join(dataDir, "agent-policy.json"), "utf8")).bridge.discovery.claude.method).toBe("reviewed");
  writeCuaTree(join(home, ".cua-driver", "skills", "cua-driver"));
  writeCuaTree(join(home, ".claude", "skills", "cua-driver"));
  const plan = planAgentIntegration({ home, dataDir, agents: ["claude"] });
  expect(plan.changes.map(change => change.path)).toEqual([join(dataDir, "agent-policy.json")]);
  expect(plan.nativeSkillAllowances).toHaveLength(1);
  applyAgentIntegration(plan);
  expect(() => assertManagedAgentBridge("claude", { home, dataDir, projectDir: home })).not.toThrow();
});

test("a different unmanaged native skill still refuses next to the allowed Cua copy", () => {
  const f = fixture(), other = join(f.home, ".claude", "skills", "unrelated-copy");
  applyAgentIntegration(planAgentIntegration({ home: f.home, dataDir: f.dataDir, agents: ["claude"] }));
  put(join(other, "SKILL.md"), OTHER_DOCUMENT);
  let refusal = "";
  try { assertManagedAgentBridge("claude", { home: f.home, dataDir: f.dataDir, projectDir: f.home }); } catch (error) { refusal = (error as Error).message; }
  expect(refusal).toMatch(/^NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found: /);
  expect(refusal).toContain(other);
  expect(refusal).not.toContain(f.copy);
});

test("a symlinked Cua copy is refused instead of being adopted as the allowance", () => {
  const f = fixture();
  rmSync(f.copy, { recursive: true, force: true });
  symlinkSync(f.source, f.copy, "dir");
  expect(() => planAgentIntegration({ home: f.home, dataDir: f.dataDir, agents: ["claude"] })).toThrow(/Unsupported native discovery entry|symlink/i);
});

test("a symlink inside the Cua tree still refuses even at the allowed path", () => {
  const f = fixture(), target = join(f.home, "outside-usage.md");
  writeFileSync(target, "Synthetic link target.\n");
  rmSync(join(f.copy, "references", "usage.md"));
  symlinkSync(target, join(f.copy, "references", "usage.md"), "file");
  expect(() => planAgentIntegration({ home: f.home, dataDir: f.dataDir, agents: ["claude"] })).toThrow("Refusing symlink in skill");
});

test("a modified Cua copy is not silently adopted and cannot be re-reviewed while it mismatches the Cua source", () => {
  const f = fixture();
  applyAgentIntegration(planAgentIntegration({ home: f.home, dataDir: f.dataDir, agents: ["claude"] }));
  writeFileSync(join(f.copy, "references", "usage.md"), "Locally modified after review.\n");
  expect(() => planAgentIntegration({ home: f.home, dataDir: f.dataDir, agents: ["claude"], reviewCuaDriverSkill: true })).toThrow(/no exact Cua driver skill pair was found to review/);
  let refusal = "";
  try { assertManagedAgentBridge("claude", { home: f.home, dataDir: f.dataDir, projectDir: f.home }); } catch (error) { refusal = (error as Error).message; }
  expect(refusal).toContain("Cua driver skill at this exact path is a supported allowance");
  expect(refusal).toContain("do not archive it");
  expect(refusal).toContain("--review-cua-driver-skill");
});

test("a Cua update is explicit drift until the operator re-reviews the pair", () => {
  const f = fixture();
  applyAgentIntegration(planAgentIntegration({ home: f.home, dataDir: f.dataDir, agents: ["claude"] }));
  const reviewed = JSON.parse(readFileSync(join(f.dataDir, "agent-policy.json"), "utf8")).bridge.nativeSkillAllowances[0].treeSha256;
  // The Cua app updates its own target and refreshes the Claude copy together.
  for (const directory of [f.source, f.copy]) writeFileSync(join(directory, "references", "usage.md"), "Updated by a newer Cua driver release.\n");
  expect(() => planAgentIntegration({ home: f.home, dataDir: f.dataDir, agents: ["claude"] })).toThrow(new RegExp(`changed after its reviewed allowance \\(reviewed ${reviewed}, found [0-9a-f]{64}\\)`));

  const reviewedPlan = planAgentIntegration({ home: f.home, dataDir: f.dataDir, agents: ["claude"], reviewCuaDriverSkill: true });
  const updated = reviewedPlan.nativeSkillAllowances![0]!.treeSha256;
  expect(updated).not.toBe(reviewed);
  applyAgentIntegration(reviewedPlan);
  expect(JSON.parse(readFileSync(join(f.dataDir, "agent-policy.json"), "utf8")).bridge.nativeSkillAllowances[0].treeSha256).toBe(updated);
  expect(() => assertManagedAgentBridge("claude", { home: f.home, dataDir: f.dataDir, projectDir: f.home })).not.toThrow();
});

test("the allowance follows an opted-in Claude home root alias", () => {
  const home = mkdtempSync(join(tmpdir(), "skills-cua-alias-")); roots.push(home);
  const dataDir = join(home, ".hasna", "skills"), target = join(home, "claude-state");
  mkdirSync(dataDir, { recursive: true });
  writeCuaTree(join(home, ".cua-driver", "skills", "cua-driver"));
  writeCuaTree(join(target, "skills", "cua-driver"));
  symlinkSync(target, join(home, ".claude"), "dir");
  const plan = planAgentIntegration({ home, dataDir, agents: ["claude"], allowRootAliases: true });
  expect(plan.rootAliases).toHaveLength(1);
  expect(plan.nativeSkillAllowances![0]!.path).toBe(join(target, "skills", "cua-driver"));
  applyAgentIntegration(plan);
  expect(() => assertManagedAgentBridge("claude", { home, dataDir, projectDir: home })).not.toThrow();
});

test("migration keeps the allowed Cua copy and reports it as an explicit allowance row", () => {
  const f = fixture();
  applyAgentIntegration(planAgentIntegration({ home: f.home, dataDir: f.dataDir, agents: ["claude"] }));
  const policy = JSON.parse(readFileSync(join(f.dataDir, "agent-policy.json"), "utf8"));
  const inventory = inventoryNativeSkills(f.home, { agents: ["claude"], nativeSkillAllowances: policy.bridge.nativeSkillAllowances });
  const allowed = inventory.find(entry => entry.path === f.copy);
  expect(allowed?.allowed).toEqual({ id: "cua-driver", treeSha256: allowed!.hash });
  expect(archiveNativeSkills(inventory, { dataDir: f.dataDir, includeUnmanaged: true }).entries).toEqual([]);
  expect(existsSync(join(f.copy, "SKILL.md"))).toBe(true);

  const other = join(f.home, ".claude", "skills", "unrelated-copy");
  put(join(other, "SKILL.md"), OTHER_DOCUMENT);
  const withOther = inventoryNativeSkills(f.home, { agents: ["claude"], nativeSkillAllowances: policy.bridge.nativeSkillAllowances });
  const archived = archiveNativeSkills(withOther, { dataDir: f.dataDir, includeUnmanaged: true }).entries;
  expect(archived.map(entry => entry.source)).toEqual([other]);
  expect(existsSync(f.copy)).toBe(true);
});

test("an allowance row is bound to the canonical path and home, never a blanket path list", () => {
  const f = fixture();
  const first = planAgentIntegration({ home: f.home, dataDir: f.dataDir, agents: ["claude"] });
  const allowance = first.nativeSkillAllowances![0]!;
  const other = join(f.home, ".claude", "skills", "unrelated-copy");
  put(join(other, "SKILL.md"), OTHER_DOCUMENT);
  // Copying the row onto another path is ignored even when its digest matches.
  expect(normalizeNativeSkillAllowances([{ ...allowance, path: other, treeSha256: allowance.treeSha256 }], { home: f.home, canonical: p => p })).toEqual([]);
  // Moving the same row to another home is ignored too.
  expect(normalizeNativeSkillAllowances([allowance], { home: join(f.home, "elsewhere"), canonical: p => p })).toEqual([]);
  expect(normalizeNativeSkillAllowances([allowance], { home: f.home, canonical: p => p })).toEqual([allowance]);
  // Two rows for the canonical path are ambiguous and grant nothing.
  expect(normalizeNativeSkillAllowances([allowance, { ...allowance, treeSha256: "f".repeat(64), sourceTreeSha256: "f".repeat(64) }], { home: f.home, canonical: p => p })).toEqual([]);
});
