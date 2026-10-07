import { expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
import { SUPPORTED_CODEX_HOOK_VERSIONS, supportsCodexNativeCapability, type CodexNativeCapability } from "./codex-native-compatibility.js";
import { assertAgentPolicyCollections } from "./agent-policy-limits.js";

useDefaultTestTimeout();
const CAPABILITIES: CodexNativeCapability[] = ["hooks", "qualified-skill-catalog", "installed-plugin-review"];
const capabilities = (version: unknown) => CAPABILITIES.filter(capability => supportsCodexNativeCapability(version, capability));

test("registry admits codex-cli 0.160.1 with exactly the 0.160.0 capabilities", () => {
  expect(capabilities("codex-cli 0.160.1")).toEqual(["hooks", "qualified-skill-catalog", "installed-plugin-review"]);
  expect(capabilities("codex-cli 0.160.1")).toEqual(capabilities("codex-cli 0.160.0"));
  expect([...SUPPORTED_CODEX_HOOK_VERSIONS]).toEqual(["codex-cli 0.153.0", "codex-cli 0.154.0", "codex-cli 0.155.0", "codex-cli 0.155.1",
    "codex-cli 0.156.1", "codex-cli 0.157.0", "codex-cli 0.157.1", "codex-cli 0.158.0", "codex-cli 0.159.0", "codex-cli 0.159.2",
    "codex-cli 0.160.0", "codex-cli 0.160.1"]);
  expect(Object.isFrozen(SUPPORTED_CODEX_HOOK_VERSIONS)).toBe(true);
});

test("registry refuses unmeasured neighbours and malformed version strings for every capability", () => {
  const refused: unknown[] = [
    "codex-cli 0.160.2", "codex-cli 0.161.0", "codex-cli 0.159.1", "codex-cli 0.159.3", "codex-cli 0.160.10", "codex-cli 0.16.1",
    "codex-cli 1.160.1", "codex-cli 0.160.1-alpha.1", "codex-cli 0.160.1-rc.1", "codex-cli 0.160.1+build.1", "codex-cli 0.160.01",
    "codex-cli 0.160", "codex-cli 0.160.x", "codex-cli 0.160.*", "codex-cli >=0.160.0", "codex-cli ^0.160.0", "codex-cli ~0.160.1",
    "0.160.1", "v0.160.1", "codex-cli v0.160.1", "Codex-CLI 0.160.1", "codex 0.160.1", "codex-cli  0.160.1", " codex-cli 0.160.1",
    "codex-cli 0.160.1 ", "codex-cli 0.160.1\n", "codex-cli\t0.160.1", "codex-cli 0.160.1\0", "", "toString", "__proto__",
    "constructor", "hasOwnProperty", undefined, null, 0.1601, ["codex-cli 0.160.1"], { version: "codex-cli 0.160.1" },
  ];
  for (const version of refused) expect({ version, capabilities: capabilities(version) }).toEqual({ version, capabilities: [] });
  for (const version of refused) expect((SUPPORTED_CODEX_HOOK_VERSIONS as readonly unknown[]).includes(version)).toBe(false);
});

test("existing admitted versions keep their exact hook and catalog capabilities", () => {
  for (const version of ["0.153.0", "0.154.0", "0.155.0", "0.155.1", "0.156.1", "0.157.0", "0.157.1", "0.158.0", "0.159.0"])
    expect({ version, hooks: supportsCodexNativeCapability(`codex-cli ${version}`, "hooks"), catalog: supportsCodexNativeCapability(`codex-cli ${version}`, "qualified-skill-catalog") })
      .toEqual({ version, hooks: true, catalog: false });
  for (const version of ["0.159.2", "0.160.0"])
    expect({ version, hooks: supportsCodexNativeCapability(`codex-cli ${version}`, "hooks"), catalog: supportsCodexNativeCapability(`codex-cli ${version}`, "qualified-skill-catalog") })
      .toEqual({ version, hooks: true, catalog: true });
  // Releases between measured entries were never admitted and stay refused.
  for (const version of ["0.152.0", "0.156.0", "0.159.1", "0.159.3"]) expect(supportsCodexNativeCapability(`codex-cli ${version}`, "hooks")).toBe(false);
});

const digest = (character: string) => character.repeat(64);
function installationPolicy(proofVersion: unknown, reviewVersion: unknown) {
  return { bridge: {
    codexPluginSkillReview: { version: reviewVersion, catalogSha256: digest("a") },
    discovery: { codex: { agent: "codex", method: "reviewed", roots: [], sources: [], codexInstallationInputs: { version: proofVersion, catalogSha256: digest("a"),
      plugins: [{ pluginId: "vendor@probe", namespace: "vendor", pluginParent: "/synthetic/.codex/plugins/cache/probe/vendor", sourceRoot: "/synthetic/input/vendor", sourceSha256: digest("b") }] } } },
  } };
}
const inactivePolicy = (version: unknown) => ({ bridge: {
  codexPluginSkillReview: { version, catalogSha256: digest("a") },
  codexInactivePlugins: [{ pluginId: "inactive@probe", namespace: "inactive", pluginParent: "/synthetic/.codex/plugins/cache/probe/inactive", sourceType: "local", sourceSha256: digest("b") }],
} });

test("stored 0.160.1 installation inputs and inactive plugin reviews are admitted with matching review evidence", () => {
  expect(() => assertAgentPolicyCollections(installationPolicy("codex-cli 0.160.1", "codex-cli 0.160.1"))).not.toThrow();
  expect(() => assertAgentPolicyCollections(inactivePolicy("codex-cli 0.160.1"))).not.toThrow();
});

test("stored installation and inactive plugin evidence refuses unmeasured, older and mismatched versions", () => {
  for (const version of ["codex-cli 0.160.0"]) {
    expect(() => assertAgentPolicyCollections(installationPolicy(version, version))).not.toThrow();
    expect(() => assertAgentPolicyCollections(inactivePolicy(version))).not.toThrow();
  }
  for (const version of ["codex-cli 0.159.2", "codex-cli 0.160.2", "codex-cli 0.161.0", "codex-cli 0.160.1-alpha.1", "0.160.1", undefined]) {
    expect(() => assertAgentPolicyCollections(installationPolicy(version, version))).toThrow("bounds are invalid");
    expect(() => assertAgentPolicyCollections(inactivePolicy(version))).toThrow("bounds are invalid");
  }
  // The proof must name the same admitted release as the catalog review it binds.
  for (const [proof, review] of [["codex-cli 0.160.1", "codex-cli 0.160.0"], ["codex-cli 0.160.0", "codex-cli 0.160.1"], ["codex-cli 0.160.1", "codex-cli 0.160.2"]])
    expect(() => assertAgentPolicyCollections(installationPolicy(proof, review))).toThrow("bounds are invalid");
});
