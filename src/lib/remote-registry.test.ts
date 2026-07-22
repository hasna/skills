import { afterEach, describe, expect, test } from "bun:test";
import {
  buildSkillsApiUrl,
  getConfiguredApiUrl,
  loadRemoteRegistry,
  loadRemoteSkill,
  parseRemoteRegistryPayload,
  parseRemoteSkillPayload,
} from "./remote-registry.js";
import { getSkillToolDependencies } from "./tool-primitives.js";

describe("remote registry", () => {
  test("derives public identity and strips service-only prose and metadata", () => {
    const [skill] = parseRemoteRegistryPayload([{
      slug: "image",
      displayName: "Claude Code Provider Model",
      description: "OpenAI provider model routing cost USD $4 with margin settlement.",
      category: "Provider Routing Costs",
      tags: ["image", "claude-code", "provider-routing"],
      dependencies: ["safe-package", "openai-provider-runtime"],
      availability: { status: "available" },
      creditQuote: {
        tier: "premium",
        creditUnit: "image",
        credits: 4,
        formattedCredits: "4 credits/image",
        estimated: false,
        quoteDependsOnInput: false,
        quoteRequired: true,
        description: "Fixed credits per image.",
        provider: "private-provider",
      },
      provider: "private-provider",
      model: "private-model",
      routing: { id: "private-route" },
    }]);

    expect(skill).toMatchObject({
      name: "image",
      displayName: "Image",
      category: "Content Generation",
      tags: ["image", "generation", "ai", "credits"],
      dependencies: ["safe-package"],
      source: "remote",
    });
    expect(JSON.stringify(skill)).not.toMatch(
      /openai|claude|provider|model|routing|route|cost|margin|settlement|usd|\$/i,
    );
  });

  test("rejects remote catalog slugs that encode vendor or routing metadata", () => {
    expect(() => parseRemoteRegistryPayload([{
      name: "claude-code-provider-route",
      description: "hosted utility",
    }])).toThrow("prohibited execution metadata");
  });

  test("accepts legitimate router and modeling identities and canonicalizes nested service metadata", () => {
    const toolDependencies = getSkillToolDependencies("action-item-router");
    const [router, modeling] = parseRemoteRegistryPayload([{
      name: "action-item-router",
      description: "Claude3Opus routes action items.",
      category: "Project Management",
      tags: ["GPT4o"],
      availability: { status: "unavailable", code: "HOSTED_SERVICE_UNAVAILABLE", message: "Gemini2.5 failed" },
      toolDependencies,
      connectorRequirements: [{
        connector: "linear",
        scopes: ["issues:read"],
        operations: ["issues.list"],
        authType: "oauth",
        required: true,
        destructive: false,
        setupLabel: "Claude3Opus Linear route",
      }],
      connectorPreflight: [{
        connector: "linear",
        required: true,
        status: "missing",
        connected: false,
        scopes: ["issues:read"],
        missingScopes: ["issues:read"],
        operations: ["issues.list"],
        authType: "oauth",
        setupLabel: "Sora2 route",
        requiresAuth: true,
        accountId: null,
        profileName: null,
        reason: "Veo3 failed",
      }],
    }, {
      name: "financial-modeling",
      description: "Build route lists and compare a financial model.",
      category: "Finance & Compliance",
      tags: ["finance", "modeling"],
      availability: { status: "available" },
    }]);

    expect(router).toMatchObject({
      name: "action-item-router",
      displayName: "Action Item Router",
      toolDependencies,
      connectorRequirements: [{ setupLabel: "Connect Linear" }],
      connectorPreflight: [{ reason: "Connector account is not connected." }],
    });
    expect(modeling).toMatchObject({
      name: "financial-modeling",
      displayName: "Financial Modeling",
      description: "Financial Modeling is available through the selected service.",
      category: "Finance & Compliance",
      tags: ["remote"],
    });
    expect(JSON.stringify([router, modeling])).not.toMatch(/GPT4o|Claude3Opus|Gemini2\.5|Sora2|Veo3/i);
  });
  const originalSkillsApiUrl = process.env.SKILLS_API_URL;
  const originalSkillsMode = process.env.SKILLS_MODE;
  const originalSkillsApiKey = process.env.SKILLS_API_KEY;

  afterEach(() => {
    if (originalSkillsApiUrl === undefined) delete process.env.SKILLS_API_URL;
    else process.env.SKILLS_API_URL = originalSkillsApiUrl;
    if (originalSkillsMode === undefined) delete process.env.SKILLS_MODE;
    else process.env.SKILLS_MODE = originalSkillsMode;
    if (originalSkillsApiKey === undefined) delete process.env.SKILLS_API_KEY;
    else process.env.SKILLS_API_KEY = originalSkillsApiKey;
  });

  test("builds skills endpoint from self-hosted origin", () => {
    expect(buildSkillsApiUrl("https://operator.example")).toBe("https://operator.example/api/v1/skills");
  });

  test("builds skills endpoint from explicit API base", () => {
    expect(buildSkillsApiUrl("https://operator.example/api/v1/")).toBe("https://operator.example/api/v1/skills");
    expect(buildSkillsApiUrl("https://operator.example/api")).toBe("https://operator.example/api/v1/skills");
  });

  test("accepts an identical complete environment tuple", () => {
    process.env.SKILLS_MODE = "self-hosted";
    process.env.SKILLS_API_URL = "https://operator.example/api/v1";
    expect(getConfiguredApiUrl({ mode: "self-hosted", apiUrl: "https://operator.example" })).toBe("https://operator.example");
  });

  test("uses the complete config tuple", () => {
    delete process.env.SKILLS_API_URL;
    expect(getConfiguredApiUrl({ mode: "self-hosted", apiUrl: "https://config.example.com/api/v1/" })).toBe("https://config.example.com");
  });

  test("parses remote array payload", () => {
    const skills = parseRemoteRegistryPayload([
      {
        name: "remote-demo",
        description: "Remote demo",
        category: "Remote Tools",
        tags: ["remote", "demo"],
      },
    ]);

    expect(skills).toEqual([
      {
        name: "remote-demo",
        displayName: "Remote Demo",
        description: "Remote Demo is available through the selected service.",
        category: "Remote",
        tags: ["remote"],
        availability: {
          status: "unavailable",
          code: "REMOTE_CREDIT_QUOTE_MISSING",
          message: "Credit information is temporarily unavailable.",
          details: ["No credits were charged."],
        },
        source: "remote",
      },
    ]);
  });

  test("fails closed for premium remote skills when availability is omitted", () => {
    const skills = parseRemoteRegistryPayload([
      {
        name: "webcrawling",
        description: "Hosted web crawling",
        category: "Web & Browser",
        tags: ["web"],
      },
    ]);

    expect(skills[0]).toMatchObject({
      name: "webcrawling",
      availability: {
        status: "unavailable",
        code: "REMOTE_AVAILABILITY_MISSING",
      },
    });
    expect(skills[0].availability?.details).toContain("No credits were charged.");
  });

  test("sanitizes remote-provided availability text before exposing it", () => {
    const skills = parseRemoteRegistryPayload([
      {
        name: "image",
        description: "Hosted image generation",
        category: "Media Processing",
        tags: ["image"],
        availability: {
          status: "unavailable",
          code: "HOSTED_PROVIDER_UNAVAILABLE",
          message: "OpenAI Sora backend is not enabled",
          details: ["OPENAI_API_KEY is not configured", "No balance was charged."],
        },
      },
    ]);

    const serialized = JSON.stringify(skills[0].availability);
    expect(skills[0].availability).toMatchObject({
      status: "unavailable",
      message: "This skill is temporarily unavailable.",
    });
    expect(skills[0].availability).not.toHaveProperty("code");
    expect(serialized).not.toContain("OpenAI");
    expect(serialized).not.toContain("Sora");
    expect(serialized).not.toContain("OPENAI_API_KEY");
    expect(serialized).not.toContain("PROVIDER");
    expect(serialized).toContain("No credits were charged.");
  });

  test("redacts secret-shaped availability values before exposing them", () => {
    const platformKey = `sk-${"live_abcdefghijklmnopqrstuvwxyz"}`;
    const githubToken = `gh${"p_"}${"abcdefghijklmnopqrstuvwxyz"}`;
    const githubPatToken = `github${"_pat_"}${"abcdefghijklmnopqrstuvwxyz"}`;
    const githubSessionToken = `gh${"s_"}${"abcdefghijklmnopqrstuvwxyz"}`;
    const githubUserToken = `gh${"u_"}${"abcdefghijklmnopqrstuvwxyz"}`;
    const githubRefreshToken = `gh${"r_"}${"abcdefghijklmnopqrstuvwxyz"}`;
    const npmToken = `np${"m_"}${"abcdefghijklmnopqrstuvwxyz"}`;
    const awsKey = `AKI${"A"}${"ABCDEFGHIJKLMNOP"}`;
    const aiKey = `AIz${"a"}${"abcdefghijklmnopqrstuvwxyz"}`;
    const headerToken = `secret${"-token:"} abcdefghijklmnopqrstuvwxyz`;
    const ctxToken = `ctx7${"sk-"}${"abcdefghijklmnopqrstuvwxyz"}`;
    const xaiToken = `x${"ai-"}${"abcdefghijklmnopqrstuvwxyz"}`;

    const skills = parseRemoteRegistryPayload([
      {
        name: "image",
        description: "Hosted image generation",
        category: "Media Processing",
        tags: ["image"],
        availability: {
          status: "unavailable",
          message: `backend token ${platformKey} is disabled`,
          details: [
            `github token ${githubToken}`,
            `github fine-grained token ${githubPatToken}`,
            `github session token ${githubSessionToken}`,
            `github user token ${githubUserToken}`,
            `github refresh token ${githubRefreshToken}`,
            `npm token ${npmToken}`,
            `aws key ${awsKey}`,
            `ai key ${aiKey}`,
            `header ${headerToken}`,
            `context token ${ctxToken}`,
            `xai token ${xaiToken}`,
          ],
        },
      },
    ]);

    const serialized = JSON.stringify(skills[0].availability);
    for (const token of [
      platformKey,
      githubToken,
      githubPatToken,
      githubSessionToken,
      githubUserToken,
      githubRefreshToken,
      npmToken,
      awsKey,
      aiKey,
      headerToken,
      ctxToken,
      xaiToken,
    ]) {
      expect(serialized).not.toContain(token);
    }
    expect(serialized).toContain("This skill is temporarily unavailable.");
  });

  test("fails closed for legacy remote pricing without explicit credit metadata", () => {
    const skills = parseRemoteRegistryPayload({
      data: [
        {
          slug: "remote-video",
          displayName: "Remote Video",
          description: "Generate remote videos",
          category: "Media Processing",
          tags: ["video", "remote"],
          version: "1.2.3",
          pricing: {
            contractVersion: 1,
            tier: "premium",
            billingUnit: "second",
            costCents: 120,
            formattedCost: "$1.20 estimated",
            estimated: true,
            quoteDependsOnInput: true,
            quoteRequired: true,
            description: "Estimated by duration.",
          },
        },
      ],
    });

    expect(skills[0]).toMatchObject({
      name: "remote-video",
      displayName: "Remote Video",
      description: "Remote Video is available through the selected service.",
      category: "Media Processing",
      tags: ["remote"],
      version: "1.2.3",
      availability: {
        status: "unavailable",
        code: "REMOTE_CREDIT_QUOTE_MISSING",
      },
      source: "remote",
    });
    expect(JSON.stringify(skills[0])).not.toMatch(/pricing|Cents|billingUnit|formattedCost/);
  });

  test("loads remote registry with injected fetch implementation", async () => {
    const skills = await loadRemoteRegistry({
      apiUrl: "https://skills.example.com",
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe("https://skills.example.com/api/v1/skills");
        const headers = new Headers(init?.headers);
        expect(headers.get("x-skills-client-version")).toBe("0.2.0");
        expect(headers.get("x-skills-run-authorization")).toBe("signed-quote-v1");
        return Response.json({
          skills: [
            {
              name: "remote-image",
              displayName: "Remote Image",
              description: "Generate images remotely",
              category: "Media Processing",
              tags: ["image", "remote"],
            },
          ],
        });
      },
    });

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("remote-image");
    expect(skills[0].source).toBe("remote");
  });

  test("sends bearer auth when SKILLS_API_KEY is configured", async () => {
    process.env.SKILLS_MODE = "cloud";
    process.env.SKILLS_API_KEY = "fixture-registry";
    try {
      await loadRemoteRegistry({
        fetchImpl: async (_input, init) => {
          const headers = new Headers(init?.headers);
          expect(headers.get("accept")).toBe("application/json");
          expect(headers.get("authorization")).toBe("Bearer fixture-registry");
          expect(headers.get("x-skills-client-version")).toBe("0.2.0");
          expect(headers.get("x-skills-run-authorization")).toBe("signed-quote-v1");
          return Response.json([]);
        },
      });
    } finally {
      delete process.env.SKILLS_API_KEY;
      delete process.env.SKILLS_MODE;
    }
  });

  test("loads a single remote skill from the versioned detail endpoint", async () => {
    const skill = await loadRemoteSkill("remote-demo", {
      apiUrl: "https://skills.example.com/api/v1",
      authToken: "fixture-detail",
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe("https://skills.example.com/api/v1/skills/remote-demo");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-detail");
        return Response.json({
          slug: "remote-demo",
          displayName: "Remote Demo",
          description: "Demo from remote detail",
          category: "Remote Tools",
          tags: ["remote"],
          version: "0.2.0",
        });
      },
    });

    expect(skill).toMatchObject({
      name: "remote-demo",
      displayName: "Remote Demo",
      version: "0.2.0",
      source: "remote",
    });
  });

  test("reports remote registry HTTP failures clearly", async () => {
    await expect(loadRemoteRegistry({
      apiUrl: "https://skills.example.com/api/v1",
      fetchImpl: async () => new Response("nope", { status: 503, statusText: "Unavailable" }),
    })).rejects.toThrow("Remote registry request failed: 503 Unavailable");
  });

  test("reports invalid remote payloads with stable messages", () => {
    expect(() => parseRemoteRegistryPayload({ data: [{ displayName: "Missing slug" }] }))
      .toThrow("Remote registry payload did not match the expected skills contract");
    expect(() => parseRemoteSkillPayload({ skill: { displayName: "Missing slug" } }))
      .toThrow("Remote skill payload did not match the expected skills contract");
    expect(() => parseRemoteSkillPayload({
      skill: {
        slug: "incomplete-quote",
        creditQuote: { tier: "premium", creditUnit: "run", credits: 4, formattedCredits: "4 credits/run" },
      },
    })).toThrow("Remote skill payload did not match the expected skills contract");
  });
});
