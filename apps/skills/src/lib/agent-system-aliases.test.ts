import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
import { DATA_DIR_ENV } from "./config.js";
import { inventoryNativeSkills, parseNativeMigrationTargetManifest, planAgentIntegration, selectNativeMigrationTargets } from "./agent-integration.js";

useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "skills-system-alias-"))); roots.push(root);
  const home = join(root, "home"), project = join(root, "project");
  mkdirSync(home); mkdirSync(project);
  return { root, home, project };
}

test.skipIf(process.platform !== "darwin")("CLI inventory gives identical results through the macOS temporary alias and canonical project", () => {
  const { home, project } = fixture();
  // The suite accepts either macOS temporary prefix, including default TMPDIR.
  const alias = project.replace(/^\/private\/(tmp|var)(?=\/)/, "/$1");
  expect(alias).not.toBe(project);
  const skill = join(project, ".claude", "skills", "fixture"); mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "Synthetic instructions\n");
  const cli = new URL("../cli/index.tsx", import.meta.url).pathname;
  const invoke = (path: string) => Bun.spawnSync([process.execPath, "--no-env-file", cli, "migrate", "native", "--agent", "claude", "--project", path, "--json"], {
    cwd: home, env: { HOME: home, TMPDIR: tmpdir(), PATH: process.env.PATH, HASNA_STATION: "skills-test-no-keychain", NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe", timeout: 10000,
  });
  const canonical = invoke(project), aliased = invoke(alias);
  expect(canonical.exitCode).toBe(0); expect(aliased.stderr.toString()).toBe(""); expect(aliased.exitCode).toBe(0);
  expect(JSON.parse(aliased.stdout.toString())).toEqual(JSON.parse(canonical.stdout.toString()));
  expect(JSON.parse(aliased.stdout.toString()).inventory).toHaveLength(1);
  const inventory = inventoryNativeSkills(home, { projectDirs: [project, alias], agents: ["claude"] });
  expect(inventory).toHaveLength(1);
  const target = { agent: "claude", projectRoot: alias, path: ".claude/skills/fixture", treeSha256: inventory[0]!.hash };
  const manifest = { schema: "hasna.skills-native-migration-targets.v1", targets: [target] };
  expect(selectNativeMigrationTargets(inventory, parseNativeMigrationTargetManifest(JSON.stringify(manifest)))).toEqual(inventory);
  expect(() => parseNativeMigrationTargetManifest(JSON.stringify({ ...manifest, targets: [target, { ...target, projectRoot: project }] }))).toThrow("Duplicate native migration target");
});

test("inventory still refuses user-controlled ancestor links even when their native directory is absent", () => {
  const { root, home, project } = fixture(), alias = join(root, "alias");
  symlinkSync(project, alias);
  expect(inventoryNativeSkills(home, { projectDir: project, agents: ["claude"] })).toEqual([]);
  expect(() => inventoryNativeSkills(home, { projectDir: alias, agents: ["claude"] })).toThrow("Refusing symlink path");
});

test.skipIf(process.platform !== "darwin")("system alias normalization preserves refusal of symlinked native content", () => {
  const { home, project } = fixture(), skill = join(project, ".claude", "skills", "fixture");
  mkdirSync(skill, { recursive: true }); writeFileSync(join(skill, "SKILL.md"), "Synthetic instructions\n");
  symlinkSync(home, join(skill, "escape"));
  const alias = project.replace(/^\/private\/(tmp|var)(?=\/)/, "/$1");
  expect(() => inventoryNativeSkills(home, { projectDir: alias, agents: ["claude"] })).toThrow("symlink");
});

/** Model protected OS metadata in an isolated child; never alter host aliases.
 * These cases run on Linux too, alongside the actual macOS CLI test above. */
function systemAliasProbe(alias: string, fault: string): boolean {
  const script = `import { mock } from "bun:test"; import * as original from "node:fs";
const fs = { ...original }, alias = ${JSON.stringify(alias)}, fault = ${JSON.stringify(fault)}, target = "/private" + alias;
Object.defineProperty(process, "platform", { value: fault === "other-os" ? "linux" : "darwin" });
const calls = new Map(); let descriptorPath = "";
function metadata(path) {
  path = String(path); const count = (calls.get(path) || 0) + 1; calls.set(path, count);
  if (!["/", "/private", target, alias].includes(path)) return undefined;
  const link = path === alias || fault === "target-chain" && path === target;
  return { uid: path === alias && fault === "user-owned" ? 501n : 0n, dev: 1n,
   ino: (fault === "link-replaced" && path === alias && count >= 3 || fault === "target-replaced" && path === target && count >= 2) ? 2n : 1n,
   ctimeNs: 1n, mode: link ? 0o120777n : path === "/private/tmp" ? (fault === "nonsticky" ? 0o40777n : 0o41777n) : fault === "writable-parent" && path === "/private" || fault === "writable-target" && path === target ? 0o40777n : 0o40755n,
   isSymbolicLink() { return link; }, isDirectory() { return !link; } };
 }
// Bun require uses the builtin object, independently of the ESM mock registry.
// This mutation is confined to this fresh probe child.
Object.assign(require("bun:ffi"), {
 dlopen() {
  if (fault === "acl-no-capability") throw new Error("Unsupported native capability");
  return { symbols: {
   __error() { return fault === "acl-errno-missing" ? null : 1; },
   acl_get_fd() { return ["writable-acl", "other-principal-acl"].includes(fault) && descriptorPath === "/private" ? 2 : fault === "acl-ambiguous" ? undefined : null; },
   acl_free() { return 0; },
  }, close() {} };
 },
 read: { i32() { return fault === "acl-error" ? 5 : fault === "acl-unsupported" ? 45 : 2; } }
});
mock.module("node:fs", () => ({ ...fs,
 existsSync() { return false; }, lstatSync: metadata,
 openSync(path) { descriptorPath = String(path); return 42; }, closeSync() {},
 fstatSync() { const stat = metadata(descriptorPath); if (fault === "descriptor-replaced") stat.ino = 9n; return stat; },
 readlinkSync() { return fault === "escape" ? "other" : fault === "chain" ? "private/alias" : "private" + alias; },
 realpathSync() { return fault === "resolved-escape" ? "/elsewhere" : target; },
}));
const { inventoryNativeSkills } = await import(${JSON.stringify(new URL("./agent-integration.ts", import.meta.url).href)});
try { inventoryNativeSkills("/isolated-home", { projectDir: alias + "/project", agents: ["claude"] }); console.log("accepted"); }
catch { console.log("refused"); }`;
  const child = Bun.spawnSync([process.execPath, "--no-env-file", "-e", script], { cwd: tmpdir(), env: { HOME: tmpdir(), TMPDIR: tmpdir(), PATH: process.env.PATH }, stdout: "pipe", stderr: "pipe", timeout: 10000 });
  expect(child.stderr.toString()).toBe(""); expect(child.exitCode).toBe(0);
  return child.stdout.toString().trim() === "accepted";
}

for (const alias of ["/var", "/tmp", "/etc"]) {
  test(`inventory recognizes only the protected macOS ${alias} binding`, () => {
    expect(systemAliasProbe(alias, "none")).toBe(true);
    for (const fault of ["other-os", "user-owned", "escape", "chain", "target-chain", "writable-parent", "writable-acl", "other-principal-acl", "acl-error", "acl-unsupported", "acl-no-capability", "acl-errno-missing", "acl-ambiguous", "descriptor-replaced", "resolved-escape", "link-replaced", "target-replaced", alias === "/tmp" ? "nonsticky" : "writable-target"]) {
      expect({ fault, accepted: systemAliasProbe(alias, fault) }).toEqual({ fault, accepted: false });
    }
  });
}

test("root ownership never exempts an unrecognized ancestor link", () => {
  expect(systemAliasProbe("/unrecognized", "none")).toBe(false);
});

function temporaryAlias(path: string): string {
  return path.replace(/^\/private\/(tmp|var)(?=\/)/, "/$1");
}

function vendorFixture(targetAlias = false) {
  const { home } = fixture();
  const parent = join(home, ".codex", "plugins", "cache", "bundled", "plugin");
  const version = join(parent, "1.0.0"), skill = join(version, "skills", "fixture"), latest = join(parent, "latest");
  mkdirSync(skill, { recursive: true }); writeFileSync(join(skill, "SKILL.md"), "Synthetic vendor instructions\n");
  symlinkSync(targetAlias ? temporaryAlias(version) : version, latest);
  return { home, parent, version, skill, latest };
}

test.skipIf(process.platform !== "darwin")("disabled vendor documents accept canonical and OS-alias absolute latest targets", () => {
  for (const targetAlias of [false, true]) for (const selectorAlias of [false, true]) {
    const { home, skill } = vendorFixture(targetAlias);
    const document = join(skill, "SKILL.md");
    writeFileSync(join(home, ".codex", "config.toml"), `[[skills.config]]\npath = ${JSON.stringify(selectorAlias ? temporaryAlias(document) : document)}\nenabled = false\n`);
    const options = { home, dataDir: join(home, "data"), agents: ["codex" as const], projectDir: home };
    expect(planAgentIntegration(options).nativeSkills.map(entry => entry.path)).toEqual([skill]);
    expect(planAgentIntegration({ ...options, home: temporaryAlias(home), projectDir: temporaryAlias(home) }).nativeSkills.map(entry => entry.path)).toEqual([skill]);
  }
});

test.skipIf(process.platform !== "darwin")("disabled vendor callbacks compose with normalized paths and home aliases", () => {
  for (const targetAlias of [false, true]) for (const homeAlias of [false, true]) {
    const { home, skill, version, latest } = vendorFixture(targetAlias);
    const second = join(version, "skills", "second");
    mkdirSync(second); writeFileSync(join(second, "SKILL.md"), "Synthetic second vendor instructions\n");
    const options = { agents: ["codex" as const], includeVendor: true };
    const expected = inventoryNativeSkills(home, { ...options, reviewedCacheAlias: latest });
    const selectedHome = homeAlias ? temporaryAlias(home) : home;
    const seen: string[] = [];
    const actual = inventoryNativeSkills(selectedHome, {
      ...options, disabledVendorPaths: [temporaryAlias(skill)],
      disabledVendorSkill(entry) { seen.push(entry.path); return entry.path === second; },
    });
    expect(actual).toEqual(expected);
    expect(seen).toEqual([second]);
    expect(() => inventoryNativeSkills(selectedHome, {
      ...options, disabledVendorPaths: [temporaryAlias(skill)], disabledVendorSkill: () => false,
    })).toThrow("Refusing symlink path");
    expect(inventoryNativeSkills(selectedHome, {
      ...options, reviewedCacheAlias: temporaryAlias(latest), disabledVendorSkill: () => true,
    })).toEqual(expected);
  }
});

test.skipIf(process.platform !== "darwin")("vendor selectors and reviewed-cache CLI match either verified OS prefix", () => {
  for (const targetAlias of [false, true]) {
    const { home, skill, latest } = vendorFixture(targetAlias);
    const expected = inventoryNativeSkills(home, { agents: ["codex"], includeVendor: true, reviewedCacheAlias: latest });
    for (const selectorAlias of [false, true]) {
      const reviewedCacheAlias = selectorAlias ? temporaryAlias(latest) : latest;
      const disabledVendorPaths = [selectorAlias ? temporaryAlias(skill) : skill];
      expect(inventoryNativeSkills(home, { agents: ["codex"], includeVendor: true, reviewedCacheAlias })).toEqual(expected);
      expect(inventoryNativeSkills(home, { agents: ["codex"], includeVendor: true, disabledVendorPaths })).toEqual(expected);
      const child = Bun.spawnSync([process.execPath, "--no-env-file", new URL("../cli/index.tsx", import.meta.url).pathname,
        "migrate", "native", "--agent", "codex", "--include-vendor", "--reviewed-cache-alias", reviewedCacheAlias, "--json"], {
        cwd: home, env: { HOME: home, TMPDIR: tmpdir(), PATH: process.env.PATH, HASNA_STATION: "skills-test-no-keychain", NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe", timeout: 10000,
      });
      expect(child.stderr.toString()).toBe(""); expect(child.exitCode).toBe(0);
      expect(JSON.parse(child.stdout.toString()).inventory).toEqual(expected);
    }
  }
});

test.skipIf(process.platform !== "darwin")("hook planning and CLI match reviewed aliases before the disabled vendor early return", () => {
  for (const enabled of [true, false]) for (const selectorAlias of [false, true]) {
    const { home, skill, latest } = vendorFixture(true);
    const dataDir = join(home, "data"), document = join(skill, "SKILL.md"), configPath = join(home, ".codex", "config.toml");
    const reviewedCacheAlias = selectorAlias ? temporaryAlias(latest) : latest;
    const original = `# preserved header\n[skills]\nconfig = [{ path = ${JSON.stringify(document)}, enabled = ${enabled} }]\nkeep_this = "preserved"\n[skills.bundled]\nenabled = false\n`;
    writeFileSync(configPath, original);
    const options = { home, dataDir, agents: ["codex" as const], projectDir: home };
    const plan = planAgentIntegration({ ...options, reviewedCacheAlias });
    expect(plan.nativeSkills.filter(entry => entry.vendor).map(entry => entry.path)).toEqual([skill]);
    const configChange = plan.changes.find(change => change.path === configPath);
    if (enabled) {
      // The enabled document must be disabled through a planned rewrite.
      const planned = configChange!.after!;
      expect(planned).toContain("# preserved header");
      const parsed = Bun.TOML.parse(planned) as { skills: { keep_this: string; config: unknown[] } };
      expect(parsed.skills.keep_this).toBe("preserved");
      expect(parsed.skills.config).toContainEqual({ path: document, enabled: false });
    } else {
      // Already disabled: the config is semantically current, so planning keeps
      // the native bytes and only witnesses them (semantic no-op since 0.10.45).
      // The reviewed alias still resolves before the disabled-vendor early return.
      expect(configChange).toBeUndefined();
      expect(plan.observedSettings).toEqual({ path: configPath, before: original });
    }
    expect(() => planAgentIntegration({ ...options, reviewedCacheAlias: `${reviewedCacheAlias}-other` })).toThrow(/Refusing symlink path|Reviewed cache alias/);
    const child = Bun.spawnSync([process.execPath, "--no-env-file", new URL("../cli/index.tsx", import.meta.url).pathname,
      "hook", "install", "--agent", "codex", "--reviewed-cache-alias", reviewedCacheAlias, "--json"], {
      cwd: home, env: { HOME: home, [DATA_DIR_ENV]: dataDir, TMPDIR: tmpdir(), PATH: process.env.PATH, HASNA_STATION: "skills-test-no-keychain", NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe", timeout: 10000,
    });
    expect(child.stderr.toString()).toBe(""); expect(child.exitCode).toBe(0);
    expect(JSON.parse(child.stdout.toString()).nativeSkills.filter((entry: { vendor?: boolean }) => entry.vendor).map((entry: { path: string }) => entry.path)).toEqual([skill]);
  }
});

test.skipIf(process.platform !== "darwin")("OS-prefix normalization preserves exact vendor selectors and refuses enabled or unsafe content", () => {
  const { home, skill, latest, version } = vendorFixture(true);
  const options = { agents: ["codex"] as const, includeVendor: true };
  expect(() => inventoryNativeSkills(home, options)).toThrow("Refusing symlink path");
  expect(() => inventoryNativeSkills(home, { ...options, reviewedCacheAlias: `${temporaryAlias(latest)}/../latest` })).toThrow("exact absolute path");
  expect(() => inventoryNativeSkills(home, { ...options, disabledVendorPaths: [`${temporaryAlias(skill)}/../fixture`] })).toThrow("exact absolute paths");
  const userAlias = join(home, "user-alias"); symlinkSync(version, userAlias);
  expect(() => inventoryNativeSkills(home, { ...options, disabledVendorPaths: [join(userAlias, "skills", "fixture")] })).toThrow("Refusing symlink path");
  expect(() => inventoryNativeSkills(home, { ...options, reviewedCacheAlias: join(userAlias, "latest") })).toThrow("Refusing symlink path");
  symlinkSync(home, join(skill, "unsafe"));
  expect(() => inventoryNativeSkills(home, { ...options, disabledVendorPaths: [temporaryAlias(skill)] })).toThrow("symlink");
});

test.skipIf(process.platform !== "darwin")("OS-prefixed vendor links still require a direct real sibling target", () => {
  for (const kind of ["unnormalized", "chain", "escape"]) {
    const { home } = fixture(), parent = join(home, ".codex", "plugins", "cache", "bundled", "plugin");
    const version = join(parent, "1.0.0"), skill = join(version, "skills", "fixture"), latest = join(parent, "latest");
    mkdirSync(skill, { recursive: true }); writeFileSync(join(skill, "SKILL.md"), "Synthetic vendor instructions\n");
    const chain = join(parent, "chain"), outside = join(home, "outside");
    if (kind === "chain") symlinkSync(version, chain);
    if (kind === "escape") mkdirSync(outside);
    const target = kind === "unnormalized" ? `${version}/../1.0.0` : kind === "chain" ? chain : outside;
    symlinkSync(temporaryAlias(target), latest);
    expect(() => inventoryNativeSkills(home, { agents: ["codex"], includeVendor: true, reviewedCacheAlias: temporaryAlias(latest) })).toThrow("Refusing symlink path");
  }
});


test.skipIf(process.platform !== "darwin")("exact system roots normalize before manifest parsing and direct selection", () => {
  for (const alias of ["/tmp", "/var", "/etc"]) {
    const target = { agent: "claude", projectRoot: alias, path: "synthetic-target", treeSha256: "0".repeat(64) };
    const canonicalTarget = { ...target, projectRoot: `/private${alias}` };
    const make = (target: typeof canonicalTarget) => ({ schema: "hasna.skills-native-migration-targets.v1" as const, targets: [target], digest: "0".repeat(64) });
    const canonical = parseNativeMigrationTargetManifest(JSON.stringify({ schema: make(target).schema, targets: [canonicalTarget] }));
    const aliased = parseNativeMigrationTargetManifest(JSON.stringify({ schema: make(target).schema, targets: [target] }));
    expect(aliased.targets).toEqual(canonical.targets);
    // No host contents are inventoried: both direct API spellings must reach
    // the same exact-target matching guard after validating the existing root.
    for (const root of [target, canonicalTarget]) expect(() => selectNativeMigrationTargets([], make(root))).toThrow("not found exactly once");
    expect(() => parseNativeMigrationTargetManifest(JSON.stringify({ schema: make(target).schema, targets: [target, canonicalTarget] }))).toThrow("Duplicate native migration target");
  }
  const { home, project } = fixture(), skill = join(project, ".claude", "skills", "fixture");
  mkdirSync(skill, { recursive: true }); writeFileSync(join(skill, "SKILL.md"), "Synthetic exact-root selection\n");
  const inventory = inventoryNativeSkills(home, { projectDir: project, agents: ["claude"] });
  const alias = project.startsWith("/private/tmp/") ? "/tmp" : "/var";
  const target = { agent: "claude", projectRoot: alias, path: relative(`/private${alias}`, skill), treeSha256: inventory[0]!.hash };
  const manifest = { schema: "hasna.skills-native-migration-targets.v1" as const, targets: [target], digest: "0".repeat(64) };
  expect(selectNativeMigrationTargets(inventory, manifest)).toEqual(inventory);
});

test.skipIf(process.platform !== "darwin")("system alias protection refuses real ACL replacement rights despite denied W_OK", () => {
  const { root } = fixture();
  const script = `import { mock } from "bun:test"; import * as original from "node:fs"; import { join } from "node:path";
const fs = {...original}, root = ${JSON.stringify(join(root, "namespace"))};
fs.mkdirSync(root);fs.mkdirSync(join(root,"private"));fs.mkdirSync(join(root,"private/var"));fs.symlinkSync("private/var",join(root,"var"));
for(const path of [root,join(root,"private"),join(root,"private/var")])fs.chmodSync(path,0o555);
const mapped=(path)=>join(root,String(path));
const owned=(stat)=>new Proxy(stat,{get(target,key){if(key==="uid")return 0n;const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
// Only OS namespace and root ownership are modeled; directory modes, ACLs,
// descriptors, metadata identities and replacement operations are real.
mock.module("node:fs",()=>({...fs,
 existsSync(path){return fs.existsSync(mapped(path));},
 lstatSync(path,options){const stat=fs.lstatSync(mapped(path),options);return stat?owned(stat):stat;},
 fstatSync(fd,options){return owned(fs.fstatSync(fd,options));},
 openSync(path,...args){return fs.openSync(mapped(path),...args);},
 readlinkSync(path){return fs.readlinkSync(mapped(path));},
 realpathSync(path){return fs.realpathSync(mapped(path)).slice(root.length)||"/";},
 accessSync(path,mode){return fs.accessSync(mapped(path),mode);}
}));
const {inventoryNativeSkills}=await import(${JSON.stringify(new URL("./agent-integration.ts", import.meta.url).href)});
const accepts=()=>{try{inventoryNativeSkills("/synthetic-home",{projectDir:"/var/project",agents:["claude"]});return true;}catch{return false;}};
const protectedControl=accepts();
const account=Bun.spawnSync(["/usr/bin/id","-un"],{stdout:"pipe",stderr:"pipe"});if(account.exitCode!==0)throw Error("Account lookup failed");
const name=account.stdout.toString().trim();
const parentAcl=Bun.spawnSync(["/bin/chmod","+a","user:"+name+" allow add_subdirectory,delete_child",join(root,"private")]);
const targetAcl=Bun.spawnSync(["/bin/chmod","+a","user:"+name+" allow delete,add_subdirectory,delete_child",join(root,"private/var")]);
const acceptedWithAcl=accepts();let writeAccess="allowed";try{fs.accessSync(join(root,"private"),fs.constants.W_OK);}catch(e){writeAccess=e.code;}
const replacements=[["/bin/mkdir",join(root,"private/replacement")],["/bin/mv",join(root,"private/var"),join(root,"private/var-preserved")],["/bin/mv",join(root,"private/replacement"),join(root,"private/var")]].map(args=>Bun.spawnSync(args,{stdout:"pipe",stderr:"pipe"}).exitCode);
for(const path of [root,join(root,"private"),join(root,"private/var"),join(root,"private/var-preserved")])if(fs.existsSync(path))fs.chmodSync(path,0o700);
console.log(JSON.stringify({protectedControl,parentAcl:parentAcl.exitCode,targetAcl:targetAcl.exitCode,acceptedWithAcl,writeAccess,replacements}));`;
  const child = Bun.spawnSync([process.execPath, "--no-env-file", "-e", script], { cwd: tmpdir(), env: { HOME: root, TMPDIR: tmpdir(), PATH: process.env.PATH }, stdout: "pipe", stderr: "pipe", timeout: 10000 });
  expect(child.stderr.toString()).toBe(""); expect(child.exitCode).toBe(0);
  expect(JSON.parse(child.stdout.toString())).toEqual({ protectedControl: true, parentAcl: 0, targetAcl: 0, acceptedWithAcl: false, writeAccess: "EACCES", replacements: [0, 0, 0] });
});
