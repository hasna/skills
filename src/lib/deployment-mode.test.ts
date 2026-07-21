import { describe, expect, test } from "bun:test";
import { DeploymentModeResolutionError, resolveDeploymentMode } from "./deployment-mode";

describe("deployment mode resolution", () => {
  test("defaults to local only when no explicit or legacy remote signal exists", () => {
    expect(resolveDeploymentMode({}, {})).toBe("local");
  });

  test("uses only an explicit canonical mode", () => {
    expect(resolveDeploymentMode({ mode: "cloud" }, { SKILLS_API_URL: "https://operator.example" })).toBe("cloud");
    expect(resolveDeploymentMode({ mode: "self-hosted" }, { SKILLS_API_KEY: "fixture" })).toBe("self-hosted");
    expect(resolveDeploymentMode({ mode: "local" }, { SKILLS_API_URL: "https://skills.md" })).toBe("local");
    expect(resolveDeploymentMode({}, { SKILLS_MODE: "self-hosted", SKILLS_API_URL: "https://operator.example" })).toBe("self-hosted");
    expect(resolveDeploymentMode({}, { SKILLS_MODE: "cloud", SKILLS_API_KEY: "fixture" })).toBe("cloud");
    expect(() => resolveDeploymentMode({}, { SKILLS_MODE: "remote" })).toThrow(DeploymentModeResolutionError);
  });

  test("rejects legacy URL and credential inference instead of guessing a remote mode", () => {
    for (const env of [
      { SKILLS_API_URL: "https://skills.md" },
      { SKILLS_API_URL: "https://operator.example" },
      { SKILLS_API_KEY: "fixture" },
      { SKILL_API_KEY: "fixture" },
    ]) {
      expect(() => resolveDeploymentMode({}, env)).toThrow(DeploymentModeResolutionError);
    }
    expect(() => resolveDeploymentMode({ apiUrl: "https://operator.example" }, {})).toThrow("skills setup --mode");
  });
});
