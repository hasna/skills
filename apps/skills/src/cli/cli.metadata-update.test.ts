import { afterEach, expect, spyOn, test } from "bun:test";
import { Command } from "commander";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as remote from "../lib/remote-client.js";
import * as output from "./output.js";
import { revisionIdOf, type RevisionContent } from "../lib/revision.js";
import { registerMetadata } from "./commands/metadata.js";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
test("CLI preview preserves a private original without writing remotely, and apply sends one guarded correction", async () => {
  const root = mkdtempSync(join(tmpdir(), "metadata-cli-"));
  const saved = join(root, "review-plan.json");
  let content: RevisionContent = { slug: "fixture-skill", displayName: "Fixture", description: "Synthetic", category: "old", tags: [], source: "custom", kind: "instruction", version: "1.0.0", skillMd: "Synthetic body excluded from output" };
  const methods: string[] = [], rendered: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("whoami")) return Response.json({ organization: { id: "fixture-org" } });
    if (path.endsWith("capabilities")) return Response.json({ contractVersion: 1, apiVersion: 1, capabilities: ["skills.registry"], permissions: { publish: true } });
    methods.push(init?.method ?? "GET");
    if (init?.method === "PATCH") {
      expect(new Headers(init.headers).get("if-match")).toBe(`"${revisionIdOf(content)}"`);
      expect(JSON.parse(String(init.body))).toEqual({ category: "new" });
      content = { ...content, category: "new" };
    }
    return Response.json({ ...content, source: "remote", publishedSource: "custom", revisionId: revisionIdOf(content) }, { headers: { ETag: `"${revisionIdOf(content)}"` } });
  }) as typeof fetch;
  const factory = spyOn(remote, "createRemoteSkillsClient").mockResolvedValue(new remote.RemoteSkillsClient("synthetic", "https://example.invalid"));
  const writer = spyOn(output, "writeCliOutput").mockImplementation(async value => { rendered.push(String(value)); });
  try {
    const preview = new Command(); registerMetadata(preview);
    await preview.parseAsync(["metadata", "preview", "fixture-skill", "--category", "new", "--save", saved], { from: "user" });
    expect(methods).toEqual(["GET"]);
    expect(statSync(saved).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(saved, "utf8")).before.skillMd).toBe(content.skillMd);
    expect(rendered.join("\n")).not.toContain(content.skillMd!);
    const apply = new Command(); registerMetadata(apply);
    await apply.parseAsync(["metadata", "apply", "--file", saved], { from: "user" });
    expect(methods.filter(method => method === "PATCH")).toHaveLength(1);
    expect(JSON.parse(rendered.at(-1)!)).toMatchObject({ status: "applied" });
  } finally { factory.mockRestore(); writer.mockRestore(); rmSync(root, { recursive: true, force: true }); }
});
