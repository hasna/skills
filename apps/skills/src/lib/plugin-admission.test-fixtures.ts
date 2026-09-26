import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { packSkillBundle, type SkillBundleEntry } from "./skill-bundle.js";
import { pluginTreeDigest, type PluginProjectionManifest } from "./plugin-projection.js";
import { pluginExecutableDigest } from "./plugin-projection-store.js";
import type { PluginAdmissionTarget } from "./plugin-admission.js";
import type { AuthenticatedProfilePrincipal, ProfileClient } from "./profile-client.js";
import type { ResolvedSkillProfile } from "../types/skill-selection.js";

export const syntheticEntry = (path: string, text: string, mode = 0o644): SkillBundleEntry => ({ path, bytes: new TextEncoder().encode(text), mode });
export function putSynthetic(path: string, text: string, mode = 0o644): void { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); writeFileSync(path, text, { mode }); chmodSync(path, mode); }
export function packSynthetic(path: string, entries: SkillBundleEntry[]) {
  for (const item of entries) { mkdirSync(dirname(join(path, item.path)), { recursive: true, mode: 0o700 }); writeFileSync(join(path, item.path), item.bytes, { mode: item.mode }); }
  return packSkillBundle(path);
}
export function pluginFixture(root: string, options: { versionless?: boolean } = {}) {
  const executable = join(root, "synthetic-executable"); putSynthetic(executable, "#!/bin/sh\nexit 91\n", 0o755);
  const target: PluginAdmissionTarget = { schemaVersion: 1, pluginId: "fixture@synthetic", registrations: [{ scope: "user", projectPath: null }], native: { version: "2.1.274", executable, digest: pluginExecutableDigest(executable) }, resolver: { executable, digest: pluginExecutableDigest(executable) } };
  const payload = packSynthetic(join(root, "payload"), [syntheticEntry("SKILL.md", "---\nname: synthetic-payload\ndescription: Synthetic test payload\nkind: instruction\n---\nSynthetic hosted fixture.\n"), syntheticEntry("package.json", '{"name":"synthetic-payload","version":"1.0.0","skills":{"kind":"instruction"}}')]);
  const state = { revision: "r1", version: "1.0.0", authority: "https://example.com/skills/v1", workspace: "synthetic-workspace", principal: { userId: "synthetic-owner", accountId: "synthetic-workspace", role: "owner" } as AuthenticatedProfilePrincipal, offline: false, revoked: false, corrupt: false, bundleCalls: 0, profileCalls: 0, principalCalls: 0 };
  const bundles = new Map<string, Uint8Array<ArrayBuffer>>([["synthetic-payload@1.0.0", payload.bytes]]);
  let projectionDigest = "";
  const update = (version: string, upstreamVersion: string | null = options.versionless ? null : version) => {
    state.version = version;
    const original = [syntheticEntry(".claude-plugin/plugin.json", JSON.stringify({ name: "fixture", ...(upstreamVersion === null ? {} : { version: upstreamVersion }) })), syntheticEntry("skills/example/SKILL.md", "---\nname: example\ndescription: SYNTHETIC_SKILL_DESCRIPTION\n---\nSynthetic skill.\n"), syntheticEntry("commands/command-example.md", "---\ndescription: SYNTHETIC_COMMAND_DESCRIPTION\n---\nSynthetic command.\n"), syntheticEntry("agents/observer.md", "---\nname: observer\ndescription: Synthetic observer\n---\nSynthetic ordinary agent.\n"), syntheticEntry("hooks/hooks.json", JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "/usr/bin/true" }] }] } })), syntheticEntry(".mcp.json", '{"mcpServers":{"fixture":{"command":"/usr/bin/false","args":[]}}}'), syntheticEntry(".lsp.json", '{"fixture":{"command":"/usr/bin/false","extensionToLanguage":{".fixture":"plaintext"}}}'), syntheticEntry("assets/retained.txt", `Synthetic ordinary asset ${version}\n`)];
    if (upstreamVersion === null) original.push(syntheticEntry("README.md", "Synthetic documentation for commands/command-example.md.\n"));
    const baseManifest = { schemaVersion: 1, agent: "claude", pluginId: target.pluginId, upstream: { source: "https://example.com/synthetic", revision: `revision-${version}`, version: upstreamVersion, license: "MIT", treeDigest: pluginTreeDigest(original) }, review: { hooks: "reviewed-no-skill-injection", dependencies: "reviewed-no-retired-payload-dependency" }, payloads: original.filter(item => item.path.endsWith("SKILL.md") || item.path.startsWith("commands/")).map(item => ({ path: item.path, kind: item.path.endsWith("SKILL.md") ? "skill" : "command", sourceDigest: pluginTreeDigest([item]), target: { slug: "synthetic-payload", version: "1.0.0", bundleDigest: `sha256:${payload.sha256}` } })) };
    const manifest: PluginProjectionManifest = upstreamVersion === null
      ? { ...baseManifest, schemaVersion: 2, upstream: { ...baseManifest.upstream, revision: pluginTreeDigest(original).slice(7, 47), version: null }, review: { ...baseManifest.review, documentation: [{ path: "README.md", sourceDigest: pluginTreeDigest([original.find(item => item.path === "README.md")!]) }] } } as PluginProjectionManifest
      : baseManifest as PluginProjectionManifest;
    const archive = packSynthetic(join(root, `bundle-${version}`), [syntheticEntry("package.json", '{"name":"synthetic-integration","skills":{"kind":"instruction"}}'), syntheticEntry("SKILL.md", "---\nname: synthetic-integration\ndescription: Synthetic integration holder\nkind: instruction\n---\nSynthetic integration assets.\n"), syntheticEntry("plugin-projection.json", JSON.stringify(manifest)), ...original.map(item => ({ ...item, path: `original/${item.path}` }))]);
    projectionDigest = `sha256:${archive.sha256}`; bundles.set(`synthetic-integration@${version}`, archive.bytes);
  };
  update(state.version);
  const profile = (): ResolvedSkillProfile => ({ profileId: "synthetic-profile", authority: state.authority, workspaceId: state.workspace, profileRevision: state.revision, selections: [{ slug: "synthetic-integration", version: state.version, bundleDigest: projectionDigest }, { slug: "synthetic-payload", version: "1.0.0", bundleDigest: `sha256:${payload.sha256}` }].map(item => ({ ...item, authority: state.authority, workspaceId: state.workspace, profileRevision: state.revision })) });
  const client: ProfileClient = { get authority() { return state.authority; }, async resolvePrincipal() { state.principalCalls++; if (state.offline) throw new Error("Synthetic API refusal"); return { ...state.principal }; }, async resolveProfile() { state.profileCalls++; if (state.offline) throw new Error("Synthetic API refusal"); return profile(); }, async recordStation() { throw new Error("No writes allowed in plugin fixture"); }, async getBundle(slug, version) { state.bundleCalls++; if (state.offline) throw new Error("Synthetic API refusal"); if (state.revoked) return new Response("", { status: 403 }); const bytes = bundles.get(`${slug}@${version}`); return bytes ? new Response(state.corrupt ? new Uint8Array([0]) : bytes) : null; } };
  return { target, state, client, profile, bundles, update, options: { client, storeRoot: join(root, "admissions") } };
}
