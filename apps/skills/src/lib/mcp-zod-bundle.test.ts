import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

// bin/mcp.js bundles everything except the MCP SDK, zod included. The SDK may
// resolve another zod, so tools/list converts schemas with the bundled zod
// (src/mcp/package-tool-list.ts). These cover the release receipt's static
// binary check, the consumer gate's helpers and the exact build step. The gate
// itself runs in the unprivileged skills-consumer-gate workflow.
const packageRoot = resolve(import.meta.dir, "../..");
const { declaredFloor, mcpZodCases, readArchiveMetadata } = await import(resolve(packageRoot, "scripts/consumer-mcp.ts"));
const { CONSUMER_CHECKS, assertMcpBinarySurface } = await import(resolve(packageRoot, "scripts/consumer-archive.ts"));
const ZOD_CORE = "const version = { major: 4, minor: 5, patch: 4 };\n";
const HANDLER = "function servePackageZodToolList(server) {}\n";
const scratch = mkdtempSync(join(tmpdir(), "skills-mcp-zod-bundle-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test("bin/mcp.js imports only the MCP SDK, bundles one zod and serves tools/list with it", () => {
  const sdk = 'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";\nimport { readFileSync } from "node:fs";\n';
  expect(() => assertMcpBinarySurface(sdk + ZOD_CORE + HANDLER)).not.toThrow();
  expect(() => assertMcpBinarySurface('#!/usr/bin/env bun\nconst sdk = await import("@modelcontextprotocol/sdk/server/stdio.js");\n' + ZOD_CORE + HANDLER)).not.toThrow();
  expect(() => assertMcpBinarySurface(sdk + 'import { z } from "zod";\n' + HANDLER)).toThrow("bundle everything except the MCP SDK; it imports zod");
  expect(() => assertMcpBinarySurface(sdk + 'import "zod/v4";\n' + ZOD_CORE + HANDLER)).toThrow("it imports zod/v4");
  expect(() => assertMcpBinarySurface('import { readFileSync } from "node:fs";\n' + ZOD_CORE + HANDLER)).toThrow("not bundle it");
  expect(() => assertMcpBinarySurface(sdk + HANDLER)).toThrow("exactly one zod; found 0");
  expect(() => assertMcpBinarySurface(sdk + ZOD_CORE + ZOD_CORE.replace("version", "version2") + HANDLER)).toThrow("exactly one zod; found 2");
  expect(() => assertMcpBinarySurface(sdk + ZOD_CORE)).toThrow("serve tools/list with its bundled zod");
  expect(CONSUMER_CHECKS).toContain("mcp-binary-surface");
});

test("the consumer gate pins the declared zod floor and npm split cases outside the range", () => {
  expect(declaredFloor("^4.3.6")).toBe("4.3.6");
  for (const range of ["4.3.6", ">=4.3.6", "^4.3", "~4.3.6", "^4.3.6 || ^5.0.0", undefined]) {
    expect(() => declaredFloor(range)).toThrow("Update the MCP consumer fixture");
  }
  expect(mcpZodCases("^4.3.6")).toEqual([
    { label: "bun-floor", installer: "bun", zodSpec: "4.3.6" },
    { label: "bun-latest", installer: "bun", zodSpec: "^4.3.6" },
    { label: "npm-split-4.3.5", installer: "npm", zodSpec: "4.3.5" },
  ]);
  expect(mcpZodCases("^4.3.6", ["3.25.76", "4.1.13"]).map((entry: { label: string }) => entry.label))
    .toEqual(["bun-floor", "bun-latest", "npm-split-3.25.76", "npm-split-4.1.13"]);
  expect(() => mcpZodCases("^4.3.6", ["4.4.0"])).toThrow("outside the declared range");
  expect(() => mcpZodCases("^4.3.6", ["^4.3.5"])).toThrow("outside the declared range");
});

test("the gate reads the tested zod range from the packed archive, not the checkout", () => {
  const source = join(scratch, "archive-source"), packageDir = join(source, "package");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "@hasna/skills", version: "9.9.9", dependencies: { zod: "^4.9.0" } }));
  const archive = join(scratch, "fixture.tgz");
  const packed = Bun.spawnSync(["tar", "-czf", archive, "-C", source, "package"], { env: { PATH: "/usr/bin:/bin" }, stdout: "pipe", stderr: "pipe" });
  expect(packed.exitCode).toBe(0);
  const metadata = readArchiveMetadata(archive);
  expect(metadata.version).toBe("9.9.9");
  expect(metadata.dependencies.zod).toBe("^4.9.0");
  expect(mcpZodCases(metadata.dependencies.zod)[0]).toEqual({ label: "bun-floor", installer: "bun", zodSpec: "4.9.0" });
  expect(() => readArchiveMetadata(join(scratch, "missing.tgz"))).toThrow("Cannot read package/package.json");
});

test("the package build bundles zod and leaves only the MCP SDK external in bin/mcp.js", async () => {
  const metadata = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const steps = String(metadata.scripts.build).split(" && ").filter(step => step.includes("./src/mcp/index.ts"));
  expect(steps).toHaveLength(1);
  const argv = steps[0]!.split(" ");
  expect(argv.slice(0, 2)).toEqual(["bun", "build"]);
  const outfileIndex = argv.indexOf("--outfile");
  expect(argv[outfileIndex + 1]).toBe("./bin/mcp.js");
  const outfile = join(scratch, "mcp.js");
  argv[outfileIndex + 1] = outfile;
  const child = Bun.spawn([process.execPath, "--no-env-file", ...argv.slice(1)], {
    cwd: packageRoot, env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NO_COLOR: "1" },
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 20_000);
  try {
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (status !== 0) throw new Error(`MCP build failed (${status}):\n${stdout.slice(-4_000)}${stderr.slice(-4_000)}`);
  } finally { clearTimeout(deadline); }
  expect(() => assertMcpBinarySurface(readFileSync(outfile, "utf8"))).not.toThrow();
});
