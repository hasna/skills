import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

// @hasna/secrets is restricted on npm and is not part of the published package's install closure.
// Every bundle the package ships must leave it external, so no Secrets SDK source is ever published.
const root = join(import.meta.dir, "..", "..");
const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts as Record<string, string>;
// Distinctive declarations from @hasna/secrets/dist/sdk.js.
const SDK_SOURCE = [/function createSecretsClientFromEnv\(/, /class SecretsClient\b/];

function buildInvocations(script: string) {
  return script.split("&&").map(part => part.trim()).filter(part => part.startsWith("bun build ")).map(part => {
    const words = part.split(/\s+/).slice(2), external: string[] = [], entrypoints: string[] = [];
    for (let index = 0; index < words.length; index++) {
      const word = words[index]!;
      if (word === "--external") external.push(words[++index]!);
      else if (word === "--outdir" || word === "--outfile" || word === "--target") index++;
      else if (!word.startsWith("-")) entrypoints.push(join(root, word));
    }
    return { external, entrypoints };
  });
}
async function bundleText(entrypoints: string[], external: string[]) {
  const result = await Bun.build({ entrypoints, target: "bun", external });
  expect(result.success).toBe(true);
  return (await Promise.all(result.outputs.map(output => output.text()))).join("\n");
}

test("every shipped bundle keeps @hasna/secrets external", () => {
  const invocations = [...buildInvocations(scripts.build!), ...buildInvocations(scripts["build:js"]!)];
  expect(invocations.length).toBe(8);
  for (const invocation of invocations) expect(invocation.external).toContain("@hasna/secrets");
});

test("the built bin and dist contain no @hasna/secrets source, and the check detects SDK source", async () => {
  const invocations = [...buildInvocations(scripts.build!), ...buildInvocations(scripts["build:js"]!)];
  // Positive control: the markers are found in a bundle that does contain the SDK.
  const inlined = await bundleText([Bun.resolveSync("@hasna/secrets/sdk", root)], []);
  for (const marker of SDK_SOURCE) expect(inlined).toMatch(marker);
  for (const invocation of invocations) {
    const text = await bundleText(invocation.entrypoints, invocation.external);
    expect(text.length).toBeGreaterThan(10_000);
    for (const marker of SDK_SOURCE) expect(text).not.toMatch(marker);
  }
}, 300_000);
