import { afterEach, expect, spyOn, test } from "bun:test";
import { Command } from "commander";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as remote from "../lib/remote-client.js";
import * as output from "./output.js";
import { revisionIdOf, type RevisionContent } from "../lib/revision.js";
import { registerMetadata } from "./commands/metadata.js";
import { SkillMetadataUpdateError } from "../lib/skill-metadata-update.js";
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

/** Synthetic registry plus captured CLI effects; restore() must run in finally. */
function cliFixture() {
  let content: RevisionContent = { slug: "fixture-skill", displayName: "Fixture", description: "Synthetic", category: "old", tags: [], source: "custom", kind: "instruction", version: "1.0.0", skillMd: "Synthetic body excluded from output" };
  const requests: string[] = [], rendered: string[] = [], errors: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? "GET";
    requests.push(`${method} ${path}`);
    if (path.endsWith("whoami")) return Response.json({ organization: { id: "fixture-org" } });
    if (path.endsWith("capabilities")) return Response.json({ contractVersion: 1, apiVersion: 1, capabilities: ["skills.registry"], permissions: { publish: true } });
    if (method === "PATCH") content = { ...content, ...JSON.parse(String(init?.body)) };
    return Response.json({ ...content, source: "remote", publishedSource: content.source, revisionId: revisionIdOf(content) }, { headers: { ETag: `"${revisionIdOf(content)}"` } });
  }) as typeof fetch;
  const factory = spyOn(remote, "createRemoteSkillsClient").mockResolvedValue(new remote.RemoteSkillsClient("synthetic", "https://example.invalid"));
  const writer = spyOn(output, "writeCliOutput").mockImplementation(async value => { rendered.push(String(value)); });
  const stderr = spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")); });
  const priorExitCode = process.exitCode;
  process.exitCode = 0;
  const root = mkdtempSync(join(tmpdir(), "metadata-cli-"));
  return { root, requests, rendered, errors, current: () => content,
    patches: () => requests.filter(request => request.startsWith("PATCH ")),
    run: async (...args: string[]) => { const program = new Command(); registerMetadata(program); await program.parseAsync(["metadata", ...args], { from: "user" }); },
    restore: () => { factory.mockRestore(); writer.mockRestore(); stderr.mockRestore(); process.exitCode = priorExitCode ?? 0; rmSync(root, { recursive: true, force: true }); } };
}
test("CLI preview never overwrites an existing plan file, exits non-zero and sends no PATCH", async () => {
  const f = cliFixture();
  try {
    const saved = join(f.root, "review-plan.json");
    const known = Buffer.from("Operator-owned bytes that a preview must never replace\n");
    writeFileSync(saved, known, { mode: 0o600 });
    await f.run("preview", "fixture-skill", "--category", "new", "--save", saved);
    expect(readFileSync(saved)).toEqual(known);
    expect(f.patches()).toEqual([]);
    expect(process.exitCode).toBe(1);
    expect(f.rendered).toEqual([]);
  } finally { f.restore(); }
});
test("CLI apply refuses a saved plan whose before no longer matches its expected revision, before any PATCH", async () => {
  const f = cliFixture();
  try {
    const saved = join(f.root, "review-plan.json"), tampered = join(f.root, "tampered-plan.json");
    await f.run("preview", "fixture-skill", "--category", "new", "--save", saved);
    expect(process.exitCode).toBe(0);
    const plan = JSON.parse(readFileSync(saved, "utf8"));
    writeFileSync(tampered, `${JSON.stringify({ ...plan, before: { ...plan.before, skillMd: "Tampered body that was never published" } })}\n`, { mode: 0o600 });
    await f.run("apply", "--file", tampered);
    expect(f.patches()).toEqual([]);
    expect(process.exitCode).toBe(1);
    expect(f.errors.at(-1)).toBe(new SkillMetadataUpdateError("INVALID_METADATA_SNAPSHOT").message);
    // Positive control: the untampered saved plan still applies once.
    process.exitCode = 0;
    await f.run("apply", "--file", saved);
    expect(process.exitCode).toBe(0);
    expect(f.patches()).toHaveLength(1);
    expect(JSON.parse(f.rendered.at(-1)!)).toMatchObject({ status: "applied" });
  } finally { f.restore(); }
});
for (const tags of ["not json", "\"solo\"", "[1]", "[\"x\",\"x\"]", "{}"]) test(`CLI preview with invalid --tags ${JSON.stringify(tags)} exits non-zero with no plan file and no network call`, async () => {
  const f = cliFixture();
  try {
    const saved = join(f.root, "review-plan.json");
    await f.run("preview", "fixture-skill", "--tags", tags, "--save", saved);
    expect(process.exitCode).toBe(1);
    expect(existsSync(saved)).toBe(false);
    expect(f.requests).toEqual([]);
    expect(f.rendered).toEqual([]);
  } finally { f.restore(); }
});
for (const [field, value] of [["skillMd", "INJECTED body"], ["version", "9.9.9"]] as const) test(`CLI apply refuses a saved plan whose patch carries ${field}, before any PATCH`, async () => {
  const f = cliFixture();
  try {
    const saved = join(f.root, "review-plan.json"), tampered = join(f.root, "tampered-plan.json");
    await f.run("preview", "fixture-skill", "--category", "new", "--save", saved);
    expect(process.exitCode).toBe(0);
    const original = structuredClone(f.current());
    const plan = JSON.parse(readFileSync(saved, "utf8"));
    writeFileSync(tampered, `${JSON.stringify({ ...plan, patch: { ...plan.patch, [field]: value } })}\n`, { mode: 0o600 });
    await f.run("apply", "--file", tampered);
    expect(f.patches()).toEqual([]);
    expect(f.current()).toEqual(original);
    expect(process.exitCode).toBe(1);
    expect(f.errors.at(-1)).toBe(new SkillMetadataUpdateError("INVALID_METADATA_PATCH").message);
  } finally { f.restore(); }
});
test("CLI preview refuses a dangling symlink as --save and creates no target", async () => {
  const f = cliFixture();
  try {
    const target = join(f.root, "elsewhere.json"), link = join(f.root, "review-plan.json");
    symlinkSync(target, link);
    await f.run("preview", "fixture-skill", "--category", "new", "--save", link);
    expect(existsSync(target)).toBe(false);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(target);
    expect(f.patches()).toEqual([]);
    expect(process.exitCode).toBe(1);
    expect(f.rendered).toEqual([]);
  } finally { f.restore(); }
});
test("CLI preview refuses a --save symlink to an existing file and leaves that file unchanged", async () => {
  const f = cliFixture();
  try {
    const victim = join(f.root, "operator-notes.txt"), link = join(f.root, "review-plan.json");
    const known = Buffer.from("Operator-owned bytes behind a symlink\n");
    writeFileSync(victim, known, { mode: 0o600 }); symlinkSync(victim, link);
    await f.run("preview", "fixture-skill", "--category", "new", "--save", link);
    expect(readFileSync(victim)).toEqual(known);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(f.patches()).toEqual([]);
    expect(process.exitCode).toBe(1);
    expect(f.rendered).toEqual([]);
  } finally { f.restore(); }
});
test("CLI apply refuses a symlinked plan with no network call", async () => {
  const f = cliFixture();
  try {
    const saved = join(f.root, "review-plan.json"), link = join(f.root, "linked-plan.json");
    await f.run("preview", "fixture-skill", "--category", "new", "--save", saved);
    expect(process.exitCode).toBe(0);
    symlinkSync(saved, link);
    const requestsBeforeApply = f.requests.length;
    await f.run("apply", "--file", link);
    expect(f.requests).toHaveLength(requestsBeforeApply);
    expect(process.exitCode).toBe(1);
    expect(f.rendered).toHaveLength(1);
  } finally { f.restore(); }
});
test("CLI apply refuses a missing plan with no network call", async () => {
  const f = cliFixture();
  try {
    await f.run("apply", "--file", join(f.root, "absent-plan.json"));
    expect(f.requests).toEqual([]);
    expect(process.exitCode).toBe(1);
    expect(f.rendered).toEqual([]);
  } finally { f.restore(); }
});
for (const kind of ["directory", "fifo"] as const) test(`CLI apply refuses a ${kind} as the plan with the plan error and no network call`, async () => {
  const f = cliFixture();
  try {
    const path = join(f.root, `plan-${kind}`);
    if (kind === "directory") mkdirSync(path);
    else expect(Bun.spawnSync(["mkfifo", path]).exitCode).toBe(0);
    await f.run("apply", "--file", path);
    expect(f.requests).toEqual([]);
    expect(process.exitCode).toBe(1);
    expect(f.errors.at(-1)).toBe(new SkillMetadataUpdateError("INVALID_METADATA_PLAN").message);
  } finally { f.restore(); }
});
