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
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MissingApiUrlError, requireApiUrl, resolveApiUrl } from "./api-url.js";
import { getPackedFiles } from "./packlist.js";
import { getConfiguredApiUrl } from "./remote-registry.js";
import {
  APPROVED_CODE_HOSTS,
  VENDOR_CONTROLLED_DOMAINS,
  VENDOR_HOST_URL_EXCEPTIONS,
  extractUrlReferences,
  findCodeUrlLiterals,
  findDisallowedCodeUrls,
  findVendorHostReferences,
  formatFindings,
  isCodeFile,
  isVendorControlledHost,
  readPackedSources,
  registrableDomain,
} from "./vendor-host-guard.js";

/**
 * Every client-side resolver that can turn configuration into a URL the CLI
 * would contact. `kind` records the contract each one owes when nothing is
 * configured:
 *
 *   "closed" — read paths degrade to the bundled local registry, so they return
 *              undefined and the CLI keeps working offline.
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
    resolve: (env) => resolveApiUrl({}, env),
  },
  {
    name: "getConfiguredApiUrl",
    module: "src/lib/remote-registry.ts",
    kind: "closed",
    resolve: (env) => getConfiguredApiUrl({}, env),
  },
  {
    name: "requireApiUrl",
    module: "src/lib/api-url.ts",
    kind: "loud",
    resolve: (env) => requireApiUrl("Auth", {}, env),
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

describe("R1 — unconfigured client produces no endpoint", () => {
  test("resolver inventory is non-empty and covers both fail modes", () => {
    // Without this, deleting every resolver would make the suite below pass
    // vacuously — the failure mode the policy calls out explicitly.
    expect(CLIENT_ENDPOINT_RESOLVERS.length).toBeGreaterThan(0);
    expect(CLIENT_ENDPOINT_RESOLVERS.some((r) => r.kind === "closed")).toBe(true);
    expect(CLIENT_ENDPOINT_RESOLVERS.some((r) => r.kind === "loud")).toBe(true);
  });

  test("read paths yield no URL at all with empty env and empty config", () => {
    for (const resolver of CLIENT_ENDPOINT_RESOLVERS.filter((r) => r.kind === "closed")) {
      expect(resolver.resolve(emptyEnv()), `${resolver.module} ${resolver.name}`).toBeUndefined();
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
      expect(message).toContain("skills setup --mode self-hosted --api-url");
      // ...and it must not smuggle a usable endpoint into the "error".
      expect(extractUrlReferences(message)).toEqual([]);
    }
  });

  test("a configured URL is still honoured — the guard bans defaults, not endpoints", () => {
    const configured = { SKILLS_API_URL: "https://skills.internal.example/api/v1/" };
    expect(resolveApiUrl({}, configured)).toBe("https://skills.internal.example/api/v1");
    expect(requireApiUrl("Auth", {}, configured)).toBe("https://skills.internal.example/api/v1");
    expect(resolveApiUrl({ apiUrl: "https://from-config.example" }, {})).toBe(
      "https://from-config.example",
    );
  });

  test("the CLI's own auth command reaches no host when nothing is configured", async () => {
    const home = mkdtempSync(join(tmpdir(), "skills-r1-unconfigured-"));
    try {
      const result = Bun.spawnSync(
        ["bun", "run", join(process.cwd(), "src/cli/index.tsx"), "auth", "login", "--email", "someone@example.com", "--json"],
        {
          cwd: home,
          // Deliberately empty: no SKILLS_API_URL, no SKILLS_API_KEY, fresh HOME.
          env: { PATH: process.env.PATH ?? "", HOME: home, NO_COLOR: "1", SKILLS_TEST_MODE: "1" },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
      expect(output).toContain("SKILLS_API_URL");
      expect(output).toContain("MISSING_API_URL");
      expect(result.exitCode).not.toBe(0);
      // No host is named anywhere in the failure — not a vendor host, not localhost.
      for (const reference of extractUrlReferences(output)) {
        expect(isVendorControlledHost(reference.host), `${reference.url} is vendor-controlled`).toBe(false);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);
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
  test("the approved-host list cannot be used to smuggle a vendor host back in", () => {
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
      expect(exception.url).toMatch(/^https?:\/\/[^\s]+\/[^\s]+/);
      expect(exception.reason.length).toBeGreaterThan(20);
      expect(isVendorControlledHost(exception.url.split("/")[2])).toBe(true);
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
    expect(findings.map((f) => f.file).sort()).toEqual([
      "src/lib/remote-client.ts",
      "src/server/config.ts",
    ]);
    expect(findings.find((f) => f.file === "src/lib/remote-client.ts")?.position).toBe("parameter default");
    // The second case is caught without anyone classifying its host as ours.
    expect(
      findings.some((f) => !VENDOR_CONTROLLED_DOMAINS.includes(registrableDomain(f.host))),
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
    expect(vendor.length).toBe(1);
    expect(vendor[0].vendor).toBe(true);
    expect(vendor[0].position).toBe("object property");

    // An unapproved third party is also rejected: "third-party" is not a
    // blanket pass, it is a reviewed entry in APPROVED_CODE_HOSTS.
    const unreviewed = findDisallowedCodeUrls([
      { file: "skills/whatever/src/config.ts", content: asObjectProperty("some-unreviewed-provider.io") },
    ]);
    expect(unreviewed.length).toBe(1);
    expect(unreviewed[0].vendor).toBe(false);
  });

  test("comments and prose are not code — the scan reads string literals only", () => {
    const withComment = [
      { file: "a.ts", content: "// see https://not-approved.example for background\nconst x = 1;" },
    ];
    expect(findDisallowedCodeUrls(withComment)).toEqual([]);
  });

  test("no packed code file names a host outside APPROVED_CODE_HOSTS", () => {
    const sources = packedSources().filter((source) => isCodeFile(source.file));
    // Anti-vacuity: deleting the code would otherwise make this pass silently.
    expect(sources.length, "packed code scan must not be empty").toBeGreaterThan(100);
    const findings = findDisallowedCodeUrls(sources);
    expect(findings.length === 0 ? "" : `\n${formatFindings(findings)}`).toBe("");
  }, 180_000);

  test("no packed file of any kind references a vendor-controlled host", () => {
    const sources = packedSources();
    expect(sources.length, "packed file scan must not be empty").toBeGreaterThan(100);
    const findings = findVendorHostReferences(sources);
    expect(findings.length === 0 ? "" : `\n${formatFindings(findings)}`).toBe("");
  }, 180_000);
});

describe("R1 — client does not depend on the server module", () => {
  test("nothing under src/lib or src/cli imports from src/server", () => {
    // The vendor default reached the CLI because a client module imported a
    // server constant. Keeping that edge deleted keeps server-side deployment
    // decisions out of the client's fail-closed paths.
    const clientRoots = [join(process.cwd(), "src", "lib"), join(process.cwd(), "src", "cli")];
    const files = clientRoots.flatMap((root) =>
      existsSync(root) ? collectSourceFiles(root, /\.tsx?$/) : [],
    );
    expect(files.length, "client source scan must not be empty").toBeGreaterThan(0);

    const leaks: string[] = [];
    for (const file of files) {
      if (/\.test\.tsx?$/.test(file)) continue;
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(/from\s+["']([^"']+)["']/g)) {
        const specifier = match[1];
        if (/(^|\/)\.\.\/server\//.test(specifier) || specifier.includes("/src/server/")) {
          leaks.push(`${file.replace(`${process.cwd()}/`, "")}: ${specifier}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });
});
