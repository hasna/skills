#!/usr/bin/env bun
import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PRIVATE_PACKAGES } from "./fetch-locked-private.mjs";

/**
 * Every name every entry of the installed @hasna/secrets exports, read from its
 * entry files now. The build installs it from the locked tarball; without it
 * the bundle-content check cannot know what to look for, so it refuses.
 */
function secretsExportNames(sourceRoot: string): Map<string, string[]> {
  const root = join(sourceRoot, "node_modules", "@hasna", "secrets");
  assert(existsSync(join(root, "package.json")), "The bundle-content check needs the installed @hasna/secrets (the locked tarball) to read its export names");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { exports: Record<string, string | Record<string, string>> };
  const scanner = new Bun.Transpiler({ loader: "js" });
  const names = new Map<string, string[]>();
  for (const [entry, target] of Object.entries(manifest.exports)) {
    const file = typeof target === "string" ? target : target.import ?? target.default;
    assert(file, `@hasna/secrets entry ${entry} has no JavaScript file`);
    const source = readFileSync(join(root, file), "utf8");
    assert(!/^\s*export\s*\*/m.test(source), `@hasna/secrets entry ${entry} re-exports with export *, so its names cannot be listed`);
    names.set(entry, scanner.scan(source).exports);
  }
  return names;
}
/** Skills' own declarations that share a name with a @hasna/secrets export, allowed only at their exact origin. */
const SKILLS_OWN_DECLARATIONS: Record<string, string> = { isApiMode: "src/lib/feedback.ts" };

// SH-00058. Install the packed archive the way an anonymous public consumer
// does: a fresh HOME and caches, no npm credentials, the public registry only.
// The public registry refuses an anonymous read of a private package, so none
// may be a required dependency: npm and bun must both install the archive, the
// private packages must stay absent, and the installed CLI must still run.
const archive = process.argv[2] ? resolve(process.argv[2]) : "";
assert(archive.endsWith(".tgz") && existsSync(archive), "usage: consumer-anonymous.ts <packed archive>");
const workspace = await mkdtemp(join(tmpdir(), "skills-consumer-anonymous-"));
await chmod(workspace, 0o700);
const home = join(workspace, "home");
await mkdir(home, { mode: 0o700 });
const npmExecutable = Bun.which("npm"), nodeExecutable = Bun.which("node");
assert(npmExecutable && nodeExecutable, "Anonymous consumer proof requires the selected npm and Node toolchain");
const toolDirectories = new Set([dirname(process.execPath), dirname(npmExecutable), dirname(nodeExecutable)]);
const toolPath = [...new Set([...(process.env.PATH ?? "").split(":").filter(path => toolDirectories.has(resolve(path))),
  ...toolDirectories, "/usr/bin", "/bin"])].join(":");
const env = { PATH: toolPath, HOME: home,
  TMPDIR: workspace, NO_COLOR: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
  BUN_INSTALL_CACHE_DIR: join(workspace, "package-cache"),
  NPM_CONFIG_CACHE: join(workspace, "npm-cache"),
  NPM_CONFIG_USERCONFIG: join(workspace, "user.npmrc"),
  NPM_CONFIG_GLOBALCONFIG: join(workspace, "global.npmrc") };
await writeFile(env.NPM_CONFIG_USERCONFIG, "registry=https://registry.npmjs.org/\n", { mode: 0o600 });
await writeFile(env.NPM_CONFIG_GLOBALCONFIG, "", { mode: 0o600 });

function run(command: string[], cwd: string, limitMs = 300_000) {
  const result = Bun.spawnSync(command, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: limitMs });
  return { status: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function assertInstalled(name: string, result: ReturnType<typeof run>) {
  assert.equal(result.status, 0, `${name} failed (${result.status})\n${result.stderr.slice(-2000)}`);
}

try {
  const unpacked = run(["tar", "-xzOf", archive, "package/package.json"], workspace);
  assert.equal(unpacked.status, 0, "The archive has no package/package.json");
  const packed = JSON.parse(unpacked.stdout) as Record<string, unknown> & { version: string };

  // Seven-day release age for third-party packages; exact Hasna names are publisher-exempt.
  const before = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const consumers: Array<[string, string, string[]]> = [
    ["npm", join(workspace, "npm"), [npmExecutable, "install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", `--before=${before}`]],
    ["bun", join(workspace, "bun"), [process.execPath, "--no-env-file", "install", "--production", "--ignore-scripts",
      "--backend=copyfile", "--linker=hoisted", `--config=${join(workspace, "bun", "bunfig.toml")}`]],
  ];
  for (const [tool, directory, install] of consumers) {
    await mkdir(directory, { mode: 0o700 });
    await writeFile(join(directory, "package.json"), JSON.stringify({ private: true,
      dependencies: { "@hasna/skills": `file:${archive}` } }));
    await writeFile(join(directory, "bunfig.toml"), `[install]\nregistry = "https://registry.npmjs.org"\nminimumReleaseAge = 604800\nminimumReleaseAgeExcludes = ["@hasna/skills", "@hasna/contracts", "@hasna/events", "@hasna/secrets"]\n`);
    assertInstalled(`Anonymous ${tool} install of the packed archive`, run(install, directory));
    // npm nests a private package under Skills when a hoisted peer range excludes it; check both places.
    for (const name of PRIVATE_PACKAGES) for (const at of ["node_modules", "node_modules/@hasna/skills/node_modules"])
      assert(!existsSync(join(directory, at, name, "package.json")), `${tool}: ${name} was installed without credentials`);
    const version = run([join(directory, "node_modules/.bin/skills"), "--version"], directory, 30_000);
    assert.equal(version.status, 0, `${tool}: skills --version failed\n${version.stderr.slice(-2000)}`);
    assert.equal(version.stdout.trim(), packed.version, `${tool}: skills --version printed another version`);
    console.log(`PASS anonymous ${tool} install of the packed archive runs skills --version`);
  }

  for (const name of PRIVATE_PACKAGES) {
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "bundleDependencies", "bundledDependencies"]) {
      const value = packed[field] as Record<string, string> | string[] | undefined;
      assert(!(Array.isArray(value) ? value.includes(name) : value && name in value), `The packed manifest lists ${name} in ${field}`);
    }
    assert((packed.optionalDependencies as Record<string, string> | undefined)?.[name], `The packed manifest does not list ${name} as optional`);
  }
  console.log(`PASS the packed manifest lists ${PRIVATE_PACKAGES.join(", ")} only as optional dependencies`);

  // No secrets code ships in this public tarball (SH-00058). The optional
  // @hasna/secrets is loaded only by a dynamic import of its SDK entry, and no
  // name that entry exports is declared or referenced except as a member of the
  // module so loaded (Skills' default client factory, contracts' vault loader).
  const packageRoot = join(workspace, "bun/node_modules/@hasna/skills");
  const scanner = new Bun.Transpiler({ loader: "js" });
  const secretsImports = (source: string) => scanner.scanImports(source)
    .filter(item => PRIVATE_PACKAGES.some(name => item.path === name || item.path.startsWith(`${name}/`)))
    .map(item => `${item.kind} ${item.path}`);
  const entries = secretsExportNames(resolve(import.meta.dir, ".."));
  const exportNames = [...new Set([...entries.values()].flat())].sort();
  assert(exportNames.length > 0, "@hasna/secrets exports no names to look for");
  // A name counts wherever it is declared or referenced except as a member of the
  // lazily loaded module. One of Skills' own declarations that shares a name is
  // allowed only as exactly one declaration inside its own module's marker.
  const secretsCode = (source: string) => exportNames.flatMap(name => {
    const hits = [...source.matchAll(new RegExp(`(?<![.\\w$])${name}\\d*(?![\\w$])`, "g"))];
    const origin = SKILLS_OWN_DECLARATIONS[name];
    if (!hits.length || !origin) return hits.map(() => name);
    const declarations = [...source.matchAll(new RegExp(`function ${name}\\(`, "g"))];
    const markerBefore = (index: number) => [...source.slice(0, index).matchAll(/^\/\/ (\S+)$/gm)].at(-1)?.[1];
    const own = declarations.length === 1 && markerBefore(declarations[0]!.index!) === origin && hits.every(hit => hit[0] === name);
    return own ? [] : hits.map(() => name);
  });
  const control = 'import "@hasna/secrets"; class ApiError2 {} const sdk = await import("@hasna/secrets/sdk"); sdk.createSecretsClientFromEnv();';
  assert.deepEqual(secretsImports(control), ["import-statement @hasna/secrets", "dynamic-import @hasna/secrets/sdk"], "The import scanner misses a known import");
  assert(secretsCode(control).includes("ApiError") && !secretsCode(control).includes("createSecretsClientFromEnv"), "The secrets name scan misses a known declaration");
  // Controls: one declaration from each entry is caught, and Skills' own isApiMode passes only at its origin.
  for (const [entry, names] of entries) if (names.length)
    assert(secretsCode(`// node_modules/@hasna/secrets/dist/x.js\nfunction ${names[0]}() {}\n`).length > 0, `The scan misses entry ${entry}'s ${names[0]}`);
  assert.deepEqual(secretsCode("// src/lib/feedback.ts\nfunction isApiMode() {}\nisApiMode();\n"), [], "Skills' own isApiMode at its origin is refused");
  assert(secretsCode("// src/lib/other.ts\nfunction isApiMode() {}\n").length > 0, "An isApiMode outside src/lib/feedback.ts is not caught");
  assert(secretsCode("// src/lib/feedback.ts\nfunction isApiMode() {}\nfunction isApiMode2() {}\n").length > 0, "A second, renamed isApiMode is not caught");
  let scanned = 0, lazy = 0;
  for (const directory of ["bin", "dist"]) {
    for (const entry of readdirSync(join(packageRoot, directory), { recursive: true }) as string[]) {
      const text = entry.endsWith(".js") || entry.endsWith(".d.ts") ? readFileSync(join(packageRoot, directory, entry), "utf8") : "";
      if (entry.endsWith(".d.ts")) assert(!/["']@hasna\/secrets(\/[^"']*)?["']/.test(text), `${directory}/${entry} refers to @hasna/secrets`);
      if (!entry.endsWith(".js")) continue;
      const imports = secretsImports(text.replace(/^#!.*\n/, ""));
      assert(imports.every(item => item === "dynamic-import @hasna/secrets/sdk"), `${directory}/${entry} imports ${imports.join(", ")}`);
      assert.deepEqual(secretsCode(text), [], `${directory}/${entry} carries @hasna/secrets code`);
      lazy += imports.length;
      scanned += 1;
    }
  }
  assert(scanned > 0 && lazy > 0, "No built JavaScript, or no lazy @hasna/secrets load, was found");
  console.log(`PASS ${scanned} built bin/ and dist/ modules carry none of the ${exportNames.length} names ${entries.size} @hasna/secrets entries export; ${lazy} load it lazily`);

  // Every bundled third-party package travels with its licence and copyright
  // text (SH-00058): the bundle's module markers name what the build bundled,
  // and a bundled file of one of our own @hasna packages names, in its own
  // markers, the third-party code that package pre-bundled into it.
  const marker = /^\/\/ .*node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\//gm;
  const moduleMarker = /^\/\/ (\S*node_modules\/\S+)$/gm;
  assert.deepEqual([..."// node_modules/a/node_modules/@b/c/index.js\n".matchAll(marker)].map(match => match[1]), ["@b/c"], "The module marker scan misses a known marker");
  const bundled = new Set<string>(), prebundled = new Set<string>(), ownFiles = new Set<string>();
  for (const directory of ["bin", "dist"])
    for (const entry of readdirSync(join(packageRoot, directory), { recursive: true }) as string[]) {
      if (!entry.endsWith(".js")) continue;
      const text = readFileSync(join(packageRoot, directory, entry), "utf8");
      for (const match of text.matchAll(marker)) if (!match[1]!.startsWith("@hasna/")) bundled.add(match[1]!);
      for (const match of text.matchAll(moduleMarker)) if (/(?:^|\/)node_modules\/@hasna\//.test(match[1]!)) ownFiles.add(match[1]!);
    }
  const consumer = join(workspace, "bun");
  for (const file of ownFiles) {
    const installed = [join(consumer, file), join(packageRoot, file)].find(path => existsSync(path));
    assert(installed, `The bundle's ${file} is not in the installed consumer tree`);
    for (const match of readFileSync(installed, "utf8").matchAll(marker)) if (!match[1]!.startsWith("@hasna/")) prebundled.add(match[1]!);
  }
  assert(prebundled.has("resolve.exports"), "No pre-bundled third-party code was found in @hasna/contracts' bundled files");
  assert(existsSync(join(packageRoot, "THIRD_PARTY_NOTICES")), "The packed archive has no THIRD_PARTY_NOTICES");
  const rule = "=".repeat(80);
  const listed = new Set<string>();
  for (const block of readFileSync(join(packageRoot, "THIRD_PARTY_NOTICES"), "utf8").split(`\n${rule}\n`).slice(1)) {
    const [heading = "", licence = ""] = block.split("\n");
    const name = heading.slice(0, heading.lastIndexOf(" "));
    const body = block.slice(block.indexOf("\n\n") + 2);
    assert(/^License: \S/.test(licence) && !licence.includes("UNKNOWN"), `THIRD_PARTY_NOTICES names no licence for ${heading}`);
    assert(/copyright/i.test(body) && body.length >= 200, `THIRD_PARTY_NOTICES carries no licence and copyright text for ${heading}`);
    listed.add(name);
  }
  const expected = [...new Set([...bundled, ...prebundled])].sort();
  const unlisted = (names: Set<string>) => expected.filter(name => !names.has(name));
  assert(bundled.size > 0, "No bundled third-party package was found");
  // Control: the same check fails when one pre-bundled package is missing from the list.
  const withoutResolveExports = new Set([...listed].filter(name => name !== "resolve.exports"));
  assert.deepEqual(unlisted(withoutResolveExports), ["resolve.exports"], "The notices check does not catch a missing pre-bundled package");
  assert.deepEqual(unlisted(listed), [], "THIRD_PARTY_NOTICES leaves bundled third-party packages out");
  assert.deepEqual([...listed].sort(), expected, "THIRD_PARTY_NOTICES does not list exactly the bundled third-party packages");
  console.log(`PASS THIRD_PARTY_NOTICES lists all ${expected.length} bundled third-party packages (${prebundled.size} pre-bundled inside our own packages) with licence and copyright text`);
} finally { await rm(workspace, { recursive: true, force: true }); }
