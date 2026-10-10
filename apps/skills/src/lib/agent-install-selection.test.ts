import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectedIntegrationAgents } from "./agent-install-selection.js";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration } from "./agent-integration.js";

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "skills-agent-presence-")); homes.push(home);
  const dataDir = join(home, "skills-data"), bin = join(home, "bin"); mkdirSync(bin);
  const env: NodeJS.ProcessEnv = { PATH: bin };
  return { home, bin, dataDir, env,
    detect: () => detectedIntegrationAgents({ home, dataDir, env, cwd: home }),
    policy: (text: string) => { mkdirSync(dataDir, { recursive: true }); writeFileSync(join(dataDir, "agent-policy.json"), text); },
  };
}

test("provider-specific homes identify native and GUI consumers; shared roots do not", () => {
  const f = fixture(); mkdirSync(join(f.home, ".agents", "skills"), { recursive: true });
  expect(f.detect).toThrow("No configured or detected agents");
  mkdirSync(join(f.home, ".claude")); mkdirSync(join(f.home, ".codex")); mkdirSync(join(f.home, ".cursor")); mkdirSync(join(f.home, ".opencode"));
  expect(f.detect()).toEqual(["claude", "codex", "opencode", "cursor"]);
});

test("metadata-only executable discovery selects every native adapter without running its CLI", () => {
  const f = fixture(), marker = join(f.home, "executed");
  for (const agent of ["claude", "codex", "gemini", "opencode", "cursor", "hermes", "sumi"]) {
    writeFileSync(join(f.bin, agent), `#!/bin/sh\nprintf executed > ${JSON.stringify(marker)}\n`, { mode: 0o700 });
  }
  expect(f.detect()).toEqual(["claude", "codex", "gemini", "opencode", "cursor", "hermes", "sumi"]);
  expect(existsSync(marker)).toBe(false);
});

test("configured managed consumers remain selected even if their home and CLI are missing", () => {
  const f = fixture(); f.policy(JSON.stringify({ loading: "cli", bridge: { agents: ["sumi", "claude"] } }));
  expect(f.detect()).toEqual(["claude", "sumi"]);
});

test("invalid managed policy never falls back to filesystem detection", () => {
  const f = fixture(); mkdirSync(join(f.home, ".claude"));
  for (const text of ["{", JSON.stringify({ loading: "cli", bridge: null }), JSON.stringify({ loading: "cli", bridge: {} }), JSON.stringify({ loading: "cli", bridge: { agents: ["unsupported"] } }), JSON.stringify({ loading: "cli", bridge: { agents: "claude" } })]) {
    f.policy(text); expect(f.detect).toThrow();
  }
});

test("dangling provider roots count as present for the strict planner to refuse", () => {
  const f = fixture(); symlinkSync(join(f.home, "missing"), join(f.home, ".claude"));
  expect(f.detect()).toEqual(["claude"]);
});

test("unreadable presence metadata refuses instead of treating a provider as absent", () => {
  const f = fixture(), config = join(f.home, ".config"); mkdirSync(join(config, "opencode"), { recursive: true });
  chmodSync(config, 0);
  try { expect(f.detect).toThrow("Agent presence cannot be inspected"); }
  finally { chmodSync(config, 0o700); }
});

test("every set Sumi selector counts as configured even when empty or malformed", () => {
  for (const key of ["SUMI_HOME", "SUMI_CONFIG_DIR", "SUMI_CONFIG", "SUMI_CONFIG_CONTENT"]) {
    for (const value of ["", "relative-or-invalid"]) {
      const f = fixture(); f.env[key] = value; expect(f.detect()).toEqual(["sumi"]);
    }
  }
  const f = fixture(); f.env.XDG_CONFIG_HOME = join(f.home, "xdg");
  expect(f.detect).toThrow("No configured or detected agents");
});

test("owned legacy Sumi home and dedicated helper are independent presence signals", () => {
  const f = fixture(); mkdirSync(join(f.home, ".sumi")); expect(f.detect()).toEqual(["sumi"]);
  const g = fixture(); writeFileSync(join(g.bin, "sumi-paths"), "#!/bin/sh\nexit 1\n", { mode: 0o700 });
  expect(g.detect()).toEqual(["sumi"]);
});

test("existing legacy and XDG Sumi configuration roots are presence without a CLI or helper", () => {
  const legacy = fixture(); mkdirSync(join(legacy.home, ".config", "sumi"), { recursive: true });
  writeFileSync(join(legacy.home, ".config", "sumi", "sumi.json"), "{");
  expect(legacy.detect()).toEqual(["sumi"]);
  const xdg = fixture(); xdg.env.XDG_CONFIG_HOME = join(xdg.home, "xdg"); mkdirSync(join(xdg.env.XDG_CONFIG_HOME, "sumi"), { recursive: true });
  expect(xdg.detect()).toEqual(["sumi"]);
});

test("generic XDG configuration alone and blank selectors do not establish Sumi presence", () => {
  const f = fixture(); const base = join(f.home, "xdg"); mkdirSync(base);
  for (const value of [base, "", "   "]) { f.env.XDG_CONFIG_HOME = value; expect(f.detect).toThrow("No configured or detected agents"); }
});

test("Sumi XDG presence follows the owning protocol's relative and home expansion", () => {
  for (const value of ["xdg", "~/xdg", "~\\xdg"]) {
    const f = fixture(); mkdirSync(join(f.home, "xdg", "sumi"), { recursive: true }); f.env.XDG_CONFIG_HOME = value;
    expect(f.detect()).toEqual(["sumi"]);
  }
});

test("dangling and inaccessible Sumi configuration roots are not silently omitted", () => {
  for (const xdg of [false, true]) {
    const f = fixture(), base = join(f.home, xdg ? "xdg" : ".config"); mkdirSync(base);
    if (xdg) f.env.XDG_CONFIG_HOME = base;
    symlinkSync(join(f.home, "missing"), join(base, "sumi")); expect(f.detect()).toEqual(["sumi"]);
    const g = fixture(), parent = join(g.home, xdg ? "xdg" : ".config"), root = join(parent, "sumi"); mkdirSync(root, { recursive: true });
    if (xdg) g.env.XDG_CONFIG_HOME = parent;
    chmodSync(root, 0);
    try { expect(g.detect()).toEqual(["sumi"]); }
    finally { chmodSync(root, 0o700); }
  }
  const f = fixture(), base = join(f.home, "inaccessible-xdg"); mkdirSync(base); f.env.XDG_CONFIG_HOME = base; chmodSync(base, 0);
  try { expect(f.detect).toThrow("Agent presence cannot be inspected"); }
  finally { chmodSync(base, 0o700); }
});

test("runtime Claude native drift recovery names only the selected adapter", () => {
  const f = fixture(); applyAgentIntegration(planAgentIntegration({ home: f.home, dataDir: f.dataDir, agents: ["claude"], projectDir: f.home }));
  const skill = join(f.home, ".claude", "skills", "unmanaged"); mkdirSync(skill);
  writeFileSync(join(skill, "SKILL.md"), "Synthetic native instructions\n");
  expect(() => assertManagedAgentBridge("claude", { home: f.home, dataDir: f.dataDir, projectDir: f.home }))
    .toThrow("Review skills migrate native --agent claude --project");
});
