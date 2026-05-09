import { afterEach, describe, expect, test } from "bun:test";
import {
  buildSkillsApiUrl,
  getConfiguredApiUrl,
  loadRemoteRegistry,
  parseRemoteRegistryPayload,
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
        name: "skill-remote-demo",
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
        source: "remote",
      },
    ]);
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
});
