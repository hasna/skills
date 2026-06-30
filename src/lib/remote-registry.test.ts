import { afterEach, describe, expect, test } from "bun:test";
import {
  buildSkillsApiUrl,
  getConfiguredApiUrl,
  loadRemoteRegistry,
  loadRemoteSkill,
  parseRemoteRegistryPayload,
  parseRemoteSkillPayload,
} from "./remote-registry.js";

describe("remote registry", () => {
  const originalSkillsApiUrl = process.env.SKILLS_API_URL;

  afterEach(() => {
    if (originalSkillsApiUrl === undefined) delete process.env.SKILLS_API_URL;
    else process.env.SKILLS_API_URL = originalSkillsApiUrl;
  });

  test("builds skills endpoint from SaaS origin", () => {
    expect(buildSkillsApiUrl("https://skills.md")).toBe("https://skills.md/api/v1/skills");
  });

  test("builds skills endpoint from explicit API base", () => {
    expect(buildSkillsApiUrl("https://skills.md/api/v1/")).toBe("https://skills.md/api/v1/skills");
    expect(buildSkillsApiUrl("http://localhost:3505/api")).toBe("http://localhost:3505/api/skills");
  });

  test("uses SKILLS_API_URL before config apiUrl", () => {
    process.env.SKILLS_API_URL = "https://env.example.com/api/v1";
    expect(getConfiguredApiUrl({ apiUrl: "https://config.example.com/api/v1" })).toBe("https://env.example.com/api/v1");
  });

  test("falls back to config apiUrl", () => {
    delete process.env.SKILLS_API_URL;
    expect(getConfiguredApiUrl({ apiUrl: "https://config.example.com/api/v1/" })).toBe("https://config.example.com/api/v1");
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
        description: "Remote demo",
        category: "Remote Tools",
        tags: ["remote", "demo"],
        dependencies: undefined,
        availability: { status: "available" },
        source: "remote",
      },
    ]);
  });

  test("decorates unavailable hosted skills when remote payload omits availability", () => {
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
        code: "HOSTED_PROVIDER_UNAVAILABLE",
      },
    });
    expect(skills[0].availability?.details).toContain("No balance was charged.");
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
      code: "HOSTED_PROVIDER_UNAVAILABLE",
      message: "hosted AI backend is not enabled",
    });
    expect(serialized).not.toContain("OpenAI");
    expect(serialized).not.toContain("Sora");
    expect(serialized).not.toContain("OPENAI_API_KEY");
    expect(serialized).toContain("No balance was charged.");
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
    expect(serialized).toContain("credential");
  });

  test("parses versioned remote skill metadata with pricing", () => {
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
      description: "Generate remote videos",
      category: "Media Processing",
      tags: ["video", "remote"],
      version: "1.2.3",
      pricing: {
        formattedCost: "$1.20 estimated",
        estimated: true,
      },
      source: "remote",
    });
  });

  test("loads remote registry with injected fetch implementation", async () => {
    const skills = await loadRemoteRegistry({
      apiUrl: "https://skills.example.com",
      fetchImpl: async (input) => {
        expect(String(input)).toBe("https://skills.example.com/api/v1/skills");
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
    process.env.SKILLS_API_URL = "https://skills.example.com/api/v1";
    process.env.SKILLS_API_KEY = "fixture-registry";
    try {
      await loadRemoteRegistry({
        fetchImpl: async (_input, init) => {
          const headers = new Headers(init?.headers);
          expect(headers.get("accept")).toBe("application/json");
          expect(headers.get("authorization")).toBe("Bearer fixture-registry");
          return Response.json([]);
        },
      });
    } finally {
      delete process.env.SKILLS_API_KEY;
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
  });
});
