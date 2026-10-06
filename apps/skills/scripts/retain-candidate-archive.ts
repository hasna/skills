#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { CONSUMER_CHECKS, CONSUMER_EXPORTS, assertArchiveDigest, digestArchive, readArchive } from "./consumer-archive.js";

type Context = { repository?: string; event?: string; tag?: string; commit?: string; run?: string; attempt?: string };
type Command = (argv: string[], cwd: string) => Promise<string>;

function requireValue(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

// This is an inspection artifact, never a release authorization or publisher.
// The existing consumer fixture must accept these exact bytes before retention.
export async function retainCandidateArchive(root: string, destination: string, context: Context, command: Command) {
  requireValue(context.repository === "hasna/skills" && context.event === "workflow_dispatch" && context.tag === "",
    "Only a tagless Skills validation dispatch may retain a candidate archive");
  requireValue(/^[a-f0-9]{40}$/.test(context.commit ?? "") && /^[1-9]\d*$/.test(context.run ?? "")
    && /^[1-9]\d*$/.test(context.attempt ?? ""), "The candidate needs an exact source commit and workflow run");
  requireValue(isAbsolute(root) && isAbsolute(destination), "Candidate paths must be absolute");
  requireValue((await command(["git", "rev-parse", "HEAD"], root)).trim() === context.commit, "Candidate checkout differs from the workflow commit");
  await command(["git", "diff", "--exit-code", "HEAD", "--"], root);
  const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  requireValue(metadata.name === "@hasna/skills" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(metadata.version)
    && metadata.publishConfig?.registry === "https://registry.npmjs.org" && metadata.publishConfig?.access === "public",
  "The candidate must identify the public Skills package");
  const toolchain = {
    node: (await command(["node", "--version"], root)).trim(),
    npm: (await command(["npm", "--version"], root)).trim(),
    bun: (await command(["bun", "--version"], root)).trim(),
  };
  requireValue(Object.values(toolchain).every(value => /^v?\d+\.\d+\.\d+$/.test(value)), "Unrecognized candidate toolchain version");
  await mkdir(destination, { mode: 0o700 }); // Exclusive: never replace another run's files.
  const filename = `hasna-skills-${metadata.version}.tgz`;
  const packed = JSON.parse(await command(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", destination], root));
  requireValue(Array.isArray(packed) && packed.length === 1 && packed[0]?.name === metadata.name
    && packed[0]?.version === metadata.version && packed[0]?.filename === filename,
  "npm packed a different candidate");
  const archive = join(destination, filename);
  const digest = digestArchive(await readArchive(archive));
  requireValue(packed[0].size === digest.bytes && packed[0].integrity === digest.integrity, "npm archive identity does not match retained bytes");
  const consumerPath = join(destination, "consumer-receipt.json");
  await command(["bun", "run", "verify:consumer-types", "--archive", archive, "--sha256", digest.sha256, "--receipt", consumerPath], root);
  const consumer = JSON.parse(await readFile(consumerPath, "utf8"));
  requireValue(consumer.schema === "hasna.skills.consumer-archive.v1" && consumer.status === "passed"
    && consumer.package?.name === metadata.name && consumer.package?.version === metadata.version
    && JSON.stringify(consumer.exports) === JSON.stringify(CONSUMER_EXPORTS)
    && JSON.stringify(consumer.checks) === JSON.stringify(CONSUMER_CHECKS), "The complete installed consumer did not accept this candidate");
  assertArchiveDigest(consumer, digest);
  assertArchiveDigest(digestArchive(await readArchive(archive)), digest);
  const receipt = { schema: "hasna.skills.candidate-archive.v1", status: "verified", publicationAuthorized: false,
    repository: context.repository, commit: context.commit, run: context.run, attempt: context.attempt,
    package: { name: metadata.name, version: metadata.version }, filename, ...digest, toolchain,
    modePolicy: "Archive member modes are preserved inside the npm tarball; inspect the retained tarball for exact modes.",
    consumerReceipt: "consumer-receipt.json" };
  await writeFile(join(destination, "candidate-receipt.json"), JSON.stringify(receipt) + "\n", { flag: "wx", mode: 0o600 });
  return receipt;
}

async function run(argv: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(argv, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, , status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (status !== 0) throw new Error(`Candidate ${argv[0]} operation failed with exit ${status}`);
  return stdout;
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    requireValue(args.length === 2 && args[0] === "--destination", "Expected --destination <new absolute directory>");
    const receipt = await retainCandidateArchive(resolve(import.meta.dir, ".."), args[1]!, {
      repository: process.env.GITHUB_REPOSITORY, event: process.env.GITHUB_EVENT_NAME, tag: process.env.RELEASE_TAG,
      commit: process.env.GITHUB_SHA, run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
    }, run);
    console.log(JSON.stringify(receipt));
  } catch {
    console.error("Candidate archive retention failed; no publication was attempted.");
    process.exitCode = 1;
  }
}
