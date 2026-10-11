import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

// The MCP tool schemas and the MCP SDK must share one zod. 0.10.61-0.10.68 built
// bin/mcp.js with zod bundled but the SDK external, so an installed SDK that
// resolved an older zod failed tools/list with `ctx.deferred.push`.
const packageRoot = resolve(import.meta.dir, "../..");
const { declaredFloor, mcpBinaryDisposition } = await import(resolve(packageRoot, "scripts/consumer-mcp.ts"));
const { CONSUMER_CHECKS } = await import(resolve(packageRoot, "scripts/consumer-archive.ts"));
const scratch = mkdtempSync(join(tmpdir(), "skills-mcp-zod-bundle-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test("an MCP binary takes zod and the MCP SDK from the same place", () => {
  expect(mcpBinaryDisposition('import { readFileSync } from "node:fs";\nconst zod = "inlined";\n')).toBe("bundled");
  expect(mcpBinaryDisposition('import { z } from "zod";\nimport { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";\n')).toBe("installed");
  expect(() => mcpBinaryDisposition('#!/usr/bin/env bun\nimport { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";\n'))
    .toThrow("bundles zod but imports the MCP SDK");
  expect(() => mcpBinaryDisposition('import { z } from "zod/v4";\nexport const schema = z.string();\n'))
    .toThrow("imports zod but bundles the MCP SDK");
  expect(() => mcpBinaryDisposition('const sdk = await import("@modelcontextprotocol/sdk/server/stdio.js");\n'))
    .toThrow("bundles zod but imports the MCP SDK");
});

test("the consumer fixture pins the declared zod floor of a caret range only", () => {
  expect(declaredFloor("^4.3.6")).toBe("4.3.6");
  for (const range of ["4.3.6", ">=4.3.6", "^4.3", "~4.3.6", "^4.3.6 || ^5.0.0", undefined]) {
    expect(() => declaredFloor(range)).toThrow("Update the MCP consumer fixture");
  }
  const metadata = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  expect(declaredFloor(metadata.dependencies.zod)).toMatch(/^\d+\.\d+\.\d+$/);
  expect(CONSUMER_CHECKS).toContain("mcp-zod-instance");
});

test("the package build bundles zod and the MCP SDK together in bin/mcp.js", async () => {
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
  expect(mcpBinaryDisposition(readFileSync(outfile, "utf8"))).toBe("bundled");
});
