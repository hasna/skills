import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { RemoteSkillsClient } from "./remote-client.js";
import { pullSkills } from "./pull.js";
import { getPortableSkillsRoot } from "./portable-skills.js";
import { clearRegistryCache, loadRegistryProfile } from "./registry.js";
import { createSkillsFetchHandler } from "../server/app.js";
import { handleMcpHttpNodeRequest } from "../mcp/http.js";
import { resolveStoreBackends } from "../server/store-fixtures.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

/**
 * The whole loop, over real HTTP: publish a skill to an instance, pull it into this
 * process's corpus, then prove it surfaces on BOTH agent-facing surfaces — the CLI's
 * registry (`loadRegistryProfile("all")`, what `skills list --all` prints) and the MCP
 * `list_skills` tool. Both read the same process-env corpus, so no subprocess or custom
 * $HOME is needed: the hermetic preload already points $HASNA_SKILLS_DIR at a throwaway.
 */
const backends = await resolveStoreBackends();
const memory = backends.find((backend) => backend.name === "memory");
if (!memory) throw new Error("memory store backend unavailable");

const TOKEN = "sk_test_pull_org";
const PRINCIPAL = {
  orgId: "org_pull",
  orgSlug: "org-pull",
  orgName: "Org Pull",
  userId: "user_pull",
  email: "pull@example.com",
  apiKeyId: "key_pull",
};

const SKILL_MD =
  "---\nname: pulled-team-runbook\ndescription: The team deploy runbook\nkind: instruction\ncategory: Development Tools\ntags:\n  - ops\n---\n\n# Pulled Team Runbook\n\nStep one. Step two.\n";

async function startInstance() {
  const fixture = await memory!.create([{ token: TOKEN, principal: PRINCIPAL }]);
  const fetch = await createSkillsFetchHandler({
    store: fixture.store,
    config: { inlineWorker: false, allowEphemeralStore: fixture.allowEphemeralStore },
  });
  const server = Bun.serve({ port: 0, fetch });
  return {
    client: new RemoteSkillsClient(TOKEN, `http://127.0.0.1:${server.port}`),
    async stop() {
      server.stop(true);
      await fixture.close();
    },
  };
}

async function startMcpHttp() {
  const httpServer = createServer(async (req, res) => {
    const handled = await handleMcpHttpNodeRequest(req, res);
    if (!handled) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async stop() {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

async function mcpListSkillsText(baseUrl: string): Promise<string> {
  await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
    }),
  });
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_skills", arguments: { profile: "all", limit: 1000 } },
    }),
  });
  expect(response.status).toBe(200);
  return response.text();
}

describe("skills pull (end to end)", () => {
  test("publishing then pulling surfaces the skill on both the CLI registry and MCP list_skills", async () => {
    const instance = await startInstance();
    try {
      const publishResponse = await instance.client.publishSkill({
        slug: "pulled-team-runbook",
        displayName: "Pulled Team Runbook",
        description: "The team deploy runbook",
        category: "Development Tools",
        tags: ["ops"],
        kind: "instruction",
        version: "1.0.0",
        source: "custom",
        skillMd: SKILL_MD,
      });
      expect(publishResponse.ok).toBe(true);

      // Pull into this process's corpus (the hermetic $HASNA_SKILLS_DIR).
      const { results } = await pullSkills({ names: ["pulled-team-runbook"], client: instance.client });
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].kind).toBe("instruction");

      // The SKILL.md round-trips verbatim from the instance into the corpus.
      const corpusMd = readFileSync(join(getPortableSkillsRoot(), "pulled-team-runbook", "SKILL.md"), "utf-8");
      expect(corpusMd).toBe(SKILL_MD);

      // Surface 1 — the CLI registry (`skills list --all`).
      clearRegistryCache();
      const all = loadRegistryProfile("all");
      expect(all.some((skill) => skill.name === "pulled-team-runbook")).toBe(true);

      // Surface 2 — the MCP `list_skills` tool, in-process, reading the same corpus.
      const mcp = await startMcpHttp();
      try {
        const listText = await mcpListSkillsText(mcp.baseUrl);
        expect(listText).toContain("pulled-team-runbook");
      } finally {
        await mcp.stop();
      }
    } finally {
      await instance.stop();
    }
  });
});
