// Publishing Skills must not break the monorepo's source-versus-registry gate.
// Source parity is reviewed in the sync PR; this guard enforces release order.
const repository = "https://api.github.com/repos/hasna/apps";
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export async function verifyAppsSync(candidate: string, request: typeof fetch = fetch) {
  if (!semver.test(candidate)) throw new Error("Invalid release version");
  async function read(path: string) {
    const response = await request(repository + path, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Apps synchronization lookup failed: HTTP ${response.status}`);
    return response.json();
  }
  const branch = await read("/branches/main");
  if (branch.name !== "main" || branch.protected !== true || !/^[0-9a-f]{40}$/.test(branch.commit?.sha ?? "")) {
    throw new Error("Apps main is not a verified protected commit");
  }
  const commit = branch.commit.sha;
  const file = await read(`/contents/apps/skills/package.json?ref=${commit}`);
  if (file.type !== "file" || file.path !== "apps/skills/package.json" || file.encoding !== "base64" || typeof file.content !== "string") {
    throw new Error("Apps Skills manifest response is invalid");
  }
  const manifest = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
  if (manifest.name !== "@hasna/skills" || typeof manifest.version !== "string" || !semver.test(manifest.version)) {
    throw new Error("Apps Skills manifest identity or version is invalid");
  }
  if (Bun.semver.order(manifest.version, candidate) < 0) {
    throw new Error(`Merge the reviewed Apps Skills source sync before publishing: protected main has ${manifest.version}, candidate is ${candidate}`);
  }
  return { repository: "hasna/apps", commit, protected: true, version: manifest.version, candidate };
}

if (import.meta.main) {
  console.log(JSON.stringify(await verifyAppsSync(process.env.RELEASE_VERSION ?? "")));
}
