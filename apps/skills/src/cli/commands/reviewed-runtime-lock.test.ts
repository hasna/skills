import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { validateReviewedRuntimeLock, type ReviewedRuntimeLockContext } from "./reviewed-runtime-lock.js";

const sri = `sha512-${Buffer.alloc(64, 1).toString("base64")}`;
const depSri = `sha512-${Buffer.alloc(64, 2).toString("base64")}`;
const tarball = "https://registry.npmjs.org/example-dependency/-/example-dependency-1.0.0.tgz";
function fixture() {
  return { lockfileVersion: 3, requires: true, packages: {
    "": { dependencies: { "@hasna/skills": "file:./verified.tgz" } },
    "node_modules/@hasna/skills": { version: "0.10.8", resolved: "file:verified.tgz", integrity: sri, dependencies: { "example-dependency": "^1.0.0" } },
    "node_modules/example-dependency": { version: "1.0.0", resolved: tarball, integrity: depSri },
  } };
}
function input(lock: unknown) {
  const bytes = Buffer.from(JSON.stringify(lock));
  return { bytes, sha: createHash("sha256").update(bytes).digest("hex") };
}
function context(overrides: Partial<ReviewedRuntimeLockContext> = {}): ReviewedRuntimeLockContext {
  return { version: "0.10.8", archiveIntegrity: sri, packageManifest: { dependencies: { "example-dependency": "^1.0.0" } },
    registryOrigin: "https://registry.npmjs.org", minReleaseAge: 7, minReleaseAgeExclude: [], now: Date.parse("2026-10-05T20:00:00Z"),
    fetcher: (async () => Response.json({ name: "example-dependency", "dist-tags": { latest: "2.0.0" },
      versions: { "1.0.0": { name: "example-dependency", version: "1.0.0", dist: { integrity: depSri, tarball } },
        "2.0.0": { name: "example-dependency", version: "2.0.0", dist: { integrity: sri, tarball: tarball.replace("1.0.0", "2.0.0") } } },
      time: { "1.0.0": "2026-09-01T00:00:00Z", "2.0.0": "2026-09-28T00:00:00Z" },
    })) as unknown as typeof fetch, ...overrides };
}

describe("reviewed dependency lock", () => {
  test("newly eligible registry releases do not change the reviewed exact dependency", async () => {
    const { bytes, sha } = input(fixture());
    await validateReviewedRuntimeLock(bytes, sha, context());
    expect(JSON.parse(bytes.toString()).packages["node_modules/example-dependency"].version).toBe("1.0.0");
  });
  test("tampered bytes fail before any registry read", async () => {
    const { bytes, sha } = input(fixture());
    let reads = 0;
    await expect(validateReviewedRuntimeLock(Buffer.concat([bytes, Buffer.from(" ")]), sha, context({ fetcher: (async () => { reads++; return new Response(); }) as unknown as typeof fetch }))).rejects.toThrow("REVIEWED_LOCK_HASH_MISMATCH");
    expect(reads).toBe(0);
  });
  test.each([
    ["target version", (o: any) => o.packages["node_modules/@hasna/skills"].version = "0.10.9", "REVIEWED_LOCK_ARCHIVE_MISMATCH"],
    ["target archive", (o: any) => o.packages["node_modules/@hasna/skills"].integrity = depSri, "REVIEWED_LOCK_ARCHIVE_MISMATCH"],
    ["root identity", (o: any) => o.packages[""].dependencies.other = "1.0.0", "REVIEWED_LOCK_ROOT_MISMATCH"],
    ["target manifest", (o: any) => o.packages["node_modules/@hasna/skills"].dependencies["example-dependency"] = "^2", "REVIEWED_LOCK_MANIFEST_MISMATCH"],
    ["external registry", (o: any) => o.packages["node_modules/example-dependency"].resolved = "https://example.invalid/example.tgz", "REVIEWED_LOCK_REGISTRY_INVALID"],
    ["link", (o: any) => o.packages["node_modules/example-dependency"].link = true, "REVIEWED_LOCK_LOCATION_INVALID"],
    ["weak integrity", (o: any) => o.packages["node_modules/example-dependency"].integrity = "sha1-invalid", "REVIEWED_LOCK_PACKAGE_INVALID"],
    ["path escape", (o: any) => o.packages["node_modules/../outside"] = o.packages["node_modules/example-dependency"], "REVIEWED_LOCK_LOCATION_INVALID"],
  ])("refuses %s", async (_name, change, error) => {
    const lock = fixture(); change(lock);
    const { bytes, sha } = input(lock);
    await expect(validateReviewedRuntimeLock(bytes, sha, context())).rejects.toThrow(error);
  });
  test("npm ci cannot silently waive age validation of frozen versions", async () => {
    const { bytes, sha } = input(fixture());
    await expect(validateReviewedRuntimeLock(bytes, sha, context({ now: Date.parse("2026-09-02T00:00:00Z") }))).rejects.toThrow("REVIEWED_LOCK_RELEASE_AGE_REFUSED");
  });
  test("matching lock hash does not excuse changed registry integrity", async () => {
    const { bytes, sha } = input(fixture());
    const base = context();
    await expect(validateReviewedRuntimeLock(bytes, sha, context({ fetcher: (async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const response = await base.fetcher!(url, init), data = await response.json();
      data.versions["1.0.0"].dist.integrity = sri;
      return Response.json(data);
    }) as unknown as typeof fetch }))).rejects.toThrow("REVIEWED_LOCK_METADATA_IDENTITY_MISMATCH");
  });
  test.each([
    ["accepted full metadata", undefined, undefined],
    ["recent exact version", "recent", "REVIEWED_LOCK_RELEASE_AGE_REFUSED"],
    ["changed exact integrity", "integrity", "REVIEWED_LOCK_METADATA_IDENTITY_MISMATCH"],
  ])("large registry history still checks %s", async (_name, mutation, error) => {
    const { bytes, sha } = input(fixture()), base = context();
    const large = context({ fetcher: (async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const data = await (await base.fetcher!(url, init)).json();
      // Full packuments retain timestamps but can exceed the lockfile size.
      data.readme = "x".repeat(13_350_501);
      if (mutation === "recent") data.time["1.0.0"] = "2026-10-05T00:00:00Z";
      if (mutation === "integrity") data.versions["1.0.0"].dist.integrity = sri;
      return Response.json(data);
    }) as unknown as typeof fetch });
    if (error) await expect(validateReviewedRuntimeLock(bytes, sha, large)).rejects.toThrow(error);
    else await validateReviewedRuntimeLock(bytes, sha, large);
  });
  test("oversized registry stream is cancelled before reading the whole body", async () => {
    const { bytes, sha } = input(fixture());
    let reads = 0, cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { reads++; controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    await expect(validateReviewedRuntimeLock(bytes, sha, context({
      fetcher: (async () => new Response(stream)) as unknown as typeof fetch,
    }))).rejects.toThrow("REVIEWED_LOCK_METADATA_TOO_LARGE");
    expect(cancelled).toBe(true);
    expect(reads).toBe(33);
  });
  test("larger registry allowance does not raise the lockfile limit", async () => {
    const bytes = Buffer.alloc(8 * 1024 * 1024 + 1, 32);
    const sha = createHash("sha256").update(bytes).digest("hex");
    let reads = 0;
    await expect(validateReviewedRuntimeLock(bytes, sha, context({
      fetcher: (async () => { reads++; return new Response(); }) as unknown as typeof fetch,
    }))).rejects.toThrow("REVIEWED_LOCK_HASH_MISMATCH");
    expect(reads).toBe(0);
  });
});
