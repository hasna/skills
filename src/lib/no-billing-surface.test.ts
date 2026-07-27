import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createMcpContractManifest, getMcpToolDescriptions } from "./mcp-contracts.js";
import { TOOL_PRIMITIVES } from "./tool-primitives.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

/**
 * Guard: the OSS product ships no billing / payments / credits / marketplace
 * surface. This asserts the banned command/word set is absent from the SHIPPED
 * SERIALIZED SURFACES an operator or agent actually sees — the CLI `--help`
 * output, the MCP contract JSON, and the server route table (the router source).
 *
 * Why not a raw source grep: the words legitimately appear elsewhere in the tree
 * for non-billing reasons — `git checkout` in comments, the `api-docs-portal`
 * skill, `-pack` skill names, Stripe *dependency detection* in skillinfo.ts, and
 * docs/tests that discuss the removed history. A grep over `src/**` would
 * false-positive on all of those. The serialized surfaces below enumerate
 * commands, tools, and routes — never the skill catalog or provider-detection
 * tables — so they are clean of those legitimate uses and a reappearance here is
 * unambiguous.
 *
 * Each banned token is matched on a word boundary so `credits` never matches
 * `credentials` and `checkout` never matches unrelated substrings. Bytes are read
 * with `readFileSync` (not `grep`), so a NUL byte cannot silently truncate a scan.
 */
const BANNED_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "billing", re: /\bbilling\b/i },
  { label: "credits", re: /\bcredits\b/i },
  { label: "buy-credits", re: /\bbuy[-\s]credits\b/i },
  { label: "checkout", re: /\bcheckout\b/i },
  { label: "portal", re: /\bportal\b/i },
  { label: "packs", re: /\bpacks\b/i },
  { label: "Stripe", re: /\bstripe\b/i },
  // plan-as-billing: a subscription/plan tier presented as something to pay for.
  { label: "subscription", re: /\bsubscription\b/i },
  { label: "pro plan", re: /\bpro plan\b/i },
];

function findBanned(surface: string): string[] {
  return BANNED_PATTERNS.filter(({ re }) => re.test(surface)).map(({ label }) => label);
}

function repoRoot(): string {
  return process.cwd();
}

function runCliHelp(args: string[]): string {
  const result = Bun.spawnSync(["bun", "run", "src/cli/index.tsx", "--", ...args], {
    cwd: repoRoot(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1", SKILLS_TEST_MODE: "1" },
  });
  return new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
}

// The `--help` trees an operator sees for the command groups that historically
// carried the billing surface (top-level groups, `auth` subcommands, `run` flags).
function cliHelpSurface(): string {
  return [
    runCliHelp(["--help"]),
    runCliHelp(["auth", "--help"]),
    runCliHelp(["run", "--help"]),
  ].join("\n");
}

function mcpContractSurface(): string {
  // The contract manifest + tool descriptions, plus the full tool-primitive
  // catalog that `get_tool_primitive` ships (its cliCommands/mcpTools/
  // capabilities are where "billing" and "skills billing status" once lived).
  return (
    JSON.stringify(createMcpContractManifest()) +
    JSON.stringify(getMcpToolDescriptions()) +
    JSON.stringify(TOOL_PRIMITIVES)
  );
}

function serverRouteSurface(): string {
  // The route table lives in the router. Read as bytes so a NUL byte cannot
  // truncate the scan the way `grep` would.
  return readFileSync(join(repoRoot(), "src", "server", "app.ts")).toString("utf8");
}

describe("no billing surface", () => {
  test("the scanner actually detects billing vocabulary (positive control)", () => {
    const decoy = "run `skills billing checkout`, `credits packs`, buy credits with Stripe on the pro plan via the customer portal (subscription)";
    const hits = findBanned(decoy);
    // Every banned token must be reachable, or a later green is meaningless.
    expect(hits.sort()).toEqual(
      ["Stripe", "billing", "buy-credits", "checkout", "credits", "packs", "portal", "pro plan", "subscription"].sort(),
    );
  });

  test("CLI --help exposes no billing/payments vocabulary", () => {
    const surface = cliHelpSurface();
    // Positive control: prove the surface was actually captured, so an empty
    // read cannot masquerade as a clean pass.
    expect(surface).toContain("auth");
    expect(surface).toContain("run");
    expect(surface.length).toBeGreaterThan(200);
    expect(findBanned(surface)).toEqual([]);
  }, 60000);

  test("MCP contract JSON exposes no billing/payments vocabulary", () => {
    const surface = mcpContractSurface();
    expect(surface).toContain("run_skill");
    expect(surface).toContain("hosted-auth");
    expect(surface).not.toContain("quote_skill");
    expect(findBanned(surface)).toEqual([]);
  });

  test("server route table exposes no billing/payments vocabulary", () => {
    const surface = serverRouteSurface();
    // Positive control: the router source was read and contains real routes.
    expect(surface).toContain("/api/");
    expect(surface).toContain("skills");
    expect(findBanned(surface)).toEqual([]);
  });
});
