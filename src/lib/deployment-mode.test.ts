import { describe, expect, test } from "bun:test";
import {
  DeploymentModeResolutionError,
  getDeploymentSetupCommand,
  resolveDeploymentMode,
  resolveDeploymentTarget,
} from "./deployment-mode";

const LOOPBACK_TEST_ENV = {
  SKILLS_ALLOW_INSECURE_LOOPBACK: "1",
  SKILLS_TEST_MODE: "1",
};

describe("deployment mode resolution", () => {
  test("returns complete copy-safe setup commands for every mode", () => {
    expect(getDeploymentSetupCommand("local")).toBe("skills setup --mode local");
    expect(getDeploymentSetupCommand("cloud")).toBe("skills setup --mode cloud");
    expect(getDeploymentSetupCommand("self-hosted")).toBe(
      "skills setup --mode self-hosted --api-url https://operator.example",
    );
  });

  test("defaults to local only when no explicit or legacy remote signal exists", () => {
    expect(resolveDeploymentMode({}, {})).toBe("local");
  });

  test("uses only a complete explicit canonical tuple", () => {
    expect(resolveDeploymentMode({ mode: "cloud" }, {})).toBe("cloud");
    expect(resolveDeploymentTarget({ mode: "self-hosted", apiUrl: "https://operator.example/api/v1" }, {})).toEqual({
      mode: "self-hosted",
      apiUrl: "https://operator.example",
      source: "config",
    });
    expect(resolveDeploymentMode({}, { SKILLS_MODE: "self-hosted", SKILLS_API_URL: "https://operator.example" })).toBe("self-hosted");
    expect(resolveDeploymentMode({}, { SKILLS_MODE: "cloud", SKILLS_API_KEY: "fixture" })).toBe("cloud");
    expect(() => resolveDeploymentMode({}, { SKILLS_MODE: "remote" })).toThrow(DeploymentModeResolutionError);
  });

  test("rejects incomplete and cross-product environment/config selections", () => {
    expect(() => resolveDeploymentTarget({ mode: "self-hosted" }, {})).toThrow("explicit API origin");
    expect(() => resolveDeploymentTarget({ mode: "local" }, { SKILLS_API_URL: "https://skills.md" })).toThrow("SKILLS_MODE");
    expect(() => resolveDeploymentTarget(
      { mode: "cloud" },
      { SKILLS_MODE: "self-hosted", SKILLS_API_URL: "https://operator.example" },
    )).toThrow("conflict");
    expect(() => resolveDeploymentTarget(
      { mode: "self-hosted", apiUrl: "https://one.example" },
      { SKILLS_MODE: "self-hosted", SKILLS_API_URL: "https://two.example" },
    )).toThrow("conflict");
    expect(resolveDeploymentTarget(
      { mode: "self-hosted", apiUrl: "https://operator.example" },
      { SKILLS_MODE: "self-hosted", SKILLS_API_URL: "https://operator.example/api/v1" },
    )).toMatchObject({ mode: "self-hosted", apiUrl: "https://operator.example", source: "environment" });
  });

  test("fixes cloud origin and permits only an explicit loopback test override", () => {
    expect(resolveDeploymentTarget({ mode: "cloud", apiUrl: "https://skills.md/api/v1" }, {})).toMatchObject({
      mode: "cloud",
      apiUrl: "https://skills.md",
    });
    expect(() => resolveDeploymentTarget({ mode: "cloud", apiUrl: "https://operator.example" }, {})).toThrow("fixed service origin");
    expect(resolveDeploymentTarget({ mode: "cloud", apiUrl: "http://127.0.0.1:8787" }, LOOPBACK_TEST_ENV)).toMatchObject({
      mode: "cloud",
      apiUrl: "http://127.0.0.1:8787",
    });
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
    expect(() => resolveDeploymentMode({ apiUrl: "https://operator.example" }, {})).toThrow("saved deployment mode");
  });
});
