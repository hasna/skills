import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// Exercise the owning scripts without adding release tooling to the public SDK.
const archiveApi = await import(resolve(import.meta.dir, "../../scripts/consumer-archive.ts"));
const { publishReviewedArchive } = await import(resolve(import.meta.dir, "../../scripts/publish-reviewed-archive.ts"));
const root = await mkdtemp(join(tmpdir(), "skills-accepted-archive-"));
const home = join(root, "home");
const version = "1.2.3";
const context = { repository: "hasna/skills", event: "push", refType: "tag", refName: `npm/skills/v${version}`, commit: "a".repeat(40) };
const env = { PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`, HOME: home, TMPDIR: root,
  NPM_CONFIG_USERCONFIG: join(home, "user.npmrc"), NPM_CONFIG_GLOBALCONFIG: join(home, "global.npmrc"),
  NPM_CONFIG_CACHE: join(home, "cache"), NPM_CONFIG_AUDIT: "false", NPM_CONFIG_FUND: "false", NPM_CONFIG_FETCH_RETRIES: "0" };
let sequence = 0;

async function command(args: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(args, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), 20_000);
  try {
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (exit !== 0) throw new Error(`Synthetic ${args[0]} failed (${exit}): ${stderr.slice(-2000)}`);
    return stdout;
  } finally { clearTimeout(timer); }
}

async function packed(overrides: Record<string, unknown> = {}, files: Record<string, string> = {}) {
  const source = join(root, `source-${sequence++}`), destination = join(root, `pack-${sequence++}`);
  await mkdir(source); await mkdir(destination);
  const manifest = { name: "@hasna/skills", version, type: "module", files: ["index.js", ...Object.keys(files)],
    exports: Object.fromEntries(archiveApi.CONSUMER_EXPORTS.map((key: string) => [key, "./index.js"])), ...overrides };
  await writeFile(join(source, "package.json"), JSON.stringify(manifest));
  await writeFile(join(source, "index.js"), "export const accepted = true;\n");
  for (const [name, content] of Object.entries(files)) await writeFile(join(source, name), content);
  const rows = JSON.parse(await command(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", destination], source));
  expect(rows).toHaveLength(1);
  return { source, archive: join(destination, rows[0].filename) };
}

async function accepted(archive: string) {
  const workspace = join(root, `consumer-${sequence++}`); await mkdir(workspace);
  const before = archiveApi.digestArchive(await readFile(archive));
  const staged = await archiveApi.stageConsumerArchive(archive, workspace, before.sha256);
  return { workspace, before, staged };
}

async function publication(archive: string) {
  const value = await accepted(archive);
  const consumer = await archiveApi.completeConsumerArchive(value.staged, version);
  const review = { schema: "hasna.skills.release-review-linkage.v1", tag: context.refName, release_commit: context.commit,
    package: `@hasna/skills@${version}`, package_path: "apps/skills", packed_filename: `hasna-skills-${version}.tgz`,
    packed_sha256: consumer.sha256, packed_integrity: consumer.integrity };
  const reviewReceipt = join(value.workspace, "review.json"), consumerReceipt = join(value.workspace, "consumer.json");
  await writeFile(reviewReceipt, JSON.stringify(review)); await writeFile(consumerReceipt, JSON.stringify(consumer));
  return { ...value, consumer, review, input: { archive, reviewReceipt, consumerReceipt, context } };
}

beforeAll(() => mkdir(home));
afterAll(() => rm(root, { recursive: true, force: true }));

test("a real retained tarball is staged byte-for-byte and its original survives consumer cleanup", async () => {
  const { archive } = await packed();
  const value = await accepted(archive);
  expect(await readFile(value.staged.installedFrom)).toEqual(await readFile(archive));
  const receipt = await archiveApi.completeConsumerArchive(value.staged, version);
  expect(receipt).toMatchObject({ ...value.before, status: "passed", exports: archiveApi.CONSUMER_EXPORTS, checks: archiveApi.CONSUMER_CHECKS });
  await rm(value.workspace, { recursive: true });
  expect(archiveApi.digestArchive(await readFile(archive))).toEqual(value.before);
});

for (const brokenRuntime of [false, true]) test(`installed storage runtime ${brokenRuntime ? "rejects a broken runtime target despite valid declarations" : "loads and checks its pure API"}`, async () => {
  const exports = Object.fromEntries(archiveApi.CONSUMER_EXPORTS.map((key: string) => [key, "./index.js"])) as Record<string, unknown>;
  exports["./storage"] = { types: "./storage.d.ts", import: brokenRuntime ? "./missing-storage.js" : "./storage.js" };
  const { archive } = await packed({ exports }, {
    "storage.d.ts": 'export declare const SKILLS_NATIVE_STORAGE_ENV: { readonly databaseUrl: "HASNA_SKILLS_DATABASE_URL" };\n',
    "storage.js": `export const SKILLS_NATIVE_STORAGE_ENV = { databaseUrl: "HASNA_SKILLS_DATABASE_URL" };
export const storageCapabilities = { version: 1, values: ["SKILLS_NATIVE_STORAGE_ENV", "storageCapabilities", "resolveSkillsNativeStorageConfig", "buildSkillsS3ObjectUrl"] };
export const resolveSkillsNativeStorageConfig = env => ({ syncBatchSize: Number(env.HASNA_SKILLS_SYNC_BATCH_SIZE), dryRun: env.HASNA_SKILLS_SYNC_DRY_RUN === "true" });
export const buildSkillsS3ObjectUrl = ({ bucket, key, endpoint }) => endpoint + "/" + bucket + "/" + key.split("/").map(encodeURIComponent).join("/");\n`,
  });
  const value = await accepted(archive);
  await writeFile(join(value.workspace, "package.json"), JSON.stringify({ private: true, type: "module", dependencies: { "@hasna/skills": `file:${value.staged.installedFrom}` } }));
  await command([process.execPath, "--no-env-file", "--no-global-config", "--no-bunfig", "install", "--ignore-scripts"], value.workspace);
  await writeFile(join(value.workspace, "consumer.ts"), 'import { SKILLS_NATIVE_STORAGE_ENV } from "@hasna/skills/storage"; const name: "HASNA_SKILLS_DATABASE_URL" = SKILLS_NATIVE_STORAGE_ENV.databaseUrl;\n');
  await writeFile(join(value.workspace, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: false, noEmit: true, moduleResolution: "Bundler", module: "ESNext", target: "ES2022", types: [] }, files: ["consumer.ts"] }));
  // The negative control must still compile: only its runtime export is broken.
  await command([process.execPath, resolve(import.meta.dir, "../../node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"], value.workspace);
  const args = [process.execPath, "--no-env-file", resolve(import.meta.dir, "../../scripts/consumer-storage.ts"), value.workspace];
  if (brokenRuntime) await expect(command(args, value.workspace)).rejects.toThrow();
  else expect(await command(args, value.workspace)).toContain("Installed storage runtime:");
  expect(archiveApi.CONSUMER_CHECKS).toContain("storage-runtime");
});

test("a different archive is rejected before installation and leaves its original intact", async () => {
  const { archive } = await packed();
  const workspace = join(root, `wrong-digest-${sequence++}`); await mkdir(workspace);
  const original = await readFile(archive);
  await expect(archiveApi.stageConsumerArchive(archive, workspace, "f".repeat(64))).rejects.toThrow("reviewed SHA-256");
  expect(await readFile(archive)).toEqual(original);
  expect(await Bun.file(join(workspace, "accepted-package.tgz")).exists()).toBe(false);
});

for (const [label, changes] of [
  ["package", { name: "@fixture/wrong-package" }],
  ["version", { version: "1.2.4" }],
  ["export", { exports: { ".": "./index.js", "./sdk": "./index.js", "./storage": "./index.js" } }],
] as const) test(`the identity gate refuses a real installed tarball with the wrong ${label}`, async () => {
  const { archive } = await packed(changes);
  const value = await accepted(archive);
  await writeFile(join(value.workspace, "package.json"), JSON.stringify({ private: true, dependencies: { "@hasna/skills": `file:${value.staged.installedFrom}` } }));
  await command([process.execPath, "--no-env-file", "--no-global-config", "--no-bunfig", "install", "--ignore-scripts"], value.workspace);
  const installed = JSON.parse(await readFile(join(value.workspace, "node_modules/@hasna/skills/package.json"), "utf8"));
  expect(() => archiveApi.assertInstalledIdentity(installed, version)).toThrow();
});

for (const target of ["source", "installedFrom"] as const) test(`changed ${target} bytes cannot earn a consumer receipt`, async () => {
  const { archive } = await packed();
  const value = await accepted(archive);
  await writeFile(value.staged[target], "changed synthetic archive");
  await expect(archiveApi.completeConsumerArchive(value.staged, version)).rejects.toThrow("differs from its acceptance receipt");
});

test("the publisher receives the exact tested file only after both receipts agree", async () => {
  const { archive } = await packed();
  const value = await publication(archive);
  const calls: string[] = [];
  await publishReviewedArchive(value.input, async (path: string) => { calls.push(path); });
  expect(calls).toEqual([archive]);
  expect(archiveApi.digestArchive(await readFile(archive))).toEqual(value.before);
});

for (const [label, badContext] of [
  ["source dispatch", { event: "workflow_dispatch", refType: "branch", refName: "main" }],
  ["tag dispatch", { event: "workflow_dispatch" }],
  ["branch push", { refType: "branch" }],
  ["different commit", { commit: "b".repeat(40) }],
] as const) test(`${label} never reaches the publisher`, async () => {
  const { archive } = await packed();
  const value = await publication(archive); let calls = 0;
  await expect(publishReviewedArchive({ ...value.input, context: { ...context, ...badContext } }, async () => { calls++; })).rejects.toThrow();
  expect(calls).toBe(0);
});

test("the actual publishing CLI refuses a dispatch before starting npm", async () => {
  const { archive } = await packed();
  const value = await publication(archive);
  const bin = join(value.workspace, "bin"); await mkdir(bin);
  const called = join(value.workspace, "npm-was-called");
  await writeFile(join(bin, "npm"), `#!/bin/sh\nprintf called > "$SKILLS_TEST_PUBLISH_MARKER"\nexit 97\n`);
  await chmod(join(bin, "npm"), 0o700);
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "../../scripts/publish-reviewed-archive.ts"),
    "--archive", archive, "--review-receipt", value.input.reviewReceipt, "--consumer-receipt", value.input.consumerReceipt], {
    cwd: value.workspace, env: { ...env, PATH: `${bin}:${env.PATH}`, SKILLS_TEST_PUBLISH_MARKER: called,
      GITHUB_REPOSITORY: context.repository, GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF_TYPE: "tag",
      GITHUB_REF_NAME: context.refName, GITHUB_SHA: context.commit }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(exit).not.toBe(0);
  expect(stdout).toBe("");
  expect(stderr).toContain("Only an exact Skills release tag push");
  expect(await Bun.file(called).exists()).toBe(false);
});

for (const mismatch of ["archive", "review-digest", "consumer-digest", "checks", "storage-runtime", "exports", "version"] as const) test(`${mismatch} mutation is inert before publication`, async () => {
  const { archive } = await packed();
  const value = await publication(archive); let calls = 0;
  if (mismatch === "archive") await writeFile(archive, "changed after acceptance");
  if (mismatch === "review-digest") value.review.packed_sha256 = "b".repeat(64);
  if (mismatch === "consumer-digest") value.consumer.sha256 = "b".repeat(64);
  if (mismatch === "checks") value.consumer.checks = value.consumer.checks.slice(1);
  if (mismatch === "storage-runtime") value.consumer.checks = value.consumer.checks.filter((check: string) => check !== "storage-runtime");
  if (mismatch === "exports") value.consumer.exports = value.consumer.exports.slice(1);
  if (mismatch === "version") value.consumer.package.version = "1.2.4";
  await writeFile(value.input.reviewReceipt, JSON.stringify(value.review));
  await writeFile(value.input.consumerReceipt, JSON.stringify(value.consumer));
  await expect(publishReviewedArchive(value.input, async () => { calls++; })).rejects.toThrow();
  expect(calls).toBe(0);
});

test("real npm file publication does not rebuild after explicit package lifecycle gates seal the archive", async () => {
  const source = join(root, `lifecycle-${sequence++}`), destination = join(root, `sealed-${sequence++}`);
  await mkdir(source); await mkdir(destination);
  await writeFile(join(source, "package.json"), JSON.stringify({ name: "@hasna/skills", version, files: ["index.js"],
    scripts: { prepublishOnly: "node lifecycle.cjs prepublishOnly", prepack: "node lifecycle.cjs prepack" } }));
  await writeFile(join(source, "lifecycle.cjs"), `const fs = require("node:fs"); fs.appendFileSync("calls", process.argv[2] + "\\n"); fs.writeFileSync("index.js", "export const generation = 1;\\n");`);
  await command(["npm", "run", "prepublishOnly"], source);
  await command(["npm", "run", "prepack"], source);
  const [entry] = JSON.parse(await command(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", destination], source));
  const archive = join(destination, entry.filename), value = await publication(archive);
  expect(await readFile(join(source, "calls"), "utf8")).toBe("prepublishOnly\nprepack\n");
  await writeFile(join(source, "lifecycle.cjs"), "throw new Error('Lifecycle reran after the archive was sealed');\n");
  await writeFile(join(source, "index.js"), "export const generation = 2;\n");
  const writes: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    if (!["GET", "HEAD"].includes(request.method)) writes.push(request.method);
    return Response.json({ error: "Synthetic registry has no packages" }, { status: 404 });
  } });
  try {
    await publishReviewedArchive(value.input, async (path: string) => {
      const output = await command(["npm", "publish", path, "--dry-run", "--json", "--registry", `http://127.0.0.1:${server.port}`], source);
      expect(JSON.parse(output)["@hasna/skills"].integrity).toBe(value.consumer.integrity);
    });
    expect(writes).toEqual([]);
    expect(await readFile(join(source, "calls"), "utf8")).toBe("prepublishOnly\nprepack\n");
    expect(archiveApi.digestArchive(await readFile(archive))).toEqual(value.before);
  } finally { server.stop(true); }
});
