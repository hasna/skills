/**
 * R1 boundary guard — "unconfigured OSS never produces a URL on a
 * vendor-controlled host."
 *
 * Why this file exists: on 2026-07-24 a 30-line change swapped the shipped
 * default endpoint from one vendor host to a different vendor host. No test
 * expressed the property, so nothing went red, and an unconfigured install sent
 * credentials to a host the operator never named.
 *
 * The strongest assertion here is deliberately NOT "the resolved URL is not
 * `<some host>`". It is "there is no resolved URL at all". A guard phrased
 * against a hostname can be defeated by choosing a different hostname; a guard
 * phrased against the *existence* of a default cannot.
 *
 * AMENDED 2026-09-23 by owner ruling (Todos PLA8-00366; mementos 8a69c230 and
 * b9ef785e): "Default to skills.md (Recommended)" — "the oss is not neutral, it
 * should be primarily for skills.md ... just like codex". The product origin is
 * now the default place to SIGN IN. Everything else here still holds: data
 * surfaces with nothing configured resolve no URL and send nothing, a resolved
 * credential keeps its own instance, and the product origin is declared in
 * exactly one module and excepted only in the files listed in
 * PRODUCT_DEFAULT_URL_EXCEPTION — the same URL anywhere else is still a finding.
 */

import { describe, expect, test } from "bun:test";
import * as ts from "typescript";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MissingApiUrlError, requireApiUrl, resolveApiUrl } from "./api-url.js";
import { SkillsFleetCredentialError, resolveSkillsSignInOrigin } from "./fleet-credentials.js";
import { SKILLS_PRODUCT_DEFAULT_ORIGIN } from "./product-default.js";
import { getPackedFiles } from "./packlist.js";
import { getConfiguredApiUrl } from "./remote-registry.js";
import {
  APPROVED_CODE_HOSTS,
  DYNAMIC_HOST_SITES,
  TEMPLATE_HOST_FILES,
  FLEET_GATEWAY_HOST,
  PRODUCT_DEFAULT_URL_EXCEPTION,
  VENDOR_CONTROLLED_DOMAINS,
  VENDOR_HOST_URL_EXCEPTIONS,
  checkEntryPointCoverage,
  declaredEntryPoints,
  extractUrlReferences,
  findCodeUrlLiterals,
  findDisallowedCodeUrls,
  findVendorHostReferences,
  formatFindings,
  isCodeFile,
  isVendorControlledHost,
  readPackedSources,
  registrableDomain,
  uncoveredEntryPoints,
} from "./vendor-host-guard.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

/**
 * Every client-side resolver that can turn configuration into a URL the CLI
 * would contact. `kind` records the contract each one owes when nothing is
 * configured:
 *
 *   "closed" — read paths degrade to the bundled local registry, so they return
 *              undefined ONLY under the explicit local opt-in
 *              (HASNA_SKILLS_LOCAL=1). Without the opt-in an unconfigured
 *              install is a refusal — the fail-closed ruling — not a URL.
 *   "loud"   — auth and write paths have nothing sane to default to, so they
 *              throw an error naming the missing configuration.
 */
const CLIENT_ENDPOINT_RESOLVERS: ReadonlyArray<{
  name: string;
  module: string;
  kind: "closed" | "loud";
  resolve: (env: Record<string, string | undefined>) => string | undefined;
}> = [
  {
    name: "resolveApiUrl",
    module: "src/lib/api-url.ts",
    kind: "closed",
    resolve: (env) => resolveApiUrl(env),
  },
  {
    name: "getConfiguredApiUrl",
    module: "src/lib/remote-registry.ts",
    kind: "closed",
    resolve: (env) => getConfiguredApiUrl(env),
  },
  {
    name: "requireApiUrl",
    module: "src/lib/api-url.ts",
    kind: "loud",
    resolve: (env) => requireApiUrl("Auth", env),
  },
];

/** An environment with nothing configured — no API URL, no key, no HOME state. */
function emptyEnv(): Record<string, string | undefined> {
  return {};
}

function packedSources() {
  const root = process.cwd();
  return readPackedSources(getPackedFiles(root), root, { existsSync, statSync, readFileSync }, join);
}

function collectSourceFiles(dir: string, matcher: RegExp): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectSourceFiles(path, matcher));
    else if (matcher.test(entry.name)) found.push(path);
  }
  return found;
}

/**
 * True on a checkout where NOT ONE declared entry point has been built.
 *
 * Every entry point in package.json is a build output — `bin/*.js` from the CLI
 * and MCP bundles, `dist/*.js` from the library bundle — and `.gitignore`
 * excludes both directories. So on a fresh clone the coverage check below has
 * nothing to read, and the red it produces means "you have not run the build",
 * not "you broke the boundary". That is the worst kind of failing test: a
 * developer or agent running `bun test` on a clean tree sees a boundary guard go
 * red and reasonably reads it as a regression they caused. Suites that cry wolf
 * stop being read at all.
 *
 * Three properties keep this from being a test switched off to make a suite green:
 *
 *   - CI never skips. `.github/workflows/ci.yml` runs Build before Test (asserted
 *     by "CI builds before it tests" below), so an unbuilt tree under CI is a real
 *     failure of that ordering and stays red — which is the case the check was
 *     written for.
 *   - A PARTIAL build still runs the check in full. `some` rather than `every`:
 *     the moment one entry point exists, a second one that does not is exactly
 *     the regression being guarded — a `bin` entry added without a build step.
 *   - The neighbouring guards are unconditional. "no file under src/ names a host
 *     outside APPROVED_CODE_HOSTS" scans the tree directly and runs on any
 *     checkout, so an unbuilt run still asserts the boundary itself. Only the
 *     per-entry-point coverage assertion, which needs artifacts that do not
 *     exist yet, stands down.
 */
const UNBUILT_LOCAL_TREE = (() => {
  if (process.env["CI"]) return false;
  try {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    return !declaredEntryPoints(manifest).some((path) => existsSync(join(process.cwd(), path)));
  } catch {
    // Anything unexpected here (run from the wrong directory, unreadable manifest)
    // means run the check and let it report, rather than throwing at module scope
    // and taking the other 27 assertions in this file down with it.
    return false;
  }
})();

if (UNBUILT_LOCAL_TREE) {
  // Bun does not name skipped tests in non-TTY output, only counts them, so the
  // reason has to be printed or it is invisible to the person who needs it.
  console.log(
    "[entry-point-coverage] skipped: no declared entry point is built. " +
      "Run `bun run build` first to include it (CI always runs it).",
  );
}

describe("R1 — unconfigured client produces no endpoint", () => {
  test("resolver inventory is non-empty and covers both fail modes", () => {
    // Without this, deleting every resolver would make the suite below pass
    // vacuously — the failure mode the policy calls out explicitly.
    expect(CLIENT_ENDPOINT_RESOLVERS.length).toBeGreaterThan(0);
    expect(CLIENT_ENDPOINT_RESOLVERS.some((r) => r.kind === "closed")).toBe(true);
    expect(CLIENT_ENDPOINT_RESOLVERS.some((r) => r.kind === "loud")).toBe(true);
  });

  test("read paths yield no URL with empty env — undefined only under the opt-in", () => {
    for (const resolver of CLIENT_ENDPOINT_RESOLVERS.filter((r) => r.kind === "closed")) {
      // Fail-closed default: nothing configured and no opt-in is a refusal that
      // names the way out, never a silent local read.
      let thrown: unknown;
      try {
        resolver.resolve(emptyEnv());
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `${resolver.module} ${resolver.name} must fail closed`).toBeInstanceOf(SkillsFleetCredentialError);
      expect((thrown as SkillsFleetCredentialError).code, `${resolver.module} ${resolver.name}`).toBe("MISSING_API_CREDENTIAL");
      expect((thrown as Error).message, `${resolver.module} ${resolver.name}`).toContain("HASNA_SKILLS_LOCAL");
      // The deliberate local opt-in is the ONE empty environment that yields no
      // URL and keeps the caller working against the bundled registry.
      expect(resolver.resolve({ HASNA_SKILLS_LOCAL: "1" }), `${resolver.module} ${resolver.name}`).toBeUndefined();
    }
  });

  test("auth and write paths throw naming the missing configuration", () => {
    for (const resolver of CLIENT_ENDPOINT_RESOLVERS.filter((r) => r.kind === "loud")) {
      let thrown: unknown;
      try {
        resolver.resolve(emptyEnv());
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `${resolver.module} ${resolver.name} must fail loudly`).toBeInstanceOf(
        MissingApiUrlError,
      );
      const message = (thrown as Error).message;
      // The error has to be actionable: it names the env var and the command.
      expect(message).toContain("SKILLS_API_URL");
      expect(message).toContain("skills setup --api-url");
      // ...and it must not smuggle a usable endpoint into the "error".
      expect(extractUrlReferences(message)).toEqual([]);
    }
  });

  test("a configured URL is still honoured — the guard bans defaults, not endpoints", () => {
    // A credential is part of "configured" now: the shared ladder refuses to
    // hand back an authority it has no key for, so the pair is what a resolver
    // honours (see fleet-credentials.test.ts for the ladder itself).
    const configured = {
      HASNA_SKILLS_API_URL: "https://skills.internal.example/api/v1/",
      HASNA_SKILLS_API_KEY: "sk_boundary_test_only",
    };
    expect(resolveApiUrl(configured)).toBe("https://skills.internal.example");
    expect(requireApiUrl("Auth", configured)).toBe("https://skills.internal.example");
    expect(getConfiguredApiUrl(configured)).toBe("https://skills.internal.example");
  });

  test("an authority with no credential fails loudly instead of reading local data", () => {
    // The false green the 2026-09-04 ruling removes: an operator pointed this CLI
    // at an instance, the key went missing, and every read answered from the
    // bundled corpus as though nothing were wrong.
    const urlOnly = { HASNA_SKILLS_API_URL: "https://skills.internal.example" };
    expect(() => resolveApiUrl(urlOnly)).toThrow(/no API key resolved/);
    expect(() => getConfiguredApiUrl(urlOnly)).toThrow(/no API key resolved/);
  });

  test("a credential with no URL reaches the fleet gateway, and only then", () => {
    // The one place a vendor host may be named: with a credential in hand. R1 is
    // a rule about UNCONFIGURED installs, and this install is configured.
    expect(resolveApiUrl({ HASNA_SKILLS_API_KEY: "sk_boundary_test_only" })).toBe(
      `https://${FLEET_GATEWAY_HOST}/skills`,
    );
    expect(resolveApiUrl({ HASNA_SKILLS_LOCAL: "1" })).toBeUndefined();
  });

  // Amended 2026-09-23: a SIGN-IN with nothing configured now reaches exactly
  // the product origin (owner ruling). The request is recorded by a preload
  // guard and refused there, so the assertion is about where the CLI went, and
  // no packet leaves the machine. A DATA command in the same state still
  // reaches no host at all.
  test("the CLI's sign-in reaches only the product default when nothing is configured", async () => {
    const home = mkdtempSync(join(tmpdir(), "skills-r1-unconfigured-"));
    const guard = join(home, "fetch-guard.js");
    const log = join(home, "fetch.log");
    writeFileSync(guard, [
      'import { appendFileSync } from "node:fs";',
      "const real = globalThis.fetch;",
      "globalThis.fetch = async (input, init = {}) => {",
      '  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;',
      "  if (!/^https?:/i.test(url)) return real(input, init);",
      "  const headers = new Headers(init.headers ?? undefined);",
      '  appendFileSync(process.env.R1_FETCH_LOG, JSON.stringify({ url, authorization: headers.has("authorization") }) + "\\n");',
      '  throw new Error("NETWORK_REFUSED_BY_TEST_GUARD");',
      "};",
    ].join("\n"));
    const attempts = () => existsSync(log)
      ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { url: string; authorization: boolean })
      : [];
    try {
      // Deliberately empty: no SKILLS_API_URL, no SKILLS_API_KEY, fresh HOME.
      const env = { PATH: process.env.PATH ?? "", HOME: home, NO_COLOR: "1", SKILLS_TEST_MODE: "1", HASNA_STATION: "skills-r1-no-keychain", R1_FETCH_LOG: log };
      const run = (args: string[]) => Bun.spawnSync(
        [process.execPath, "--no-env-file", "--preload", guard, join(process.cwd(), "src/cli/index.tsx"), ...args],
        { cwd: home, env, stdout: "pipe", stderr: "pipe" },
      );

      const data = run(["list", "--json"]);
      expect(data.exitCode).not.toBe(0);
      expect(attempts()).toEqual([]);

      const signIn = run(["auth", "login", "--email", "someone@example.com", "--json"]);
      expect(signIn.exitCode).not.toBe(0);
      expect(attempts()).toEqual([{ url: `${SKILLS_PRODUCT_DEFAULT_ORIGIN}/api/auth/login`, authorization: false }]);
      expect(existsSync(join(home, ".hasna", "skills", "config", "credentials"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("R1 amended 2026-09-23 — the product default is for signing in, declared once", () => {
  test("an unconfigured sign-in targets exactly the product origin, and data paths still target nothing", () => {
    expect(resolveSkillsSignInOrigin(emptyEnv())).toEqual({ origin: SKILLS_PRODUCT_DEFAULT_ORIGIN, source: "default" });
    expect(isVendorControlledHost(new URL(SKILLS_PRODUCT_DEFAULT_ORIGIN).hostname)).toBe(true);
    for (const resolver of CLIENT_ENDPOINT_RESOLVERS) {
      expect(() => resolver.resolve(emptyEnv()), `${resolver.module} ${resolver.name}`).toThrow();
    }
  });

  test("the scoped exception covers only the declaring module, its two CLI/MCP bundles and the README", () => {
    expect(PRODUCT_DEFAULT_URL_EXCEPTION.url).toBe(SKILLS_PRODUCT_DEFAULT_ORIGIN);
    expect(PRODUCT_DEFAULT_URL_EXCEPTION.reason.length).toBeGreaterThan(20);
    expect([...PRODUCT_DEFAULT_URL_EXCEPTION.files].sort()).toEqual(["README.md", "bin/index.js", "bin/mcp.js", "src/lib/product-default.ts"]);
    // Not a global exception: those stay exact endpoints on vendor hosts.
    expect(VENDOR_HOST_URL_EXCEPTIONS.map((entry) => entry.url)).not.toContain(SKILLS_PRODUCT_DEFAULT_ORIGIN);
  });

  test("the product origin anywhere else is still a finding, in code and in prose", () => {
    const literal = `export const D = ${JSON.stringify(SKILLS_PRODUCT_DEFAULT_ORIGIN)};`;
    expect(findDisallowedCodeUrls([{ file: "src/lib/product-default.ts", content: literal }])).toEqual([]);
    for (const file of ["src/server/config.ts", "src/lib/remote-client.ts", "bin/server.js", "dist/index.js", "skills/x/src/index.ts"]) {
      const findings = findDisallowedCodeUrls([{ file, content: literal }]);
      expect(findings.map((f) => f.kind), file).toContain("vendor-host");
    }
    expect(findVendorHostReferences([{ file: "README.md", content: `Sign in at ${SKILLS_PRODUCT_DEFAULT_ORIGIN} with skills login.` }])).toEqual([]);
    // Only the exact origin: a bare domain or another URL on it is still prose that names a vendor host.
    const host = new URL(SKILLS_PRODUCT_DEFAULT_ORIGIN).hostname;
    expect(findVendorHostReferences([{ file: "README.md", content: `Sign up at ${host} today.` }]).length).toBeGreaterThan(0);
    expect(findVendorHostReferences([{ file: "README.md", content: `${SKILLS_PRODUCT_DEFAULT_ORIGIN}/api/v1/skills` }]).length).toBeGreaterThan(0);
    expect(findVendorHostReferences([{ file: "docs/skill-standard.md", content: `Sign in at ${SKILLS_PRODUCT_DEFAULT_ORIGIN}.` }]).length).toBeGreaterThan(0);
  });

  test("no other source file under src/ spells the product origin", () => {
    const root = join(process.cwd(), "src");
    const offenders = collectSourceFiles(root, /\.tsx?$/)
      .filter((file) => !/\.test\.tsx?$/.test(file))
      .map((file) => file.replace(`${process.cwd()}/`, ""))
      .filter((file) => readFileSync(join(process.cwd(), file), "utf8").includes(SKILLS_PRODUCT_DEFAULT_ORIGIN));
    expect(offenders).toEqual(["src/lib/product-default.ts"]);
  });
});

/**
 * Every syntactic position a URL literal can occupy. The guard's pass/fail
 * decision is position-independent, but this table is what stops the guard
 * silently regressing to the shape-matching version it replaced: each entry
 * must be detected, and the list must cover the forms a reviewer would think
 * to try.
 */
const URL_LITERAL_POSITIONS: ReadonlyArray<{ label: string; code: string }> = [
  { label: "variable initializer", code: 'const DEFAULT_API_URL = "https://relapse.example";' },
  { label: "fallback operand", code: 'const u = process.env.SKILLS_API_URL || "https://relapse.example";' },
  { label: "nullish fallback", code: 'const u = config.apiUrl ?? "https://relapse.example";' },
  {
    label: "constructor parameter default",
    code: 'export class C { constructor(key: string, apiUrl: string = "https://relapse.example") {} }',
  },
  {
    label: "function parameter default",
    code: 'export function f(apiUrl = "https://relapse.example") { return apiUrl; }',
  },
  {
    label: "object property",
    code: 'const DEFAULT_CONFIG: Config = { apiUrl: "https://relapse.example" };',
  },
  {
    label: "nested object property",
    code: 'export const settings = { net: { endpoints: { primary: "https://relapse.example" } } };',
  },
  { label: "class field", code: 'class C { private base = "https://relapse.example"; }' },
  { label: "ternary branch", code: 'const u = isProd ? "https://relapse.example" : local;' },
  { label: "call argument", code: 'await fetch("https://relapse.example/api/auth/login", init);' },
  { label: "return value", code: 'function base() { return "https://relapse.example"; }' },
  { label: "array element", code: 'const mirrors = ["https://relapse.example", other];' },
  { label: "template literal head", code: 'const u = `https://relapse.example/${path}`;' },
  { label: "unnamed identifier", code: 'const x = "https://relapse.example";' },
];

describe("R1 — the published package names no unapproved host", () => {
  test("a KNOWN vendor domain cannot be smuggled onto the approved-host list", () => {
    expect(APPROVED_CODE_HOSTS.length).toBeGreaterThan(0);
    for (const entry of APPROVED_CODE_HOSTS) {
      expect(VENDOR_CONTROLLED_DOMAINS, `${entry.domain} may not be approved`).not.toContain(entry.domain);
      expect(isVendorControlledHost(entry.domain)).toBe(false);
      // Every approval carries a written justification, so the list stays an
      // audited inventory rather than a dumping ground.
      expect(entry.reason.length, `${entry.domain} needs a reason`).toBeGreaterThan(20);
    }
    // The documented exceptions are exact URLs, never bare domains, so an
    // endpoint on an excepted domain is still a failure.
    for (const exception of VENDOR_HOST_URL_EXCEPTIONS) {
      expect(exception.url).toMatch(/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/);
      expect(exception.reason.length).toBeGreaterThan(20);
      const host = exception.url.split("/")[2] ?? "";
      expect(isVendorControlledHost(host)).toBe(true);
      // An exception with no path is an ORIGIN, and only the fleet gateway may be
      // excepted at its origin: that constant is what the shared client actually
      // holds, and the app slug after it is a runtime value. Every other GLOBAL
      // exception still has to name an exact endpoint; the product default is
      // not a global exception at all (PRODUCT_DEFAULT_URL_EXCEPTION is scoped
      // to the files that may carry it).
      const path = (exception.url.split("/").slice(3).join("/") ?? "").replace(/\/+$/, "");
      if (path === "") expect(host).toBe(FLEET_GATEWAY_HOST);
    }
  });

  test("detection is position-independent, not shape-matched", () => {
    // The previous regex guard matched exactly two syntactic forms and let a
    // constructor parameter default and an object property through. Every form
    // below must be detected, on a domain that is on no list at all.
    const missed: string[] = [];
    for (const { label, code } of URL_LITERAL_POSITIONS) {
      const found = findCodeUrlLiterals(`${label}.ts`, code);
      if (!found.some((f) => f.host === "relapse.example")) missed.push(label);
    }
    expect(missed).toEqual([]);

    // ...and each one is rejected, because relapse.example is not approved.
    const rejected = findDisallowedCodeUrls(
      URL_LITERAL_POSITIONS.map(({ label, code }) => ({ file: `${label}.ts`, content: code })),
    );
    expect(rejected.length).toBe(URL_LITERAL_POSITIONS.length);
  });

  test("the scanners fire on a reintroduced default in any position", () => {
    // Anti-vacuity: prove the detectors are wired before trusting their silence.
    // Case 1 is a known vendor domain; case 2 is a constructor parameter default
    // on a domain no denylist has ever heard of — the exact evasion that the
    // shape-matching version of this guard missed.
    const relapse = [
      {
        file: "src/server/config.ts",
        content: 'export const DEFAULT_SELF_HOSTED_API_URL = "https://skills.md";',
      },
      {
        file: "src/lib/remote-client.ts",
        content:
          'export class RemoteSkillsClient { constructor(apiKey: string, apiUrl: string = "https://api.new-vendor-host.example") {} }',
      },
    ];
    const findings = findDisallowedCodeUrls(relapse);
    expect([...new Set(findings.map((f) => f.file))].sort()).toEqual([
      "src/lib/remote-client.ts",
      "src/server/config.ts",
    ]);
    expect(findings.find((f) => f.file === "src/lib/remote-client.ts")?.position).toBe("parameter default");
    // The second case is caught without anyone classifying its host as ours.
    expect(
      findings.some((f) => !VENDOR_CONTROLLED_DOMAINS.includes(registrableDomain(f.host ?? ""))),
    ).toBe(true);
    expect(findVendorHostReferences(relapse).length).toBeGreaterThan(0);
  });

  // POLICY, made explicit rather than accidental: R1 forbids defaulting to a
  // host WE operate. A bring-your-own-key skill naming its provider's public
  // API is legitimate — the user supplies the credential and we never see it.
  // Identical syntax, opposite verdict, decided by who runs the host.
  test("a third-party provider default is allowed where a vendor default is not", () => {
    const asObjectProperty = (host: string) =>
      `const DEFAULT_CONFIG: Config = { apiUrl: "https://api.${host}" };`;

    const thirdParty = findDisallowedCodeUrls([
      { file: "skills/domainsearch/src/lib/config.ts", content: asObjectProperty("godaddy.com") },
    ]);
    expect(thirdParty).toEqual([]);

    const vendor = findDisallowedCodeUrls([
      { file: "skills/domainsearch/src/lib/config.ts", content: asObjectProperty("skills.md") },
    ]);
    expect(vendor.length).toBeGreaterThan(0);
    expect(vendor.every((f) => f.vendor)).toBe(true);
    expect(vendor.map((f) => f.kind)).toContain("vendor-host");
    // The value-independent token check fires on the same literal, so a vendor
    // host is caught twice over: once as a URL and once as a domain.
    expect(vendor.map((f) => f.kind)).toContain("vendor-domain-token");
    expect(vendor[0].position).toBe("object property");

    // An unapproved third party is also rejected: "third-party" is not a
    // blanket pass, it is a reviewed entry in APPROVED_CODE_HOSTS.
    const unreviewed = findDisallowedCodeUrls([
      { file: "skills/whatever/src/config.ts", content: asObjectProperty("some-unreviewed-provider.io") },
    ]);
    expect(unreviewed.length).toBe(1);
    expect(unreviewed[0].vendor).toBe(false);
    expect(unreviewed[0].kind).toBe("unapproved-host");
  });

  // A host split across string literals is a compile-time constant that no
  // per-literal scan can see: `"https://"` holds only a scheme, and
  // `"skills.md/api/v1"` holds no "//" at all, so neither fragment looks like a
  // URL. This shipped green through build, typecheck, 816 tests and the release
  // guard before constant folding was added.
  test("a host split across string literals is folded and caught", () => {
    const splits: ReadonlyArray<{ label: string; code: string }> = [
      { label: "scheme + host", code: 'const u = "https://" + "skills.md/api/v1";' },
      { label: "split at the slashes", code: 'const u = "https:" + "//skills.md/api/v1";' },
      { label: "split mid-authority", code: 'const u = "https://api." + "skills.md";' },
      { label: "nested parenthesised", code: 'const u = ("https" + "://") + ("skills" + ".md");' },
      { label: "through an as-expression", code: 'const u = ("https://" as string) + "skills.md";' },
      { label: "array join, empty separator", code: 'const u = ["https://", "skills.md"].join("");' },
      { label: "array join, separator carries it", code: 'const u = ["https:", "skills.md"].join("//");' },
      { label: "template with an empty hole", code: "const u = `https://ski${''}lls.md`;" },
      { label: "template with a runtime hole", code: "const u = `https://ski${x}lls.md`;" },
    ];

    const missed: string[] = [];
    for (const { label, code } of splits) {
      const findings = findDisallowedCodeUrls([{ file: "skills/_common/http-client.ts", content: code }]);
      if (!findings.some((f) => f.kind === "vendor-host")) missed.push(label);
    }
    expect(missed).toEqual([]);
  });

  // The sentinel marking "a value goes here" must not be forgeable from input.
  // It used to be a literal \x01 byte, so writing that byte into a string made a
  // complete hostname look templated and the finding was skipped.
  test("an in-band control byte cannot forge the hole marker", () => {
    const forged = String.fromCharCode(1);
    for (const code of [
      `const u = "https://skills.md${forged}";`,
      `const u = "https://skills${forged}.md";`,
    ]) {
      const findings = findDisallowedCodeUrls([{ file: "skills/x/src/index.ts", content: code }]);
      expect(findings.map((f) => f.kind)).toContain("vendor-host");
    }
  });

  // A host completed by a computed value is legitimate — it is what R1 asks for
  // — but it is also the shape a default hides in, so each site is acknowledged
  // rather than exempted by a blanket rule.
  test("a computed host is a finding unless the site is annotated", () => {
    const unannotated = findDisallowedCodeUrls([
      { file: "skills/brand-new/src/index.ts", content: 'const u = `https://${host}/api/v1`;' },
    ]);
    expect(unannotated.map((f) => f.kind)).toEqual(["undeterminable-host"]);

    // A bare scheme literal used as a prefix test is NOT a host and must stay
    // quiet, or every `startsWith("https://")` in the corpus becomes a finding.
    // Assembled rather than written out: the repo's own security-audit skill
    // flags a literal insecure-scheme string, and this is a fixture, not a URL.
    const insecure = `${"http"}://`;
    const schemeTest = findDisallowedCodeUrls([
      {
        file: "skills/brand-new/src/index.ts",
        content: `const ok = u.startsWith("https://") || u.startsWith("${insecure}");`,
      },
    ]);
    expect(schemeTest).toEqual([]);

    for (const site of DYNAMIC_HOST_SITES) {
      expect(site.reason.length, `${site.file} ${site.path} needs a reason`).toBeGreaterThan(20);
      // Keyed on a path, never on a bare file, so the annotation cannot be
      // stretched to cover a different site in the same file.
      expect(site.path === "" || site.path.startsWith("/")).toBe(true);
    }
    for (const entry of TEMPLATE_HOST_FILES) {
      expect(entry.reason.length).toBeGreaterThan(20);
      // File-scoped, so the carve-out cannot be claimed package-wide.
      expect(entry.file).toMatch(/^(?:bin|dist)\//);
    }
  });

  // A scanner that reports "clean" for a file it could not read has converted an
  // unknown into a certification. One stray byte used to do exactly that:
  // TypeScript returns zero statements for a file it considers binary, and the
  // walk then found nothing in an empty tree.
  test("a file that cannot be parsed is a finding, not a pass", () => {
    const strayByte = String.fromCharCode(0xe9);
    const content = `${strayByte}\nconst u = "https://a-brand-new-vendor.example";`;
    const findings = findDisallowedCodeUrls([{ file: "skills/_common/http-client.ts", content }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.kind === "unparsable" || f.kind === "vendor-host" || f.kind === "unapproved-host")).toBe(true);
  });

  test("a code file that cannot be decoded is a finding, not a skip", () => {
    const findings = findDisallowedCodeUrls([
      { file: "skills/x/src/index.ts", content: "", undecodable: "compiled or compressed binary content" },
    ]);
    expect(findings.map((f) => f.kind)).toEqual(["undecodable"]);
  });

  // NUL bytes must not remove a file from the scan — the recurring bypass this
  // repo has now fixed in three scanners. Decoding strips them instead.
  test("NUL bytes do not hide a code file from the scan", () => {
    const nul = String.fromCharCode(0);
    const root = mkdtempSync(join(tmpdir(), "skills-r1-nul-"));
    try {
      const file = join(root, "leak.ts");
      writeFileSync(file, `${nul}const u = "https://skills.md";${nul}`);
      const sources = readPackedSources(["leak.ts"], root, { existsSync, statSync, readFileSync }, join);
      expect(sources).toHaveLength(1);
      expect(findDisallowedCodeUrls(sources).map((f) => f.kind)).toContain("vendor-host");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Round-2 verification defeated the guard five more ways. Each is kept here.
  test("splitting the scheme's own slashes does not hide the host", () => {
    // `"https:/" + x` and `"https:" + x` produce no `//`, and the URL matcher
    // needs `//` to find an authority — so the scan simply never ran.
    for (const content of [
      'const P = ["/ski", "lls", ".md"];\nexport const M = "https:/" + P.map((p) => p).join("");',
      'const u = "https:" + computeHost();',
      'const u = "https:/" + computeHost();',
    ]) {
      const findings = findDisallowedCodeUrls([{ file: "src/lib/remote-registry.ts", content }]);
      expect(findings.length, content).toBeGreaterThan(0);
    }
  });

  // The annotation used to key on (file, url path), and every computed host with
  // no path renders to the same bare scheme — so one annotated site pre-approved
  // every future one in the same file. It now also has to match the expression.
  test("the bundled AWS SDK ECS credentials site is annotated for every entry that carries it", () => {
    // The exact shape the bundled `@aws-sdk/credential-provider-http` emits: the SDK's own
    // ECS constant (already certified in APPROVED_CODE_HOSTS) plus a computed relative path.
    const sdkSite = [
      'const DEFAULT_LINK_LOCAL_HOST = "http://169.254.170.2";',
      "host = `${DEFAULT_LINK_LOCAL_HOST}${relative}`;",
    ].join("\n");
    for (const file of ["bin/migrate.js", "bin/server.js", "bin/worker.js", "dist/sdk/index.js"]) {
      expect(findDisallowedCodeUrls([{ file, content: sdkSite }]).map((f) => f.kind), file).toEqual([]);
    }
    // A source file with no SDK site is not covered by the bundle entries.
    expect(findDisallowedCodeUrls([{ file: "skills/x/src/index.ts", content: sdkSite }]).map((f) => f.kind)).toEqual(["undeterminable-host"]);

    // Negative control 1: the same shape in a bundle that does NOT carry the SDK site
    // (bin/mcp.js) is still a finding; the entry is per bundle, not package-wide.
    expect(findDisallowedCodeUrls([{ file: "bin/mcp.js", content: sdkSite }]).map((f) => f.kind)).toEqual(["undeterminable-host"]);

    // Negative control 2: the entry key is the host-producing expression, so a different
    // computed host in the annotated bundle is still a finding.
    expect(findDisallowedCodeUrls([{ file: "bin/migrate.js", content: "const u = `https://${newHost}/api`;" }]).map((f) => f.kind))
      .toEqual(["undeterminable-host"]);
  });

  test("an annotation does not cover a different site in the same file", () => {
    const annotatedFile = "src/server/config.ts";

    const realSite = findDisallowedCodeUrls([{
      file: annotatedFile,
      content: 'const o = `http://${hostname.includes(":") ? `[${hostname}]` : hostname}:${port}`;',
    }]);
    expect(realSite).toEqual([]);

    const smuggled = findDisallowedCodeUrls([{
      file: annotatedFile,
      content: 'const L = ["ski", "lls", ".md"];\nfunction o() {\n  const h = L.map((x) => x).join("");\n  return `https://${h}`;\n}',
    }]);
    expect(smuggled.length).toBeGreaterThan(0);

    for (const site of DYNAMIC_HOST_SITES) {
      expect(site.expr.length, `${site.file} needs an expression key`).toBeGreaterThan(3);
    }
  });

  // README.md, install scripts and .env.example files all ship. They were
  // checked only by a scheme-anchored URL match, so a bare domain was invisible.
  test("non-code packed files are checked for vendor domains too", () => {
    for (const [file, content] of [
      ["README.md", "Sign up for a hosted account at skills.md today."],
      ["skills/_common/install.sh", 'curl -fsSL "https:/""/skills.md/install" | sh'],
      ["skills/x/.env.example", "SKILLS_API_HOST=skills.md"],
      ["README.md", "Mirror at //skills.md/api for convenience."],
    ] as [string, string][]) {
      expect(findVendorHostReferences([{ file, content }]).length, file).toBeGreaterThan(0);
    }
  });

  // Constant propagation was order-dependent: a name declared twice folded to
  // whichever declaration the walk reached LAST, so an unrelated top-level
  // `const` written below could mask a function-local vendor host.
  test("a name bound more than once is not treated as a constant", () => {
    const content =
      'const L = ["ski", "lls", ".md"];\n' +
      'export function f(o: any) {\n' +
      '  const apiHost = L.map((x) => x).join("");\n' +
      '  return o.apiUrl || `https://${apiHost}/api/v1`;\n' +
      '}\n' +
      'const apiHost = "example.com";\n' +
      'export const D = `https://${apiHost}/docs`;';
    expect(findDisallowedCodeUrls([{ file: "src/lib/remote-registry.ts", content }]).length).toBeGreaterThan(0);
  });

  // Stripping newlines is WHATWG parity for ONE url string. Applied to a whole
  // prose file it glued lines together: `https://skills.md` at end-of-line
  // became the host `skills.mdUse`, which matched nothing.
  test("a vendor URL at end-of-line in prose is still found", () => {
    // Checked in a packed prose file OTHER than README.md: README is where the
    // product default is documented (PRODUCT_DEFAULT_URL_EXCEPTION).
    for (const content of [
      "Hosted registry:\nhttps://skills.md\nUse `skills setup` next.\n",
      "SKILLS_API_URL=https://skills.md\nOTHER=1\n",
    ]) {
      expect(findVendorHostReferences([{ file: "docs/skill-standard.md", content }]).length).toBeGreaterThan(0);
    }
  });

  test("the vendor-domain check runs on folded values, not only raw literals", () => {
    // Splitting the domain itself across literals must not evade the
    // value-independent check.
    const findings = findDisallowedCodeUrls([
      { file: "skills/x/src/index.ts", content: 'const u = "https://" + "ski" + "lls" + ".md";' },
    ]);
    expect(findings.map((f) => f.kind)).toContain("vendor-domain-token");
  });

  test("comments and prose are not code — the scan reads string literals only", () => {
    const withComment = [
      { file: "a.ts", content: "// see https://not-approved.example for background\nconst x = 1;" },
    ];
    expect(findDisallowedCodeUrls(withComment)).toEqual([]);
  });

  test("no packed code file names a host outside APPROVED_CODE_HOSTS", () => {
    const sources = packedSources().filter((source) => isCodeFile(source.file));
    const findings = findDisallowedCodeUrls(sources);
    expect(findings.length === 0 ? "" : `\n${formatFindings(findings)}`).toBe("");
  }, 180_000);

  test("no packed file of any kind references a vendor-controlled host", () => {
    const sources = packedSources();
    const findings = findVendorHostReferences(sources);
    expect(findings.length === 0 ? "" : `\n${formatFindings(findings)}`).toBe("");
  }, 180_000);

  // ANTI-VACUITY, per entry point rather than as a global count.
  //
  // A threshold like "more than 100 files were scanned" is satisfiable by files
  // that have nothing to do with the code under test. On an unbuilt tree the
  // skill corpus alone cleared it — 471 files — while bin/, dist/ and therefore
  // everything in src/ they are built from went entirely unscanned, including
  // the two files this PR exists to fix. Coverage is now asserted against the
  // specific artifacts a consumer runs.
  //
  // Reported as "cannot run" rather than "failed" on an unbuilt local checkout —
  // see UNBUILT_LOCAL_TREE. Under CI it always runs, because CI builds first.
  test.skipIf(UNBUILT_LOCAL_TREE)("every declared entry point is packed, read and certified", () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    const entryPoints = declaredEntryPoints(manifest);
    expect(entryPoints.length, "package.json must declare entry points").toBeGreaterThan(0);

    const packed = getPackedFiles(process.cwd());
    const certified = new Map(
      packedSources()
        .filter((source) => isCodeFile(source.file) && !source.undecodable)
        .map((source) => [source.file, { certified: true }] as const),
    );
    const uncovered = uncoveredEntryPoints(checkEntryPointCoverage(manifest, packed, certified));
    expect(
      uncovered.length === 0
        ? ""
        : `\n  unscanned entry points (run \`bun run build\` first):\n` +
          uncovered.map((e) => `    ${e.path} packed=${e.packed} read=${e.read}`).join("\n"),
    ).toBe("");
  }, 180_000);

  // The invariant UNBUILT_LOCAL_TREE leans on, asserted rather than assumed.
  // Skipping the coverage check on an unbuilt local tree is only safe while CI
  // guarantees a built one; reordering the workflow would otherwise turn that
  // skip from "not applicable here" into "not checked anywhere", silently.
  test("CI builds before it tests", () => {
    const workflow = join(process.cwd(), ".github", "workflows", "ci.yml");
    expect(existsSync(workflow), `${workflow} must exist`).toBe(true);
    const lines = readFileSync(workflow, "utf8").split(/\r?\n/);
    const stepLine = (script: string) =>
      lines.findIndex((line) => new RegExp(`^\\s*run:\\s*bun run ${script}\\s*$`).test(line));
    const build = stepLine("build");
    const tests = stepLine("test");
    expect(build, "ci.yml must run `bun run build`").toBeGreaterThanOrEqual(0);
    expect(tests, "ci.yml must run `bun run test`").toBeGreaterThanOrEqual(0);
    expect(
      build < tests
        ? ""
        : `ci.yml runs \`bun run test\` (line ${tests + 1}) before \`bun run build\` (line ${build + 1}); ` +
          "the entry-point coverage check needs bin/ and dist/ to exist",
    ).toBe("");
  });

  // Defence in depth. The packed set contains src/ only after a build, via the
  // bundles. Scanning the tree directly means the check still has something to
  // say on an unbuilt checkout, and it is where a reviewer looks first.
  test("no file under src/ names a host outside APPROVED_CODE_HOSTS", () => {
    const root = join(process.cwd(), "src");
    const files = collectSourceFiles(root, /\.tsx?$/).filter((file) => !/\.test\.tsx?$/.test(file));
    expect(files.length, "src/ scan must not be empty").toBeGreaterThan(50);
    const sources = files.map((file) => ({
      file: file.replace(`${process.cwd()}/`, ""),
      content: readFileSync(file, "utf8"),
    }));
    const findings = findDisallowedCodeUrls(sources);
    expect(findings.length === 0 ? "" : `\n${formatFindings(findings)}`).toBe("");
  }, 120_000);
});

// This sole cross-boundary edge owns the launcher protocol/environment policy:
// exact historical serialization plus storage-name classification. It may not
// carry server deployment defaults, configuration, state or executable effects.
const LAUNCHER_POLICY_SOURCE = "src/cli/commands/runtime-launcher.ts";
const LAUNCHER_POLICY_MODULE = "../../server/launcher-environment-policy.js";

function pureLauncherPolicy(content: string): boolean {
  if (/https?:\/\//i.test(content)) return false;
  const diagnostics = ts.transpileModule(content, { reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ESNext } }).diagnostics ?? [];
  if (diagnostics.some(item => item.category === ts.DiagnosticCategory.Error)) return false;
  const source = ts.createSourceFile("launcher-environment-policy.ts", content, ts.ScriptTarget.Latest, true);
  if (source.statements.some(node => !ts.isVariableStatement(node) && !ts.isFunctionDeclaration(node))) return false;
  const declarations = new Set<string>(), arrays = new Set<string>(), sets = new Set<string>(), parameters = new Set<string>();
  let valid = true;
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node)) {
      if (!node.name || !ts.isIdentifier(node.name) || node.name.text === "Set") valid = false;
      else {
        declarations.add(node.name.text);
        if (ts.isParameter(node)) parameters.add(node.name.text);
        if (ts.isVariableDeclaration(node)) {
          if (!node.initializer) valid = false;
          const initializer = node.initializer && ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer;
          if (initializer && ts.isArrayLiteralExpression(initializer)) arrays.add(node.name.text);
          if (initializer && ts.isNewExpression(initializer) && ts.isIdentifier(initializer.expression)
            && initializer.expression.text === "Set") sets.add(node.name.text);
        }
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  // A deliberately restricted expression language. No assignments, mutation,
  // imports/reexports, ambient reads, loops, dynamic code, I/O or arbitrary calls.
  // V1's shell eval is inert string data here, not an executable JavaScript call.
  const allowed = new Set([
    ts.SyntaxKind.SourceFile, ts.SyntaxKind.EndOfFileToken, ts.SyntaxKind.VariableStatement,
    ts.SyntaxKind.VariableDeclarationList, ts.SyntaxKind.VariableDeclaration, ts.SyntaxKind.ExportKeyword,
    ts.SyntaxKind.Identifier, ts.SyntaxKind.StringLiteral, ts.SyntaxKind.ArrayLiteralExpression,
    ts.SyntaxKind.AsExpression, ts.SyntaxKind.TypeReference, ts.SyntaxKind.StringKeyword,
    ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.Parameter, ts.SyntaxKind.TypeLiteral,
    ts.SyntaxKind.PropertySignature, ts.SyntaxKind.Block, ts.SyntaxKind.ReturnStatement,
    ts.SyntaxKind.PropertyAccessExpression, ts.SyntaxKind.CallExpression, ts.SyntaxKind.NewExpression,
    ts.SyntaxKind.TemplateExpression, ts.SyntaxKind.TemplateSpan, ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail, ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.BooleanKeyword,
  ]);
  const check = (node: ts.Node) => {
    if (!allowed.has(node.kind)) valid = false;
    if (ts.isVariableDeclarationList(node) && !(node.flags & ts.NodeFlags.Const)) valid = false;
    if (ts.isIdentifier(node)) {
      const propertyName = (ts.isPropertyAccessExpression(node.parent) || ts.isPropertySignature(node.parent)) && node.parent.name === node;
      const constAssertion = ts.isTypeReferenceNode(node.parent) && node.text === "const";
      if (!propertyName && !constAssertion && node.text !== "Set" && !declarations.has(node.text)) valid = false;
    }
    if (ts.isPropertyAccessExpression(node)) {
      const receiver = node.expression;
      const join = node.name.text === "join" && (ts.isArrayLiteralExpression(receiver) || (ts.isIdentifier(receiver) && arrays.has(receiver.text)));
      const has = node.name.text === "has" && ts.isIdentifier(receiver) && sets.has(receiver.text);
      const pathField = ["runtime", "cwd", "entry"].includes(node.name.text) && ts.isIdentifier(receiver) && parameters.has(receiver.text);
      if (!join && !has && !pathField) valid = false;
    }
    if (ts.isCallExpression(node)) {
      if (!ts.isPropertyAccessExpression(node.expression) || !["join", "has"].includes(node.expression.name.text)
        || node.arguments.length !== 1) valid = false;
      else if (node.expression.name.text === "join" && !ts.isStringLiteral(node.arguments[0]!)) valid = false;
    }
    if (ts.isNewExpression(node)) {
      if (!ts.isIdentifier(node.expression) || node.expression.text !== "Set" || node.arguments?.length !== 1
        || !ts.isIdentifier(node.arguments[0]!) || !arrays.has(node.arguments[0]!.text)) valid = false;
    }
    ts.forEachChild(node, check);
  };
  check(source);
  return valid;
}

function clientServerImportLeaks(sources: Array<{ file: string; content: string }>, policy: string): string[] {
  const pure = pureLauncherPolicy(policy), leaks: string[] = [];
  for (const { file, content } of sources) {
    const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      let moduleEdge = false, specifier: ts.Node | undefined;
      if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)) {
        moduleEdge = true; specifier = node.moduleSpecifier;
      }
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        moduleEdge = true; specifier = node.moduleReference.expression;
      }
      if (ts.isImportTypeNode(node)) {
        moduleEdge = true;
        specifier = ts.isLiteralTypeNode(node.argument) ? node.argument.literal : node.argument;
      }
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require")
        || (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
          && node.expression.expression.text === "require" && node.expression.name.text === "resolve"))) {
        moduleEdge = true; specifier = node.arguments[0];
      }
      if (moduleEdge) {
        // Existing lazy CLI/MCP modules and Bun FFI use literal paths. Unknown
        // targets cannot prove the boundary: identifiers, concatenations and
        // interpolated templates are refused, including import-type arguments.
        if (!specifier || !ts.isStringLiteralLike(specifier)) leaks.push(`${file}: <unresolved module specifier>`);
        else {
          const path = specifier.text;
          if (/(^|\/)\.\.\/server\//.test(path) || path.includes("/src/server/")) {
            const exception = ts.isImportDeclaration(node) && file === LAUNCHER_POLICY_SOURCE && path === LAUNCHER_POLICY_MODULE && pure;
            if (!exception) leaks.push(`${file}: ${path}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return leaks;
}

describe("R1 — client does not depend on server deployment or configuration", () => {
  test("client imports forbid server modules except the verified pure launcher protocol/environment policy", () => {
    const policy = readFileSync(join(process.cwd(), "src/server/launcher-environment-policy.ts"), "utf8");
    expect(pureLauncherPolicy(policy)).toBe(true);
    const clientRoots = [join(process.cwd(), "src", "lib"), join(process.cwd(), "src", "cli")];
    const files = clientRoots.flatMap(root => existsSync(root) ? collectSourceFiles(root, /\.tsx?$/) : [])
      .filter(file => !/\.test\.tsx?$/.test(file));
    expect(files.length, "client source scan must not be empty").toBeGreaterThan(0);
    const sources = files.map(file => ({ file: file.replace(`${process.cwd()}/`, ""), content: readFileSync(file, "utf8") }));
    expect(clientServerImportLeaks(sources, policy)).toEqual([]);
  });

  test("the launcher policy exception is one exact static import edge", () => {
    const policy = readFileSync(join(process.cwd(), "src/server/launcher-environment-policy.ts"), "utf8");
    const content = `import { renderLegacyPinnedLauncher } from "${LAUNCHER_POLICY_MODULE}";`;
    expect(clientServerImportLeaks([{ file: LAUNCHER_POLICY_SOURCE, content }], policy)).toEqual([]);
    const rejected = [
      { file: "src/cli/other.ts", content },
      { file: LAUNCHER_POLICY_SOURCE, content: 'import { config } from "../../server/config.js";' },
      { file: LAUNCHER_POLICY_SOURCE, content: `export * from "${LAUNCHER_POLICY_MODULE}";` },
      { file: LAUNCHER_POLICY_SOURCE, content: `import("${LAUNCHER_POLICY_MODULE}");` },
      { file: LAUNCHER_POLICY_SOURCE, content: `require("${LAUNCHER_POLICY_MODULE}");` },
      { file: LAUNCHER_POLICY_SOURCE, content: `import policy = require("${LAUNCHER_POLICY_MODULE}");` },
      { file: LAUNCHER_POLICY_SOURCE, content: `type Policy = import("${LAUNCHER_POLICY_MODULE}").Policy;` },
      { file: LAUNCHER_POLICY_SOURCE, content: `require.resolve("${LAUNCHER_POLICY_MODULE}");` },
    ];
    for (const source of rejected) expect(clientServerImportLeaks([source], policy)).toHaveLength(1);
  });

  test("computed module edges fail closed while literal client runtime imports remain valid", () => {
    const policy = readFileSync(join(process.cwd(), "src/server/launcher-environment-policy.ts"), "utf8");
    const file = LAUNCHER_POLICY_SOURCE;
    for (const content of [
      'const serverPath = "../../server/config.js"; import(serverPath);',
      'const serverPath = "../../server/config.js"; require(serverPath);',
      'const serverPath = "../../server/config.js"; require.resolve(serverPath);',
      'import(`../../server/${name}.js`);', 'require(`../../server/${name}.js`);',
      'import("../../server/" + name);', 'require("../../server/" + name);',
      'type Server = import(serverPath).Config;', 'type Server = import(`../../server/${Name}.js`).Config;',
      'import();', 'require();',
    ]) expect(clientServerImportLeaks([{ file, content }], policy)).toEqual([`${file}: <unresolved module specifier>`]);
    // Provenance: CLI lazy commands, runtime-mcp's local MCP import, and native
    // agent/Codex FFI modules all use these statically reviewable target forms.
    for (const content of [
      'import("./commands/runtime.js");', 'import("../../mcp/index.js");',
      'require("bun:ffi");', 'type Pointer = import("bun:ffi").Pointer;',
      'export { local };',
    ]) expect(clientServerImportLeaks([{ file, content }], policy)).toEqual([]);
  });

  test("launcher policy imports, ambient reads, I/O, URLs and executable effects invalidate the exception", () => {
    const policy = readFileSync(join(process.cwd(), "src/server/launcher-environment-policy.ts"), "utf8");
    const content = `import { renderLegacyPinnedLauncher } from "${LAUNCHER_POLICY_MODULE}";`;
    for (const effect of [
      'import { config } from "./config.js";', 'export { config } from "./config.js";',
      'export const value = process.env.HOME;', 'export const value = globalThis.location;',
      'export const value = Bun.file("private");', 'readFileSync("private");',
      'export const endpoint = "https://server.example.test";', 'eval("true");',
      'new Function("return true")();', 'import("./config.js");', 'require("./config.js");',
      'import(serverPath);', 'require(serverPath);', 'type Config = import(serverPath).Config;',
      'import(`./${name}.js`);',
      'LEGACY_ENV_NAMES.push("UNREVIEWED");',
    ]) {
      const changed = `${policy}\n${effect}\n`;
      expect(pureLauncherPolicy(changed)).toBe(false);
      expect(clientServerImportLeaks([{ file: LAUNCHER_POLICY_SOURCE, content }], changed)).toHaveLength(1);
    }
  });
});
