import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const { retainCandidateArchive } = await import(resolve(import.meta.dir, "../../scripts/retain-candidate-archive.ts"));
const { CONSUMER_CHECKS, CONSUMER_EXPORTS, digestArchive } = await import(resolve(import.meta.dir, "../../scripts/consumer-archive.ts"));
const temporary: string[] = [];
const context = { repository: "hasna/skills", event: "workflow_dispatch", tag: "", commit: "a".repeat(40), run: "123", attempt: "1" };
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });

type Fault = "pack-path" | "pack-digest" | "consumer-incomplete" | "consumer-failure" | "archive-tamper" | "source-commit";
async function fixture(fault?: Fault) {
  const sandbox = await mkdtemp(join(tmpdir(), "skills-candidate-archive-")); temporary.push(sandbox);
  const root = join(sandbox, "source"), destination = join(sandbox, "retained"); await mkdir(root);
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "@hasna/skills", version: "1.2.3",
    publishConfig: { registry: "https://registry.npmjs.org", access: "public" } }));
  const bytes = Buffer.from("synthetic packed bytes; the real npm archive is exercised by CI");
  const digest = digestArchive(bytes), filename = "hasna-skills-1.2.3.tgz";
  const calls: string[][] = [];
  const command = async (argv: string[], cwd: string): Promise<string> => {
    expect(cwd).toBe(root); calls.push([...argv]);
    if (argv[0] === "git" && argv[1] === "rev-parse") return fault === "source-commit" ? "b".repeat(40) : context.commit;
    if (argv[0] === "git" && argv[1] === "diff") return "";
    if (argv[1] === "--version") return { node: "v24.18.0", npm: "11.19.0", bun: "1.3.14" }[argv[0] as "node" | "npm" | "bun"];
    if (argv[0] === "npm" && argv[1] === "pack") {
      expect(argv).toEqual(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", destination]);
      await writeFile(join(destination, filename), bytes);
      return JSON.stringify([{ name: "@hasna/skills", version: "1.2.3", filename: fault === "pack-path" ? "../outside.tgz" : filename,
        size: fault === "pack-digest" ? digest.bytes + 1 : digest.bytes, integrity: digest.integrity }]);
    }
    if (argv[0] === "bun" && argv[2] === "verify:consumer-types") {
      expect(argv).toEqual(["bun", "run", "verify:consumer-types", "--archive", join(destination, filename),
        "--sha256", digest.sha256, "--receipt", join(destination, "consumer-receipt.json")]);
      expect(await readFile(argv[4]!)).toEqual(bytes);
      if (fault === "consumer-failure") throw new Error("synthetic consumer refusal");
      await writeFile(argv[8]!, JSON.stringify({ schema: "hasna.skills.consumer-archive.v1", status: "passed",
        package: { name: "@hasna/skills", version: "1.2.3" }, ...digest, exports: [...CONSUMER_EXPORTS],
        checks: fault === "consumer-incomplete" ? CONSUMER_CHECKS.slice(1) : [...CONSUMER_CHECKS] }));
      if (fault === "archive-tamper") await writeFile(join(destination, filename), "modified after consumer acceptance");
      return "";
    }
    throw new Error("unexpected synthetic command");
  };
  return { root, destination, bytes, digest, calls, command };
}

test("tagless validation retains the exact accepted bytes and source/toolchain receipt without publication", async () => {
  const value = await fixture();
  const receipt = await retainCandidateArchive(value.root, value.destination, context, value.command);
  expect(receipt.publicationAuthorized).toBe(false);
  expect(receipt.commit).toBe(context.commit);
  expect(receipt.toolchain).toEqual({ node: "v24.18.0", npm: "11.19.0", bun: "1.3.14" });
  expect(receipt.sha256).toBe(value.digest.sha256);
  expect(await readFile(join(value.destination, receipt.filename))).toEqual(value.bytes);
  expect(JSON.parse(await readFile(join(value.destination, "candidate-receipt.json"), "utf8"))).toEqual(receipt);
  expect((await readdir(value.destination)).sort()).toEqual(["candidate-receipt.json", "consumer-receipt.json", "hasna-skills-1.2.3.tgz"]);
  expect(value.calls.some(argv => argv.includes("publish"))).toBe(false);
});

for (const bad of [{ event: "push" }, { tag: "npm/skills/v1.2.3" }, { repository: "other/skills" }, { commit: "main" }]) {
  test(`candidate retention refuses wrong context ${JSON.stringify(bad)} before commands`, async () => {
    const value = await fixture();
    await expect(retainCandidateArchive(value.root, value.destination, { ...context, ...bad }, value.command)).rejects.toThrow();
    expect(value.calls).toHaveLength(0);
    expect(await Bun.file(join(value.destination, "candidate-receipt.json")).exists()).toBe(false);
  });
}

for (const fault of ["pack-path", "pack-digest", "consumer-incomplete", "consumer-failure", "archive-tamper", "source-commit"] as const) {
  test(`candidate retention refuses ${fault} without a verified receipt`, async () => {
    const value = await fixture(fault);
    await expect(retainCandidateArchive(value.root, value.destination, context, value.command)).rejects.toThrow();
    expect(await Bun.file(join(value.destination, "candidate-receipt.json")).exists()).toBe(false);
    expect(value.calls.some(argv => argv.includes("publish"))).toBe(false);
  });
}

test("candidate retention never overwrites a pre-existing destination", async () => {
  const value = await fixture(); await mkdir(value.destination);
  await writeFile(join(value.destination, "preserved"), "existing original");
  await expect(retainCandidateArchive(value.root, value.destination, context, value.command)).rejects.toThrow();
  expect(await readFile(join(value.destination, "preserved"), "utf8")).toBe("existing original");
  expect(value.calls.some(argv => argv[1] === "pack")).toBe(false);
});
