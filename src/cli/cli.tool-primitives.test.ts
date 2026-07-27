import { describe, expect, test } from "bun:test";
import { runCli } from "./cli.test-utils";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

describe("CLI tool primitives", () => {
  test("lists primitive tools as JSON", async () => {
    const { stdout, exitCode } = await runCli(["tools", "list", "--json"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.total).toBeGreaterThanOrEqual(10);
    expect(data.primitives.map((primitive: { name: string }) => primitive.name)).toContain("ai-gateway");
  });

  test("shows skill primitive dependencies as JSON", async () => {
    const { stdout, exitCode } = await runCli(["tools", "deps", "ad-creative-pack", "--json"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toMatchObject({
      skill: "ad-creative-pack",
            hostedRuntime: false,
    });
    expect(data.dependencies.map((dependency: { primitive: string }) => dependency.primitive)).toContain("media-image");
  });

  test("validates bundled primitive coverage", async () => {
    const { stdout, exitCode } = await runCli(["tools", "validate", "--json"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.valid).toBe(true);
    expect(data.mappedSkillCount).toBe(data.skillCount);
    // Declarative-only catalog: 19 shipped skills.
    expect(data.skillCount).toBe(19);
  });
});
