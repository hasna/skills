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
    const image = getSkillToolDependencies("image");
    expect(image?.dependencies.map((dependency) => dependency.primitive)).toEqual(expect.arrayContaining([
      "ai-gateway",
      "hosted-auth",
      "media-image",
    ]));
    expect(image?.gatewayBacked).toBe(true);
    expect(image?.hostedRuntime).toBe(true);
    expect(isGatewayBackedSkill("image")).toBe(true);

    const pdf = getSkillToolDependencies("read-pdf");
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
