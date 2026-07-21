import { afterEach, describe, expect, test } from "bun:test";
import { RemoteSkillsClient } from "./remote-client";

describe("remote skills client public contract", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("advertises client and run-authorization capabilities without requiring response negotiation", async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers) });
      return Response.json([]);
    }) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    await client.listSkills();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer fixture-key");
    expect(requests[0]?.headers.get("x-skills-client-version")).toBe("0.2.0");
    expect(requests[0]?.headers.get("x-skills-run-authorization")).toBe("signed-quote-v1");
  });

  test("drops legacy fiat aliases instead of returning invented SDK credits", async () => {
    globalThis.fetch = (async () => Response.json({
      contractVersion: 1,
      pricing: {
        tier: "premium",
        billingUnit: "run",
        costCents: 8,
        formattedCost: "$0.08/run",
        estimated: false,
        quoteDependsOnInput: false,
        quoteRequired: false,
        description: "Known v1 quote",
      },
      balanceCents: 400,
      formattedBalance: "400 credits",
      amountCents: -8,
      recentNetAmountCents: -16,
    })) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    const quote = await client.quoteSkill("demo");

    expect(quote).toEqual({ contractVersion: 1 });
    expect(JSON.stringify(quote)).not.toMatch(/pricing|Cents|billingUnit|formattedCost/);
  });

  test("redacts service execution metadata from artifact lists and execution-log downloads", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/artifacts")) {
        return Response.json([{
          id: "artifact-log",
          type: "execution_log",
          fileName: "execution_log.json",
          metadata: {
            provider: "private-provider",
            model: "private-model",
            providerCostCents: 7,
            userLabel: "Keep this user label",
          },
        }]);
      }
      return Response.json({
        event: "completed",
        provider: "private-provider",
        model: "private-model",
        costCents: 7,
        userPayload: {
          provider: "user-selected-provider",
          model: "user-selected-model",
          costCents: "user-authored field",
        },
        userMessage: "Keep this user-authored model comparison",
      }, { headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    const artifacts = await client.getRunArtifacts("run_123");
    expect(artifacts).toEqual([{
      id: "artifact-log",
      type: "execution_log",
      fileName: "execution_log.json",
      metadata: { userLabel: "Keep this user label" },
    }]);

    const download = await client.downloadRunArtifact("run_123", "artifact-log", artifacts[0]);
    const payload = await download.json();
    expect(payload).toEqual({
      event: "completed",
      userPayload: {
        provider: "user-selected-provider",
        model: "user-selected-model",
        costCents: "user-authored field",
      },
      userMessage: "Keep this user-authored model comparison",
    });
    expect(JSON.stringify(payload)).not.toMatch(/private-provider|private-model/);
    expect(payload).not.toHaveProperty("costCents");
  });

  test("sanitizes SDK run logs while preserving nested user-authored fields", async () => {
    globalThis.fetch = (async () => Response.json([{
      level: "info",
      provider: "private-provider",
      model: "private-model",
      costCents: 7,
      metadata: {
        providerCostCents: 7,
        route: "private-route",
        userLabel: "keep",
      },
      userPayload: {
        provider: "user-provider",
        model: "user-model",
      },
    }])) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    expect(await client.getRunLogs("run_123")).toEqual([{
      level: "info",
      metadata: { userLabel: "keep" },
      userPayload: { provider: "user-provider", model: "user-model" },
    }]);
  });

  test("fails closed for direct artifact downloads without trusted type metadata", async () => {
    globalThis.fetch = (async () => Response.json({
      provider: "private-provider",
      model: "private-model",
      costCents: 7,
    }, { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    const response = await client.downloadRunArtifact("run_123", "artifact-direct");
    expect(response.ok).toBe(false);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "ARTIFACT_TYPE_UNVERIFIED" });
  });
});
