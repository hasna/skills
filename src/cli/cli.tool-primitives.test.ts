import { describe, expect, test } from "bun:test";
import { runCli } from "./cli.test-utils";

describe("CLI tool primitives", () => {
  test("lists primitive tools as JSON", async () => {
    const { stdout, exitCode } = await runCli(["tools", "list", "--json"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.total).toBeGreaterThanOrEqual(10);
    expect(data.primitives.map((primitive: { name: string }) => primitive.name)).toContain("ai-gateway");
  });

  test("shows skill primitive dependencies as JSON", async () => {
    const { stdout, exitCode } = await runCli(["tools", "deps", "image", "--json"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toMatchObject({
      skill: "image",
      gatewayBacked: true,
      hostedRuntime: true,
    });
    expect(data.dependencies.map((dependency: { primitive: string }) => dependency.primitive)).toContain("media-image");
  });

  test("validates bundled primitive coverage", async () => {
    const { stdout, exitCode } = await runCli(["tools", "validate", "--json"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.valid).toBe(true);
    expect(data.mappedSkillCount).toBe(data.skillCount);
    expect(data.skillCount).toBeGreaterThanOrEqual(200);
  });
});
