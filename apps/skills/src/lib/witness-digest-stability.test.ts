import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashClaudePluginManifest } from "./claude-plugin-manifest-witness.js";
import { captureClaudeMarketplaceRegistry, captureClaudeMarketplaceRegistryV2 } from "./claude-marketplace-registry.js";
import { hashClaudeSettingsReplacement, hashClaudeSettingsReplacementV2, hashClaudeSettingsReplacementV3, hashClaudeSettingsReplacementV4, hashNativeJsonControls, hashSumiNativeJsonControls } from "./claude-settings-witness.js";

// Digests below were computed before the claude-marketplace-entry-v1 mode
// existed: on origin/main b37d3198, and claude-settings-v4 on f4e32f69 (#56). Adding a hash mode must leave
// every existing mode byte-identical; a change here means an existing witness
// changed meaning and every stored policy using it would drift.
const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });

const manifest = JSON.stringify({ name: "hasna-autogoal", version: "0.1.4", description: "Agent guidance", skills: "./skills", hooks: "./hooks/hooks.json", author: { name: "Hasna" } }, null, 2);
const settings = JSON.stringify({
  model: "opus", effortLevel: "high", verbose: true, editorMode: "vim", theme: "dark",
  modelSettings: { "claude-opus-4-8": { effortLevel: "xhigh" }, custom: { effortLevel: "low", maxEffortLevel: "high" } },
  enabledPlugins: { "swift-lsp@claude-plugins-official": true, "hasna-todos@hasna-native-todos": true },
  hooks: { SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: "/fixture/skills hook session-start" }] }] },
  permissions: { deny: ["Skill(*)"] }, unknownFuture: { nested: [1, 2.50, -0, 12345678901234567890] },
}, null, 2);
const registry = JSON.stringify({
  "claude-plugins-official": { source: { source: "github", repo: "anthropics/claude-plugins-official" }, installLocation: "/fixture/home/.claude/plugins/marketplaces/claude-plugins-official", lastUpdated: "2026-10-07T12:00:00.000Z" },
  "hasna-native-todos": { source: { source: "directory", path: "/fixture/mods/todos" }, installLocation: "/fixture/mods/todos", lastUpdated: "2026-10-01T08:30:00.000Z", autoUpdate: false },
}, null, 2);
const sumi = JSON.stringify({ $schema: "https://example.invalid/sumi.json", username: "owner", experimental: { statusline: true, other: 1 }, permissions: [{ action: "skill", resource: "*", effect: "deny" }] });

test("existing witness digests stay byte-identical after adding claude-marketplace-entry-v1", () => {
  expect(hashClaudePluginManifest(manifest)).toBe("447192c11931ecfbd426643e3563a70875eaa0b557aee4b16d1bd30847e22150");
  expect(hashClaudeSettingsReplacement(settings, { remaining: 1 << 20 })).toBe("d1fb099da0f710f65cf3d73b9a7c0d44a1c3a1aa39360d4b3abac6b4bf8b5467");
  expect(hashClaudeSettingsReplacementV2(settings, { remaining: 1 << 20 })).toBe("abb2bab7b8f99bd6b7cf87694bd800420ccc6d1ae5b860a84de3efd712de02b6");
  expect(hashClaudeSettingsReplacementV3(settings, { remaining: 1 << 20 })).toBe("c20f02acae11997540641d20024be17a3277374b6d1ffd15d0030c5cc14ec621");
  expect(hashClaudeSettingsReplacementV4(settings, { remaining: 1 << 20 })).toBe("57b6afc370e18b41c902e123b14e226f433731b90ff049aa4dc65ff6f3934669");
  expect(hashNativeJsonControls(settings)).toBe("d0c45f23464bd4c28121184af86e9730d40d3104422620a8d13016287d10b74e");
  expect(hashNativeJsonControls(JSON.stringify({ version: "1.2.3", enabled: true }), "version")).toBe("8c4bbd42896c3aeb22b7f61f3af6fef84541c160f4f292fc9180e5aa3fb0ae2d");
  expect(hashSumiNativeJsonControls(sumi)).toBe("139bcdd949961b2df63766b4d1db36f676f59308de7f4a22708418cdc98226dd");

  const home = realpathSync(mkdtempSync(join(tmpdir(), "skills-witness-stability-")));
  homes.push(home);
  const path = join(home, ".claude/plugins/known_marketplaces.json");
  mkdirSync(join(home, ".claude/plugins"), { recursive: true });
  writeFileSync(path, registry);
  expect(captureClaudeMarketplaceRegistry(path).sha256).toBe("84e8414a4a94ef8dd20aec0d538add2fd5cca779adc8605701ba077d320b5874");
  expect(captureClaudeMarketplaceRegistryV2(path).sha256).toBe("1aed9a0ec46c137d72971555967c56813bdb51d77e659bb72c46a31e2d31b4cf");
});
