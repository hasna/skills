#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { isAbsolute, basename } from "node:path";
import { CONSUMER_CHECKS, CONSUMER_EXPORTS, assertArchiveDigest, digestArchive, readArchive } from "./consumer-archive.js";

type ReleaseContext = { repository?: string; event?: string; refType?: string; refName?: string; commit?: string };
type PublishInput = { archive: string; reviewReceipt: string; consumerReceipt: string; context: ReleaseContext };
type Publisher = (archive: string) => Promise<void>;

function exactStrings(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.every(item => typeof item === "string")
    && JSON.stringify([...value].sort()) === JSON.stringify([...expected].sort());
}

// This is the final read-only gate before handing the accepted file to npm. The
// workflow has already run package-owned lifecycle gates before sealing it.
export async function publishReviewedArchive(input: PublishInput, publish: Publisher): Promise<void> {
  const context = input.context;
  if (context.repository !== "hasna/skills" || context.event !== "push" || context.refType !== "tag"
    || !context.refName?.startsWith("npm/skills/v") || !/^[a-f0-9]{40}$/.test(context.commit ?? "")) {
    throw new Error("Only an exact Skills release tag push may publish an accepted archive");
  }
  const version = context.refName.slice("npm/skills/v".length);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("Invalid Skills release version");
  if (!isAbsolute(input.archive)) throw new Error("The accepted archive must use an absolute local path");
  const review = JSON.parse(await readFile(input.reviewReceipt, "utf8"));
  const consumer = JSON.parse(await readFile(input.consumerReceipt, "utf8"));
  if (review?.schema !== "hasna.skills.release-review-linkage.v1"
    || review.tag !== context.refName || review.release_commit !== context.commit
    || review.package !== `@hasna/skills@${version}` || review.package_path !== "apps/skills"
    || review.packed_filename !== `hasna-skills-${version}.tgz`
    || basename(input.archive) !== review.packed_filename
    || !/^[a-f0-9]{64}$/.test(review.packed_sha256 ?? "")
    || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(review.packed_integrity ?? "")) {
    throw new Error("The linked release receipt does not identify this exact candidate and archive");
  }
  if (consumer?.schema !== "hasna.skills.consumer-archive.v1" || consumer.status !== "passed"
    || consumer.package?.name !== "@hasna/skills" || consumer.package.version !== version
    || !exactStrings(consumer.exports, CONSUMER_EXPORTS) || !exactStrings(consumer.checks, CONSUMER_CHECKS)
    || !Number.isSafeInteger(consumer.bytes) || consumer.bytes <= 0
    || consumer.sha256 !== review.packed_sha256 || consumer.integrity !== review.packed_integrity) {
    throw new Error("The installed consumer receipt does not accept this complete release archive");
  }
  assertArchiveDigest(digestArchive(await readArchive(input.archive)), consumer);
  await publish(input.archive);
}

function argumentsOf(argv: string[]): Omit<PublishInput, "context"> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index], value = argv[index + 1];
    if (!["--archive", "--review-receipt", "--consumer-receipt"].includes(name ?? "")
      || !value || !isAbsolute(value) || values.has(name!)) throw new Error("Invalid accepted-archive publication argument");
    values.set(name!, value);
  }
  if (values.size !== 3) throw new Error("Archive and both acceptance receipts are required");
  return { archive: values.get("--archive")!, reviewReceipt: values.get("--review-receipt")!, consumerReceipt: values.get("--consumer-receipt")! };
}

if (import.meta.main) {
  const input = argumentsOf(process.argv.slice(2));
  await publishReviewedArchive({ ...input, context: {
    repository: process.env.GITHUB_REPOSITORY, event: process.env.GITHUB_EVENT_NAME,
    refType: process.env.GITHUB_REF_TYPE, refName: process.env.GITHUB_REF_NAME, commit: process.env.GITHUB_SHA,
  } }, async archive => {
    const child = Bun.spawn(["npm", "publish", archive, "--provenance", "--access", "public", "--registry", "https://registry.npmjs.org"], {
      stdin: "ignore", stdout: "inherit", stderr: "inherit",
    });
    const status = await child.exited;
    if (status !== 0) throw new Error(`Accepted-archive npm publication failed with exit ${status}`);
  });
}
