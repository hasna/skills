import { afterEach, describe, expect, test } from "bun:test";
import { RemoteSkillsClient } from "./remote-client";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

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
          id: "art_00000000000000000001",
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
        context: "provider=private-provider margin=8",
        message: "provider=private-provider model: private-model providerCostCents=7 cost_cents:9 fiat=$0.07 margin=4 settlement=internal-route routing_id=route-secret",
        detail: String.raw`{\"provider\":\"Azure \\\"Private\\\" OpenAI\",\"model\":{\"id\":\"private-model\"},\"routeId\":\"route-secret\"}`,
        reason: String.raw`{\\\"provider\\\":\\\"private-provider\\\"}`,
        logs: [{
          Message: "(provider=private-provider) [model:private-model] |routeId=route-secret",
          provider: "private-provider",
          model: "private-model",
          route: "route-secret",
          userPayload: { provider: "user-selected-provider", model: "user-selected-model" },
        }],
        diagnostics: {
          provider: "private-provider",
          margin: 4,
          providerCostCents: 7,
          attempts: [{
            model: "private-model",
            routeId: "route-secret",
            message: "Executed on Azure OpenAI GPT 5.6 for $0.07",
            userPayload: { provider: "user-selected-provider", model: "user-selected-model" },
          }],
        accounting: {
          routingId: "route-secret",
          settlementRef: "settlement-secret",
          fiatAmount: 0.07,
          providerRoute: "provider-route-secret",
          routeName: "route-name-secret",
          routingStrategy: "routing-strategy-secret",
          settlementRoutingId: "settlement-routing-secret",
          providerCostJPY: 11,
          currencyCode: "JPY",
          marginAmount: 3,
          userLabel: "keep",
        },
          raw: ["provider=private-provider model=private-model providerCostCents=9"],
        },
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
      id: "art_00000000000000000001",
      type: "execution_log",
      fileName: "execution_log.json",
      relativePath: "execution_log.json",
      name: "execution_log.json",
      contentType: "text/plain; charset=utf-8",
    }]);

    const download = await client.downloadRunArtifact("run_123", "art_00000000000000000001", artifacts[0]);
    const payload = await download.json();
    expect(payload).toEqual({
      event: "completed",
      context: "[redacted]",
      message: "[redacted]",
      detail: "[redacted]",
      reason: "[redacted]",
      logs: [{
        Message: "[redacted]",
        userPayload: { provider: "user-selected-provider", model: "user-selected-model" },
      }],
      diagnostics: {
        attempts: [{
          message: "[redacted]",
          userPayload: { provider: "user-selected-provider", model: "user-selected-model" },
        }],
        raw: ["[redacted]"],
      },
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
      Message: "(provider=Azure OpenAI) [model:GPT 5.6] |routeId=route-secret",
      Error: "providerCostCents=7 costCents: 9 fiat=$0.07 margin=4 settlement=internal-route routing=route-secret",
      Detail: "model=private-model",
      reason: "provider=Azure OpenAI model=GPT 5.6",
      details: "provider={\"name\":\"private-provider\",\"region\":\"internal\"}; route={\"id\":\"route-secret\"}",
      message: "Keep this ordinary user-authored provider and model comparison",
      diagnostics: [{
        provider: "private-provider",
        model: "private-model",
        providerCostCents: 7,
        message: "Executed on Azure OpenAI GPT 5.6 for $0.07",
        userPayload: {
          provider: "user-provider",
          model: "user-model",
          message: "Executed on user-selected provider and model for $0.07",
        },
      }, "provider=private-provider model=private-model providerCostCents=9", {
        status: "Ran using Azure OpenAI GPT-5.6 successfully",
      }],
      metadata: {
        providerCostCents: 7,
        route: "private-route",
        userLabel: "keep",
      },
      userPayload: {
        provider: "user-provider",
        model: "user-model",
        message: "provider=user-provider model=user-model",
      },
      userMessage: "Keep this user-authored provider and model comparison",
    }, {
      level: "info",
      message: "Compare model: logistic regression against baseline",
    }, {
      Message: "Diagnostic provider: Azure OpenAI GPT 5.6",
      Error: "Resolved Model: GPT 5.6",
      Detail: "Observed Provider Cost Cents: 7",
      details: "Diagnostic: provider: Azure OpenAI GPT 5.6",
      reason: "Resolved - Model: GPT 5.6",
      status: "Execution target: Azure OpenAI GPT 5.6",
      message: "providerRoute: provider-secret routeName=route-secret routingStrategy: secret settlementRoutingId=settlement-secret providerCostJPY=11 currencyCode: JPY marginAmount=3",
    }])) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    expect(await client.getRunLogs("run_123")).toEqual([{
      level: "info",
      Message: "[redacted]",
      Error: "[redacted]",
      Detail: "[redacted]",
      reason: "[redacted]",
      details: "[redacted]",
      message: "[redacted]",
      diagnostics: [{
        message: "[redacted]",
        userPayload: {
          provider: "user-provider",
          model: "user-model",
          message: "Executed on user-selected provider and model for $0.07",
        },
      }, "[redacted]", {
        status: "[redacted]",
      }],
      userPayload: {
        provider: "user-provider",
        model: "user-model",
        message: "provider=user-provider model=user-model",
      },
      userMessage: "Keep this user-authored provider and model comparison",
    }, {
      level: "info",
      message: "[redacted]",
    }, {
      Message: "[redacted]",
      Error: "[redacted]",
      Detail: "[redacted]",
      details: "[redacted]",
      reason: "[redacted]",
      status: "[redacted]",
      message: "[redacted]",
    }]);
  });

  test("sanitizes direct NDJSON execution-log downloads line by line", async () => {
    globalThis.fetch = (async () => new Response([
      JSON.stringify({ message: "provider=ndjson-provider model=ndjson-model" }),
      JSON.stringify({ status: "Ran using Azure OpenAI GPT-5.6 successfully" }),
      JSON.stringify("provider=ndjson-provider model=ndjson-model route=route-secret margin=4"),
      JSON.stringify({ userPayload: { provider: "user-provider", model: "user-model" } }),
      "",
    ].join("\n"), { headers: {
      "content-type": "application/x-ndjson",
      "x-skills-artifact-type": "execution_log",
    } })) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    const response = await client.downloadRunArtifact("run_123", "art_00000000000000000006", {
      id: "art_00000000000000000006",
      type: "execution_log",
    });

    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(await response.text()).toBe([
      JSON.stringify({ message: "[redacted]" }),
      JSON.stringify({ status: "[redacted]" }),
      JSON.stringify("[redacted]"),
      JSON.stringify({ userPayload: { provider: "user-provider", model: "user-model" } }),
      "",
    ].join("\n"));
  });

  test("fails closed for direct artifact downloads without trusted type metadata", async () => {
    globalThis.fetch = (async () => Response.json({
      provider: "private-provider",
      model: "private-model",
      costCents: 7,
    }, { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    const response = await client.downloadRunArtifact("run_123", "art_00000000000000000004");
    expect(response.ok).toBe(false);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "ARTIFACT_TYPE_UNVERIFIED" });
  });

  test("fails closed for weak artifact metadata that cannot classify the artifact", async () => {
    globalThis.fetch = (async () => Response.json({
      provider: "private-provider",
      model: "private-model",
    })) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    for (const artifact of [
      { id: "art_00000000000000000002", contentType: "application/json" },
      { id: "art_00000000000000000003", type: "debug" },
    ]) {
      const response = await client.downloadRunArtifact("run_123", artifact.id, artifact);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "ARTIFACT_TYPE_UNVERIFIED" });
    }
  });

  test("fails closed for malformed JSON and NDJSON execution-log downloads", async () => {
    const responses = [
      new Response('{"provider":"leaked-secret"', {
        headers: {
          "content-type": "application/json",
          "x-skills-artifact-type": "execution_log",
        },
      }),
      new Response([
        JSON.stringify({ message: "provider=private-provider" }),
        '{"model":"leaked-secret"',
      ].join("\n"), {
        headers: {
          "content-type": "application/x-ndjson",
          "x-skills-artifact-type": "execution_log",
        },
      }),
    ];
    globalThis.fetch = (async () => responses.shift()!) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    const jsonResponse = await client.downloadRunArtifact("run_123", "art_00000000000000000005", {
      id: "art_00000000000000000005",
      type: "execution_log",
    });
    expect(jsonResponse.status).toBe(422);
    const jsonBody = await jsonResponse.text();
    expect(jsonBody).toContain("ARTIFACT_CONTENT_UNSAFE");
    expect(jsonBody).not.toContain("leaked-secret");

    const ndjsonResponse = await client.downloadRunArtifact("run_123", "art_00000000000000000006", {
      id: "art_00000000000000000006",
      type: "execution_log",
    });
    expect(ndjsonResponse.status).toBe(200);
    expect(await ndjsonResponse.text()).toBe([
      JSON.stringify({ message: "[redacted]" }),
      JSON.stringify({ redacted: true }),
    ].join("\n"));
  });

  test("allowlists safe log fields and drops every table-driven metadata alias", async () => {
    const aliases = [
      "provider",
      "providerRoute",
      "routeName",
      "routingStrategy",
      "settlementRoutingId",
      "providerCostJPY",
      "currencyCode",
      "marginAmount",
      "unexpectedProviderModelRoutingCostField",
    ];
    const systemMetadata = Object.fromEntries(aliases.map((key) => [key, `${key}-secret`]));
    const systemMessages = aliases.map((key) => ({
      level: "warn",
      message: `${key}: ${key}-secret`,
    }));
    globalThis.fetch = (async () => Response.json([{
      ...systemMetadata,
      level: "info",
      status: "completed",
      createdAt: "2026-07-21T16:00:00.000Z",
      diagnostics: [{ ...systemMetadata }],
      userPayload: systemMetadata,
      userMessage: "Compare model: logistic regression against baseline",
    }, ...systemMessages, {
      level: "info",
      message: "generated 2 artifacts",
    }])) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    const logs = await client.getRunLogs("run_aliases");
    expect(logs[0]).toEqual({
      level: "info",
      status: "completed",
      createdAt: "2026-07-21T16:00:00.000Z",
      userPayload: systemMetadata,
      userMessage: "Compare model: logistic regression against baseline",
    });
    expect(logs.slice(1, -1)).toEqual(aliases.map(() => ({
      level: "warn",
      message: "[redacted]",
    })));
    expect(logs.at(-1)).toEqual({ level: "info", message: "[artifacts-generated]" });
  });

  test("trusts only exact canonical user-owned provenance keys", async () => {
    globalThis.fetch = (async () => Response.json([{
      userPayload: { provider: "user-provider", model: "user-model" },
      "u-s-e-r-p-a-y-l-o-a-d": { provider: "private-provider" },
      user_payload: { model: "private-model" },
      UserPayload: { route: "private-route" },
      "u s e r m e s s a g e": "private-message",
    }])) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    const logs = await client.getRunLogs("run_123");

    expect(logs).toEqual([{
      userPayload: { provider: "user-provider", model: "user-model" },
    }]);
    expect(JSON.stringify(logs)).not.toMatch(/private-provider|private-model|private-route|private-message/);
  });

  test("genericizes raw primitives, non-string messages, and secret-shaped identifiers", async () => {
    globalThis.fetch = (async () => Response.json([
      42,
      true,
      null,
      "provider=private-provider model=private-model",
      {
        id: "sk_live_secret_identifier",
        runId: "token-secret-run",
        artifactId: "api-key-secret",
        sequence: "3",
        durationMs: "4",
        progress: "100",
        success: "yes",
        message: 31337,
        error: false,
        detail: null,
        raw: [42, true, null, "route=private-route"],
      },
    ])) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    const logs = await client.getRunLogs("run_123");

    expect(logs).toEqual([
      "[redacted]",
      "[redacted]",
      "[redacted]",
      "[redacted]",
      {
        id: "[redacted]",
        runId: "[redacted]",
        artifactId: "[redacted]",
        message: "[redacted]",
        error: "[redacted]",
        detail: "[redacted]",
        raw: ["[redacted]", "[redacted]", "[redacted]", "[redacted]"],
      },
    ]);
    expect(JSON.stringify(logs)).not.toMatch(/sk_live|token-secret|api-key-secret|31337|private-route/);
  });

  test("exposes only concrete platform and self-hosted ID formats", async () => {
    const platformId = "123e4567-e89b-42d3-a456-426614174000";
    const selfHostedRunId = "run_mabc123_1234abcd";
    const selfHostedArtifactId = "art_0123456789abcdefabcd";
    const rejectedIds = [
      `run_glpat-${"a".repeat(24)}`,
      `artifact_rk_live_${"b".repeat(24)}`,
      `event_A${"Iza"}${"c".repeat(35)}`,
      `step_npm_${"d".repeat(36)}`,
      "run_customer_reference",
      "artifact-arbitrary-label",
    ];

    globalThis.fetch = (async () => Response.json([
      { id: platformId, runId: platformId, artifactId: platformId },
      { id: selfHostedRunId, runId: selfHostedRunId, artifactId: selfHostedArtifactId },
      ...rejectedIds.map((id) => ({ id, runId: id, artifactId: id })),
    ])) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    expect(await client.getRunLogs(selfHostedRunId)).toEqual([
      { id: platformId, runId: platformId, artifactId: platformId },
      { id: selfHostedRunId, runId: selfHostedRunId, artifactId: selfHostedArtifactId },
      ...rejectedIds.map(() => ({
        id: "[redacted]",
        runId: "[redacted]",
        artifactId: "[redacted]",
      })),
    ]);
  });

  test("accepts only strictly validated artifact descriptors", async () => {
    const sha256 = "a".repeat(64);
    const valid = {
      id: "123e4567-e89b-42d3-a456-426614174000",
      runId: "run_mabc123_1234abcd",
      type: "generated_output",
      fileName: "report.md",
      relativePath: "reports/report.md",
      name: "report.md",
      contentType: "text/markdown; charset=utf-8",
      byteSize: 42,
      sha256,
      createdAt: "2026-07-21T16:00:00.000Z",
    };
    const invalidDescriptors = [
      { ...valid, id: "sk_live_descriptor_secret" },
      { ...valid, id: "art_00000000000000000018", runId: "token-secret-run" },
      { ...valid, id: "art_00000000000000000019", fileName: "../private.txt" },
      { ...valid, id: "art_0000000000000000001a", relativePath: "../../private.txt" },
      { ...valid, id: "art_0000000000000000001b", name: "private/name.txt" },
      { ...valid, id: "art_0000000000000000001c", contentType: "text/plain\r\nx-private-route: secret" },
      { ...valid, id: "art_0000000000000000001d", byteSize: -1 },
      { ...valid, id: "art_0000000000000000001e", sha256: "not-a-sha" },
      { ...valid, id: "art_0000000000000000001f", createdAt: "next Tuesday" },
      { ...valid, id: "art_00000000000000000020", createdAt: "2026-02-31T16:00:00.000Z" },
      { id: "art_00000000000000000007", name: "report.md", contentType: "text/markdown" },
      42,
      null,
    ];
    globalThis.fetch = (async () => Response.json([valid, ...invalidDescriptors])) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    expect(await client.getRunArtifacts("run_123")).toEqual([valid]);
  });

  test("requires a prior cached generated-output descriptor and reconstructs a safe response envelope", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/artifacts")) {
        return Response.json([{
          id: "art_00000000000000000008",
          type: "generated_output",
          fileName: "report.md",
          relativePath: "report.md",
          contentType: "text/markdown",
        }]);
      }
      return new Response("# Customer report\n", {
        headers: {
          "content-type": "text/markdown",
          "content-disposition": "attachment; filename=report.md",
          "x-skills-artifact-type": "generated_output",
          "x-private-route": "route-secret",
        },
      });
    }) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    const untrusted = await client.downloadRunArtifact("run_123", "art_00000000000000000007", {
      id: "art_00000000000000000007",
      name: "report.md",
      contentType: "text/markdown",
    });
    expect(untrusted.status).toBe(422);
    expect(await untrusted.json()).toMatchObject({ code: "ARTIFACT_TYPE_UNVERIFIED" });

    expect(await client.getRunArtifacts("run_123")).toHaveLength(1);
    const generated = await client.downloadRunArtifact("run_123", "art_00000000000000000008");
    expect(generated.status).toBe(200);
    expect(generated.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(generated.headers.get("content-disposition")).toBe('attachment; filename="report.md"');
    expect(generated.headers.get("x-private-route")).toBeNull();
    expect(await generated.text()).toBe("# Customer report\n");
  });

  test("never authorizes a raw generated body from response headers without a prior artifact list", async () => {
    globalThis.fetch = (async () => new Response("private generated body", {
      headers: {
        "content-type": "text/markdown; charset=utf-8; private-route=route-secret",
        "content-disposition": "attachment; filename=report.md",
        "x-skills-artifact-type": "generated_output",
        "x-private-route": "route-secret",
      },
    })) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    const response = await client.downloadRunArtifact("run_123", "art_00000000000000000008");
    const body = await response.text();

    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(response.headers.get("x-private-route")).toBeNull();
    expect(body).toContain("ARTIFACT_TYPE_UNVERIFIED");
    expect(body).not.toContain("private generated body");
    expect(body).not.toContain("route-secret");
  });

  test("canonicalizes cached generated media types without reflecting arbitrary parameters", async () => {
    let listRequested = false;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/artifacts")) {
        listRequested = true;
        return Response.json([{
          id: "art_00000000000000000009",
          type: "generated_output",
          fileName: "report.md",
          contentType: 'Text/Markdown; private-route="route-secret"; charset=UTF-8',
        }, {
          id: "art_0000000000000000000a",
          type: "generated_output",
          fileName: "report.pdf",
          contentType: "APPLICATION/PDF; provider=private-provider",
        }, {
          id: "art_0000000000000000000b",
          type: "generated_output",
          fileName: "legacy.txt",
          contentType: "text/plain; charset=latin1",
        }, {
          id: "art_0000000000000000000c",
          type: "generated_output",
          fileName: "private.bin",
          contentType: "application/x-private-route; charset=utf-8",
        }]);
      }
      const id = path.split("/").at(-2);
      return new Response(id === "art_0000000000000000000a" ? "%PDF fixture" : "# Customer report\n", {
        headers: {
          "content-type": "application/octet-stream; private-route=route-secret",
          "content-disposition": 'attachment; filename="private-route-secret.bin"',
          "x-skills-artifact-type": "generated_output",
          "x-private-route": "route-secret",
        },
      });
    }) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    expect(await client.getRunArtifacts("run_123")).toEqual([{
      id: "art_00000000000000000009",
      type: "generated_output",
      fileName: "report.md",
      contentType: "text/markdown; charset=utf-8",
    }, {
      id: "art_0000000000000000000a",
      type: "generated_output",
      fileName: "report.pdf",
      contentType: "application/pdf",
    }]);
    expect(listRequested).toBe(true);

    const markdown = await client.downloadRunArtifact("run_123", "art_00000000000000000009");
    expect(markdown.status).toBe(200);
    expect(markdown.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(markdown.headers.get("content-disposition")).toBe('attachment; filename="report.md"');
    expect([...markdown.headers].join(" ")).not.toMatch(/private-route|route-secret|private-provider/i);

    const pdf = await client.downloadRunArtifact("run_123", "art_0000000000000000000a");
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toBe('attachment; filename="report.pdf"');
    expect([...pdf.headers].join(" ")).not.toMatch(/private-route|route-secret|private-provider/i);
  });

  test("genericizes non-success artifact responses without exposing body or headers", async () => {
    globalThis.fetch = (async () => Response.json({
      error: "provider private-provider failed on private-model",
      route: "route-secret",
    }, {
      status: 503,
      headers: { "x-private-route": "route-secret" },
    })) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    const response = await client.downloadRunArtifact("run_123", "art_00000000000000000008", {
      id: "art_00000000000000000008",
      type: "generated_output",
      fileName: "report.md",
      contentType: "text/markdown",
    });
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("x-private-route")).toBeNull();
    expect(JSON.parse(text)).toMatchObject({ code: "ARTIFACT_DOWNLOAD_FAILED" });
    expect(text).not.toMatch(/private-provider|private-model|route-secret/);
  });

  test("maps system prose to static messages instead of reflecting pattern matches", async () => {
    globalThis.fetch = (async () => Response.json([
      { level: "info", message: "starting self-hosted run sk-live-secret" },
      { level: "error", message: "remote token-secret failed" },
      { level: "info", message: "generated 999 artifacts" },
    ])) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    const logs = await client.getRunLogs("run_123");

    expect(logs).toEqual([
      { level: "info", message: "[redacted]" },
      { level: "error", message: "[redacted]" },
      { level: "info", message: "[artifacts-generated]" },
    ]);
    expect(JSON.stringify(logs)).not.toMatch(/sk-live-secret|token-secret|999/);
  });

  test("does not let caller-supplied descriptors override cached artifact classification", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/artifacts")) {
        return Response.json([{
          id: "art_0000000000000000000d",
          type: "execution_log",
          fileName: "private-provider-route.json",
          contentType: "application/json; profile=private-route",
        }]);
      }
      return Response.json({ provider: "private-provider", message: "private system message" });
    }) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    await client.getRunArtifacts("run_123");
    const response = await client.downloadRunArtifact("run_123", "art_0000000000000000000d", {
      id: "art_0000000000000000000d",
      type: "generated_output",
      fileName: "caller-report.md",
      contentType: "text/markdown",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="execution_log.json"');
    expect(await response.json()).toEqual({ message: "[redacted]" });
  });

  test("keeps cached artifact trust immutable when callers mutate returned descriptors", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/artifacts")) {
        return Response.json([{
          id: "art_0000000000000000000e",
          type: "execution_log",
          userPayload: { nested: { label: "customer value" } },
        }]);
      }
      return Response.json({ provider: "private-provider", message: "private system message" });
    }) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    const artifacts = await client.getRunArtifacts("run_123");
    (artifacts[0] as Record<string, unknown>).type = "generated_output";
    ((artifacts[0] as any).userPayload.nested as Record<string, unknown>).label = "mutated";

    const response = await client.downloadRunArtifact("run_123", "art_0000000000000000000e");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="execution_log.json"');
    expect(await response.json()).toEqual({ message: "[redacted]" });
  });

  test("drops every descriptor for duplicate artifact identifiers", async () => {
    globalThis.fetch = (async () => Response.json([{
      id: "art_0000000000000000000f",
      type: "execution_log",
    }, {
      id: "art_0000000000000000000f",
      type: "generated_output",
      fileName: "report.md",
      contentType: "text/markdown",
    }, {
      id: "art_00000000000000000010",
      type: "execution_log",
    }, {
      id: "art_00000000000000000010",
      type: "debug",
    }])) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    expect(await client.getRunArtifacts("run_123")).toEqual([]);
  });

  test("clears cached artifact trust after a non-success list response", async () => {
    let listCalls = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/artifacts")) {
        listCalls++;
        if (listCalls === 1) {
          return Response.json([{
            id: "art_00000000000000000011",
            type: "generated_output",
            fileName: "report.md",
            contentType: "text/markdown",
          }]);
        }
        return new Response("private provider route failed", {
          status: 503,
          headers: { "content-type": "text/plain; private-route=secret" },
        });
      }
      return new Response("private generated body");
    }) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    expect(await client.getRunArtifacts("run_123")).toHaveLength(1);
    expect(await client.getRunArtifacts("run_123")).toEqual([]);

    const response = await client.downloadRunArtifact("run_123", "art_00000000000000000011");
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "ARTIFACT_TYPE_UNVERIFIED" });
  });

  test("keeps the newest artifact list authoritative when an older request resolves last", async () => {
    const olderList = deferred<Response>();
    const newerList = deferred<Response>();
    let listCalls = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/artifacts")) {
        listCalls++;
        return listCalls === 1 ? olderList.promise : newerList.promise;
      }
      return Response.json({
        provider: "private-provider",
        message: "private system message",
      });
    }) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    const olderRequest = client.getRunArtifacts("run_123");
    const newerRequest = client.getRunArtifacts("run_123");

    newerList.resolve(Response.json([{
      id: "art_00000000000000000012",
      type: "execution_log",
    }]));
    expect(await newerRequest).toEqual([{
      id: "art_00000000000000000012",
      type: "execution_log",
      fileName: "execution_log.json",
      relativePath: "execution_log.json",
      name: "execution_log.json",
      contentType: "text/plain; charset=utf-8",
    }]);

    olderList.resolve(Response.json([{
      id: "art_00000000000000000012",
      type: "generated_output",
      fileName: "report.json",
      contentType: "application/json",
    }]));
    expect(await olderRequest).toEqual([]);

    const response = await client.downloadRunArtifact("run_123", "art_00000000000000000012");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "[redacted]" });
  });

  test("keeps the newest failed artifact list authoritative over an older success", async () => {
    const olderList = deferred<Response>();
    let listCalls = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/artifacts")) {
        listCalls++;
        return listCalls === 1
          ? olderList.promise
          : new Response("private provider route failed", { status: 503 });
      }
      return new Response("private generated body");
    }) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    const olderRequest = client.getRunArtifacts("run_123");
    expect(await client.getRunArtifacts("run_123")).toEqual([]);

    olderList.resolve(Response.json([{
      id: "art_00000000000000000011",
      type: "generated_output",
      fileName: "report.md",
      contentType: "text/markdown",
    }]));
    expect(await olderRequest).toEqual([]);

    const response = await client.downloadRunArtifact("run_123", "art_00000000000000000011");
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "ARTIFACT_TYPE_UNVERIFIED" });
  });

  test("fails closed when artifact trust changes while a download is in flight", async () => {
    const download = deferred<Response>();
    let listCalls = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/artifacts")) {
        listCalls++;
        return Response.json([listCalls === 1 ? {
          id: "art_00000000000000000012",
          type: "generated_output",
          fileName: "report.md",
          contentType: "text/markdown",
        } : {
          id: "art_00000000000000000012",
          type: "execution_log",
        }]);
      }
      return download.promise;
    }) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    await client.getRunArtifacts("run_123");
    const inFlight = client.downloadRunArtifact("run_123", "art_00000000000000000012");
    await client.getRunArtifacts("run_123");
    download.resolve(new Response("private generated body", {
      headers: { "content-type": "text/markdown" },
    }));

    const response = await inFlight;
    const body = await response.text();
    expect(response.status).toBe(422);
    expect(body).toContain("ARTIFACT_TYPE_UNVERIFIED");
    expect(body).not.toContain("private generated body");
  });

  test("downloads a generated artifact when its trust snapshot remains current", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/artifacts")) {
        return Response.json([{
          id: "art_00000000000000000013",
          type: "generated_output",
          fileName: "report.md",
          contentType: "text/markdown",
        }]);
      }
      return new Response("# Customer report\n", {
        headers: { "content-type": "text/markdown" },
      });
    }) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    await client.getRunArtifacts("run_123");
    const response = await client.downloadRunArtifact("run_123", "art_00000000000000000013");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="report.md"');
    expect(await response.text()).toBe("# Customer report\n");
  });

  test("requires an explicit exact generated_output type in artifact lists", async () => {
    const generatedFields = {
      runId: "run_123",
      fileName: "report.md",
      relativePath: "report.md",
      contentType: "text/markdown",
      byteSize: 42,
      sha256: "a".repeat(64),
      createdAt: "2026-07-21T16:00:00.000Z",
    };
    globalThis.fetch = (async () => Response.json([{
      id: "art_00000000000000000014",
      ...generatedFields,
    }, {
      id: "art_00000000000000000015",
      artifactType: "generated_output",
      ...generatedFields,
    }, {
      id: "art_00000000000000000016",
      type: "generated-output",
      ...generatedFields,
    }])) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    expect(await client.getRunArtifacts("run_123")).toEqual([]);
  });

  test("canonicalizes execution-log metadata and response headers", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/artifacts")) {
        return Response.json([{
          id: "art_00000000000000000017",
          type: "execution_log",
          fileName: "private-provider.json",
          relativePath: "private/route/private-provider.json",
          name: "private-model.json",
          contentType: 'application/json; profile="private-route"; charset=latin1',
        }]);
      }
      return Response.json({ message: "private provider message" }, {
        headers: {
          "content-type": 'application/json; profile="private-route"; charset=latin1',
          "content-disposition": 'attachment; filename="private-provider.json"',
        },
      });
    }) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    expect(await client.getRunArtifacts("run_123")).toEqual([{
      id: "art_00000000000000000017",
      type: "execution_log",
      fileName: "execution_log.json",
      relativePath: "execution_log.json",
      name: "execution_log.json",
      contentType: "application/json; charset=utf-8",
    }]);

    const response = await client.downloadRunArtifact("run_123", "art_00000000000000000017");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="execution_log.json"');
    expect(await response.json()).toEqual({ message: "[redacted]" });
  });

  test("drops identifiers containing recognizable synthetic credential shapes", async () => {
    const githubShape = `artifact-ghp_${"a".repeat(36)}`;
    const githubFineGrainedShape = `artifact-github_pat_${"b".repeat(82)}`;
    const slackShape = `artifact-xoxb-111111111111-222222222222-${"c".repeat(24)}`;
    const awsShape = `artifact-AKIA${"D".repeat(16)}`;
    globalThis.fetch = (async () => Response.json([
      githubShape,
      githubFineGrainedShape,
      slackShape,
      awsShape,
    ].map((id) => ({ id, type: "execution_log" })))) as unknown as typeof fetch;

    const client = new RemoteSkillsClient("fixture-key", "https://operator.example");
    expect(await client.getRunArtifacts("run_123")).toEqual([]);
  });
});
