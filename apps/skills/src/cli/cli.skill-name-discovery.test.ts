import { describe, expect, test } from "bun:test";
import { runCli, SLOW_TEST_TIMEOUT } from "./cli.test-utils.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

/**
 * Canonical name discovery on the introspection verbs (Agents Audit A27).
 *
 * A caller who names a procedure by the words at the end of its canonical slug
 * — `fleet-refresh` for `instructions-fleet-refresh` — must be told which name
 * the catalogue accepts. Two surfaces failed to do that on a hosted install:
 * `load` refused against the profile without naming the accepted form, and
 * `show`/`info` resolved its suggestion from the LOCAL corpus, so it printed
 * the transport sentence and no candidate at all.
 */
const CANONICAL = "instructions-fleet-refresh";

function catalogueServer() {
  return Bun.serve({
    port: 0,
    fetch: (request) => {
      const pathname = new URL(request.url).pathname;
      // The exact skill is absent; the catalogue that owns it is not.
      if (pathname === "/api/v1/skills/fleet-refresh") return new Response("missing", { status: 404, statusText: "Not Found" });
      if (pathname === "/api/v1/skills") {
        return Response.json({
          skills: [{ name: CANONICAL, displayName: "Instructions Fleet Refresh", description: "Roll out admitted Instructions updates.", category: "Development Tools", tags: ["instructions"] }],
        });
      }
      return new Response("not found", { status: 404, statusText: "Not Found" });
    },
  });
}

function hostedEnv(server: { port?: number }): Record<string, string> {
  return { SKILLS_API_URL: `http://localhost:${server.port}`, SKILLS_API_KEY: "fixture-hosted-key" };
}

describe("a shorter name still finds the canonical procedure", () => {
  for (const verb of ["show", "info"] as const) {
    test(`\`skills ${verb} fleet-refresh\` names the canonical slug instead of a transport error`, async () => {
      const server = catalogueServer();
      try {
        const { stdout, stderr, exitCode } = await runCli([verb, "fleet-refresh", "--json"], hostedEnv(server));
        expect(exitCode).not.toBe(0);
        const payload = JSON.parse(stdout);
        // The refusal is about a name, not about a transport, and it offers the
        // canonical name the catalogue actually holds.
        expect(payload.error).toBe("Skill 'fleet-refresh' not found");
        expect(payload.similar).toContain(CANONICAL);
        expect(stderr).not.toContain("Remote registry request failed");
      } finally {
        server.stop(true);
      }
    }, SLOW_TEST_TIMEOUT);

    test(`\`skills ${verb} fleet-refresh\` prints the canonical name as a suggestion`, async () => {
      const server = catalogueServer();
      try {
        const { stderr, exitCode } = await runCli([verb, "fleet-refresh"], hostedEnv(server));
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("not found");
        expect(stderr).toContain(`Did you mean: ${CANONICAL}?`);
      } finally {
        server.stop(true);
      }
    }, SLOW_TEST_TIMEOUT);
  }

  test("an unrelated name is still reported with no suggestion", async () => {
    const server = catalogueServer();
    try {
      const { stdout } = await runCli(["show", "zzzzq-unrelated", "--json"], hostedEnv(server));
      expect(JSON.parse(stdout)).toMatchObject({ error: "Skill 'zzzzq-unrelated' not found", similar: [] });
    } finally {
      server.stop(true);
    }
  }, SLOW_TEST_TIMEOUT);
});
