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
  ENDPOINT_DEFAULT_ALLOWED_DOMAINS,
  VENDOR_CONTROLLED_DOMAINS,
  VENDOR_HOST_URL_EXCEPTIONS,
  extractUrlReferences,
  findEndpointDefaults,
  findVendorHostReferences,
  formatFindings,
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

describe("R1 — the published package ships no endpoint defaults", () => {
  test("the allowlist cannot be used to smuggle a vendor host back in", () => {
    for (const domain of ENDPOINT_DEFAULT_ALLOWED_DOMAINS) {
      expect(VENDOR_CONTROLLED_DOMAINS, `${domain} may not be allowlisted`).not.toContain(domain);
      expect(isVendorControlledHost(domain)).toBe(false);
    }
    // The documented exceptions are exact URLs, never bare domains, so an
    // endpoint on an excepted domain is still a failure.
    for (const exception of VENDOR_HOST_URL_EXCEPTIONS) {
      expect(exception.url).toMatch(/^https?:\/\/[^\s]+\/[^\s]+/);
      expect(exception.reason.length).toBeGreaterThan(20);
    }
  });

  test("the scanners actually fire on a reintroduced default", () => {
    // Anti-vacuity: prove the detectors are wired before trusting their silence.
    const relapse = [
      {
        file: "src/server/config.ts",
        content: 'export const DEFAULT_SELF_HOSTED_API_URL = "https://skills.md";',
      },
      {
        file: "skills/_common/http-client.ts",
        content:
          'const SKILL_API_URL = process.env.SKILLS_API_URL || process.env.SKILL_API_URL || "https://some-other-vendor.example/api/v1";',
      },
    ];
    const defaults = findEndpointDefaults(relapse);
    expect(defaults.map((f) => f.file).sort()).toEqual([
      "skills/_common/http-client.ts",
      "src/server/config.ts",
    ]);
    // The second case names a host nobody has denylisted — the domain-agnostic
    // half of the guard is what catches it.
    expect(defaults.some((f) => !VENDOR_CONTROLLED_DOMAINS.includes(registrableDomain(f.host)))).toBe(true);
    expect(findVendorHostReferences(relapse).length).toBeGreaterThan(0);
  });

  test("no packed file hard-codes a network endpoint default", () => {
    const sources = packedSources();
    expect(sources.length, "packed file scan must not be empty").toBeGreaterThan(100);
    const findings = findEndpointDefaults(sources);
    expect(findings.length === 0 ? "" : `\n${formatFindings(findings)}`).toBe("");
  }, 120_000);

  test("no packed file references a vendor-controlled host", () => {
    const sources = packedSources();
    expect(sources.length, "packed file scan must not be empty").toBeGreaterThan(100);
    const findings = findVendorHostReferences(sources);
    expect(findings.length === 0 ? "" : `\n${formatFindings(findings)}`).toBe("");
  }, 120_000);
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
