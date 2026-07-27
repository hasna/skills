import { describe, expect, test } from "bun:test";
import {
  getSkillToolDependencies,
  getToolPrimitive,
  isGatewayBackedSkill,
  listToolPrimitives,
  validateToolPrimitiveCoverage,
} from "./tool-primitives.js";

describe("tool primitives", () => {
  test("exposes stable primitive definitions", () => {
    const primitives = listToolPrimitives();
    expect(primitives.length).toBeGreaterThanOrEqual(10);
    expect(primitives.map((primitive) => primitive.name)).toContain("ai-gateway");
    expect(getToolPrimitive("ai-gateway")).toMatchObject({
      name: "ai-gateway",
      runtime: "gateway",
      stable: true,
    });
  });

  test("maps representative skills to primitive dependencies", () => {
    const image = getSkillToolDependencies("logo-design");
    expect(image?.dependencies.map((dependency) => dependency.primitive)).toEqual(expect.arrayContaining([
      "media-image",
    ]));
    expect(image?.gatewayBacked).toBe(true); // category rule: Design & Branding is AI-assisted
    expect(image?.hostedRuntime).toBe(false);
    expect(isGatewayBackedSkill("logo-design")).toBe(true);

    const pdf = getSkillToolDependencies("pdf-to-markdown");
    expect(pdf?.dependencies.map((dependency) => dependency.primitive)).toContain("documents-read");

    const csv = getSkillToolDependencies("read-csv");
    expect(csv?.dependencies.map((dependency) => dependency.primitive)).toContain("structured-data");
  });

  test("validates primitive coverage for the bundled catalog", () => {
    const result = validateToolPrimitiveCoverage("all");
    expect(result.valid).toBe(true);
    expect(result.skillCount).toBeGreaterThanOrEqual(200);
    expect(result.mappedSkillCount).toBe(result.skillCount);
    expect(result.gatewayBackedSkillCount).toBeGreaterThan(25);
    expect(result.issues).toEqual([]);
  });
});
