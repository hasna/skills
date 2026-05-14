import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  createMcpContractManifest,
  createSkillMcpMetadata,
  describeMcpToolContracts,
  getMcpResourceContracts,
  listMcpToolContracts,
} from "./mcp-contracts.js";
import { getSkill } from "./registry.js";

const fixturePath = join(import.meta.dir, "fixtures", "mcp-contract-manifest-basic.v1.json");

describe("MCP contract manifest", () => {
  test("matches the stable compatibility fixture", () => {
    const manifest = createMcpContractManifest();
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const selectedTools = new Set<string>(fixture.toolNames);
    const selectedContractNames = new Set<string>(Object.keys(fixture.contracts));
    const selectedContracts = Object.fromEntries(
      manifest.tools
        .filter((tool) => selectedContractNames.has(tool.name))
        .map((tool) => [
          tool.name,
          {
            category: tool.category,
            sideEffects: tool.sideEffects,
            required: tool.inputSchema.required ?? [],
            properties: Object.keys(tool.inputSchema.properties ?? {}).sort(),
          },
        ]),
    );

    expect({
      schemaVersion: manifest.schemaVersion,
      toolNames: manifest.tools
        .map((tool) => tool.name)
        .filter((name) => selectedTools.has(name))
        .sort(),
      resourceUris: manifest.resources.map((resource) => resource.uri).sort(),
      contracts: selectedContracts,
    }).toEqual(fixture);
  });

  test("exposes generic install, run, and validation contracts without SaaS assumptions", () => {
    const contracts = listMcpToolContracts();
    const byName = new Map(contracts.map((tool) => [tool.name, tool]));

    expect(byName.get("pin_skill")?.inputSchema.properties?.name).toMatchObject({
      type: "string",
      description: expect.stringContaining("skill"),
    });
    expect(byName.get("run_skill")?.inputSchema.properties).toMatchObject({
      name: { type: "string", description: expect.any(String) },
      input: { type: "object", additionalProperties: true },
      args: { type: "array", items: { type: "string" } },
    });
    expect(byName.get("validate_skill")?.outputSchema.properties).toHaveProperty("issues");

    const serialized = JSON.stringify(contracts);
    expect(serialized).not.toContain("Stripe");
    expect(serialized).not.toContain("tenant");
    expect(serialized).not.toContain("skills.md");
  });

  test("describes known and unknown tools deterministically", () => {
    const tools = describeMcpToolContracts(["validate_skill", "missing_tool"]);

    expect(tools[0]).toMatchObject({
      name: "validate_skill",
      known: true,
      params: ["name"],
      inputSchema: {
        type: "object",
        required: ["name"],
      },
    });
    expect(tools[1]).toEqual({
      name: "missing_tool",
      known: false,
      description: "Unknown tool",
      params: [],
    });
  });

  test("creates per-skill MCP metadata with install and run schemas", () => {
    const image = getSkill("image");
    expect(image).toBeDefined();

    const metadata = createSkillMcpMetadata(image!);

    expect(metadata).toMatchObject({
      schemaVersion: 1,
      name: "image",
      slug: "image",
      source: "official",
      cliCommand: "skills run image",
    });
    expect(metadata.schemas.install.inputSchema.properties?.name).toEqual({
      type: "string",
      const: "image",
      description: "Skill name or alias to pin.",
    });
    expect(metadata.schemas.run.inputSchema.properties?.name).toEqual({
      type: "string",
      const: "image",
      description: "Skill name or alias to run.",
    });
    expect(metadata.schemas.run.inputSchema.properties?.args).toEqual({
      type: "array",
      items: { type: "string" },
      default: [],
      description: "CLI-style string arguments passed to the skill.",
    });
  });

  test("resource contracts include the registry, contract manifest, and skill detail template", () => {
    expect(getMcpResourceContracts().map((resource) => resource.uri)).toEqual([
      "skills://mcp/contracts",
      "skills://registry",
      "skills://{name}",
    ]);
  });
});
