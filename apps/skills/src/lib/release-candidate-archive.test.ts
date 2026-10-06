import { afterEach, expect, test } from "bun:test";
import { chmod, copyFile, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
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

// Run the actual entrypoint and its actual child-process wrapper. A callback
// throwing an Error cannot prove preservation of a producer's exit status.
for (const fault of ["pack", "consumer", "input", "validation", "spawn"] as const) {
  test(`candidate CLI preserves safe ${fault} failure evidence without child output`, async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "skills-candidate-process-")); temporary.push(sandbox);
    const root = join(sandbox, "source"), scripts = join(root, "scripts"), tools = join(sandbox, "tools"),
      home = join(sandbox, "home"), destination = join(sandbox, "private-destination-marker"), journal = join(sandbox, "calls");
    for (const path of [scripts, tools, home]) await mkdir(path, { recursive: true });
    for (const name of ["retain-candidate-archive.ts", "consumer-archive.ts"]) {
      await copyFile(resolve(import.meta.dir, "../../scripts", name), join(scripts, name));
    }
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "@hasna/skills", version: "1.2.3",
      publishConfig: { registry: "https://registry.npmjs.org", access: "public" } }));
    await symlink(Bun.which("git")!, join(tools, "git"));
    const env = { PATH: tools, HOME: home, TMPDIR: sandbox, GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: join(home, "absent-git-config"), NO_COLOR: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
      GITHUB_REPOSITORY: "hasna/skills", GITHUB_EVENT_NAME: "workflow_dispatch", RELEASE_TAG: "", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1" };
    for (const args of [["init", "--quiet"], ["add", "."], ["-c", "user.name=Synthetic Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "synthetic fixture"]]) {
      const child = Bun.spawnSync(["git", ...args], { cwd: root, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      expect(child.exitCode).toBe(0);
    }
    const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    expect(head.exitCode).toBe(0);
    for (const tool of ["node", "npm", "bun"]) {
      if (fault === "spawn" && tool === "node") continue;
      const executable = join(tools, tool);
      await writeFile(executable, `#!${process.execPath}
import { appendFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
appendFileSync(${JSON.stringify(journal)}, ${JSON.stringify(tool)} + ':' + process.argv[2] + '\\n');
if (process.argv[2] === '--version') {
  console.log(${JSON.stringify({ node: "v24.18.0", npm: "11.19.0", bun: "1.3.14" }[tool as "node" | "npm" | "bun"])});
} else if (${JSON.stringify(tool)} === 'npm' && ${JSON.stringify(fault)} !== 'pack') {
  if (${JSON.stringify(fault)} === 'validation') console.log('private-malformed-output-marker');
  else {
    const bytes=Buffer.from('synthetic archive transport only');
    writeFileSync(${JSON.stringify(join(destination, "hasna-skills-1.2.3.tgz"))},bytes);
    console.log(JSON.stringify([{name:'@hasna/skills',version:'1.2.3',filename:'hasna-skills-1.2.3.tgz',size:bytes.length,integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64')}]));
  }
} else {
  console.log('private-child-stdout-marker'); console.error('private-child-stderr-marker');
  process.exit(${tool === "npm" ? 42 : 37});
}
`);
      await chmod(executable, 0o700);
    }
    const child = Bun.spawn([process.execPath, "--no-env-file", join(scripts, "retain-candidate-archive.ts"),
      ...(fault === "input" ? [] : ["--destination", destination])], {
      cwd: root, env: { ...env, GITHUB_SHA: head.stdout.toString().trim() }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    try {
      const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(status).toBe(1); expect(stdout).toBe("");
      expect(stderr).not.toContain("private-");
      const result = JSON.parse(stderr);
      expect(result).toMatchObject({ schema: "hasna.skills.candidate-archive-failure.v1", status: "failed", publicationAuthorized: false });
      if (fault === "pack" || fault === "consumer") {
        expect(result).toEqual({ schema: "hasna.skills.candidate-archive-failure.v1", status: "failed", publicationAuthorized: false,
          kind: "subprocess", stage: fault, childStatus: fault === "pack" ? 42 : 37 });
        expect(await readFile(journal, "utf8")).toContain(fault === "pack" ? "npm:pack\n" : "bun:run\n");
      } else if (fault === "spawn") {
        expect(result).toMatchObject({ kind: "spawn", stage: "node-version", childStatus: null });
      } else {
        expect(result).toMatchObject({ kind: fault });
        expect(result).not.toHaveProperty("childStatus");
      }
      expect(await Bun.file(join(destination, "candidate-receipt.json")).exists()).toBe(false);
    } finally { clearTimeout(timer); }
  });
}
