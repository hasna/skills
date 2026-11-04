import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

// SH-00058. Skills types the optional @hasna/secrets SDK locally (SecretsSdk in
// execution-secrets.ts), so it typechecks where the package is absent. Wherever
// it is installed, its real createSecretsClientFromEnv must fit that local type.
const root = join(import.meta.dir, "../..");
let installed = false;
try { Bun.resolveSync("@hasna/secrets/sdk", root); installed = true; } catch { /* absent: an install without access to it */ }
const cache = join(root, "node_modules", ".cache");
const scratch = installed ? (mkdirSync(cache, { recursive: true }), mkdtempSync(join(cache, "skills-secrets-sdk-types-"))) : "";
afterAll(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });

function typecheck(name: string, body: string, extraFiles: string[] = []): { status: number | null; output: string } {
  writeFileSync(join(scratch, `${name}.ts`), `import { createSecretsClientFromEnv } from "@hasna/secrets/sdk";\nimport type { SecretsSdk } from ${JSON.stringify(join(root, "src/lib/execution-secrets.js"))};\n${body}\n`);
  writeFileSync(join(scratch, `${name}.tsconfig.json`), JSON.stringify({ extends: join(root, "tsconfig.json"), compilerOptions: { noEmit: true, rootDir: root }, include: [], files: [`${name}.ts`, ...extraFiles] }));
  const result = Bun.spawnSync([process.execPath, join(root, "node_modules/typescript/bin/tsc"), "-p", join(scratch, `${name}.tsconfig.json`)], { cwd: scratch, stdout: "pipe", stderr: "pipe", timeout: 120_000 });
  return { status: result.exitCode, output: result.stdout.toString() + result.stderr.toString() };
}

test.skipIf(!installed)("the installed @hasna/secrets SDK fits Skills' local SecretsSdk type", () => {
  const fits = typecheck("fits", "export const sdk: SecretsSdk = { createSecretsClientFromEnv };");
  expect(fits.output).toBe("");
  expect(fits.status).toBe(0);
  // src/types/hasna-secrets-sdk.d.ts, under another module name, accepts the real function too.
  const ambient = readFileSync(join(root, "src/types/hasna-secrets-sdk.d.ts"), "utf8").replace('declare module "@hasna/secrets/sdk"', 'declare module "skills-ambient-secrets-sdk"');
  writeFileSync(join(scratch, "ambient.d.ts"), ambient);
  const declared = typecheck("declared", 'import type * as Ambient from "skills-ambient-secrets-sdk";\nexport const declared: typeof Ambient.createSecretsClientFromEnv = createSecretsClientFromEnv;', ["ambient.d.ts"]);
  expect(declared.output).toBe("");
  expect(declared.status).toBe(0);
  // The same check refuses a shape the real SDK does not have.
  const refused = typecheck("refused", "export const sdk: { createSecretsClientFromEnv(): { baseUrl: number } } = { createSecretsClientFromEnv };");
  expect(refused.status).not.toBe(0);
  expect(refused.output).toContain("baseUrl");
}, 240_000);
