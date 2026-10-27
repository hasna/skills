import { afterAll, beforeAll, expect, test } from "bun:test";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-json-output-"));
const binary = join(scratch, "skills.js");
beforeAll(() => buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary));
// A local regression investigation may retain the exact process captures.
afterAll(() => { if (process.env.SKILLS_JSON_OUTPUT_RETAIN_FIXTURES !== "1") rmSync(scratch, { recursive: true, force: true }); });

async function fixture(text: string, refusal = false) {
  const root = mkdtempSync(join(scratch, "case-"));
  const home = join(root, "home"), data = join(root, "data"), temp = join(root, "tmp");
  for (const directory of [home, data, temp]) mkdirSync(directory);
  const skill = join(data, "installed", "pipe-fixture");
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "---\nname: pipe-fixture\ndescription: Synthetic pipe fixture\nkind: instruction\n---\nFixture instructions.\n");
  writeFileSync(join(skill, "package.json"), JSON.stringify({ name: "pipe-fixture", version: "1.0.0", skills: { kind: "instruction" } }));
  const versions = Array.from({ length: 7 }, (_, index) => ({ slug: "pipe-fixture", version: `1.0.${index}`,
    bundleSha256: "a".repeat(64), bundleByteSize: 1, createdAt: "2026-01-01T00:00:00Z", manifest: { text } }));
  const guard = join(root, "fetch-fixture.js");
  // No socket is opened. Reject every target except the explicitly closed fixture origin.
  writeFileSync(guard, `globalThis.fetch=async(input,init)=>{
    const request=new Request(input,init),url=new URL(request.url);
    if(url.origin!=="http://127.0.0.1:9")throw Error("Unexpected fixture target");
    if(url.pathname.endsWith("/versions"))return Response.json(${JSON.stringify({ slug: "pipe-fixture", versions })},{status:${refusal ? 503 : 200}});
    if(request.method==="GET")return Response.json({code:"SKILL_NOT_FOUND"},{status:404});
    if(request.method==="POST")return Response.json(${JSON.stringify(refusal ? { error: text } : { receipt: text })},{status:${refusal ? 422 : 201}});
    throw Error("Unexpected fixture operation");
  };`);
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home,
    HASNA_HOME: join(home, ".hasna"), HASNA_SKILLS_DIR: data, HASNA_SKILLS_API_KEY_OVERRIDE: "synthetic-pipe-fixture",
    HASNA_SKILLS_API_URL: "http://127.0.0.1:9", HASNA_STATION: "synthetic-pipe-fixture", TMPDIR: temp,
    NO_COLOR: "1", TERM: "dumb", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" };
  async function run(verb: "versions" | "push", pipe: boolean) {
    const output = join(root, `${verb}-${pipe ? "pipe" : "file"}.json`);
    const status = join(root, `${verb}-pipeline.status`);
    const command = [process.execPath, "--no-env-file", "--no-install", "--preload", guard, binary, verb, "pipe-fixture", "--json"];
    // Bun.spawn's own capture is socket-backed. Bash supplies the kernel pipe
    // and records both statuses before any subsequent command can replace them.
    const args = pipe ? ["/bin/bash", "-c", '"$@" | { sleep 0.2; cat; }; states=("${PIPESTATUS[@]}"); printf "%s\\n" "${states[@]}" > "$PIPE_STATUS"', "pipe-fixture", ...command] : command;
    const fd = openSync(output, "wx", 0o600);
    try {
      const child = Bun.spawn(args, { cwd: root, env: { ...env, PIPE_STATUS: status }, stdin: "ignore", stdout: fd, stderr: "pipe" });
      const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);
      const statuses = pipe ? readFileSync(status, "utf8").trim().split("\n").map(Number) : [exitCode];
      writeFileSync(`${output}.stderr`, stderr, { mode: 0o600 });
      writeFileSync(`${output}.status.json`, JSON.stringify({ producerStatus: statuses[0], consumerStatus: pipe ? statuses[1] : null, wrapperStatus: exitCode, command: args }), { mode: 0o600 });
      expect(exitCode).toBe(pipe ? 0 : refusal ? 1 : 0);
      expect(statuses).toEqual(pipe ? [refusal ? 1 : 0, 0] : [refusal ? 1 : 0]);
      expect(stderr).toBe("");
      return readFileSync(output, "utf8");
    } finally { closeSync(fd); }
  }
  return { run, versions };
}

for (const [label, text] of [["small", "small fixture"], ["large", "synthetic word ".repeat(10_000)], ["Unicode", "căutare 🧭 日本語\n".repeat(4_000)]] as const) {
  for (const verb of ["versions", "push"] as const) test(`built ${verb} retains complete ${label} JSON through a delayed kernel pipe`, async () => {
    const f = await fixture(text);
    const regular = await f.run(verb, false), piped = await f.run(verb, true);
    if (label !== "small") expect(Buffer.byteLength(regular)).toBeGreaterThan(64 * 1024);
    expect(Buffer.byteLength(piped)).toBe(Buffer.byteLength(regular));
    const expected = JSON.parse(regular), actual = JSON.parse(piped);
    if (verb === "versions") {
      expect(piped).toBe(regular);
      expect(actual).toEqual({ slug: "pipe-fixture", versions: f.versions });
    } else {
      expect(actual.response).toEqual({ receipt: text });
      expect(actual.published).toBe(true);
      // Packing time is intentionally fresh for each separate process.
      delete actual.manifest.provenance.packedAt;
      delete expected.manifest.provenance.packedAt;
      expect(actual).toEqual(expected);
    }
  });
}

for (const verb of ["versions", "push"] as const) test(`built ${verb} preserves JSON refusal output and producer status through a pipe`, async () => {
  const text = "Synthetic refusal căutare 🧭 ".repeat(4_000);
  const f = await fixture(text, true);
  const regular = await f.run(verb, false), piped = await f.run(verb, true);
  expect(piped).toBe(regular);
  expect(typeof JSON.parse(piped).error).toBe("string");
  if (verb === "push") expect(JSON.parse(piped).error).toContain(text);
});
