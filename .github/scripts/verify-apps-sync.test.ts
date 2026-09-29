import { describe, expect, test } from "bun:test";
import { verifyAppsSync } from "./verify-apps-sync";

const commit = "a".repeat(40);
function fixture(version = "0.10.14", overrides: { protected?: boolean; name?: string; status?: number } = {}) {
  const calls: string[] = [];
  const request = (async (url: string | URL | Request, options?: RequestInit) => {
    calls.push(String(url));
    expect(options?.redirect).toBe("error");
    const body = calls.length === 1
      ? { name: "main", protected: overrides.protected ?? true, commit: { sha: commit } }
      : { type: "file", path: "apps/skills/package.json", encoding: "base64", content: Buffer.from(JSON.stringify({ name: overrides.name ?? "@hasna/skills", version })).toString("base64") };
    return Response.json(body, { status: overrides.status ?? 200 });
  }) as typeof fetch;
  return { request, calls };
}

describe("standalone release waits for the reviewed monorepo sync", () => {
  test.each(["0.10.14", "0.10.15", "0.11.0"])("accepts protected main at %s and reads its immutable commit", async version => {
    const f = fixture(version);
    expect((await verifyAppsSync("0.10.14", f.request)).commit).toBe(commit);
    expect(f.calls).toEqual([
      "https://api.github.com/repos/hasna/apps/branches/main",
      `https://api.github.com/repos/hasna/apps/contents/apps/skills/package.json?ref=${commit}`,
    ]);
  });
  test.each(["0.10.11", "0.10.13", "0.10.14-rc.1"])("refuses a stale monorepo at %s", async version => {
    await expect(verifyAppsSync("0.10.14", fixture(version).request)).rejects.toThrow("Merge the reviewed Apps Skills source sync");
  });
  test("preserves prerelease ordering", async () => {
    await expect(verifyAppsSync("0.10.14-rc.2", fixture("0.10.14-rc.1").request)).rejects.toThrow("source sync");
    expect((await verifyAppsSync("0.10.14-rc.2", fixture("0.10.14").request)).version).toBe("0.10.14");
  });
  test("refuses unprotected main", async () => {
    await expect(verifyAppsSync("0.10.14", fixture("0.10.14", { protected: false }).request)).rejects.toThrow("protected commit");
  });
  test("refuses a wrong package", async () => {
    await expect(verifyAppsSync("0.10.14", fixture("0.10.14", { name: "other" }).request)).rejects.toThrow("identity");
  });
  test.each([404, 429, 503])("fails closed on HTTP %s", async status => {
    await expect(verifyAppsSync("0.10.14", fixture("0.10.14", { status }).request)).rejects.toThrow(`HTTP ${status}`);
  });
  test("refuses invalid versions before a fetch", async () => {
    const f = fixture();
    await expect(verifyAppsSync("not-a-version", f.request)).rejects.toThrow("Invalid release version");
    expect(f.calls).toEqual([]);
    await expect(verifyAppsSync("0.10.14", fixture("0.10.014").request)).rejects.toThrow("version is invalid");
  });
});
