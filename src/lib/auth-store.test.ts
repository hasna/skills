import { describe, expect, test } from "bun:test";
import { resolveEnvironmentApiKey } from "./auth-store";
import type { DeploymentTarget } from "./deployment-mode";

const cloud: DeploymentTarget = { mode: "cloud", apiUrl: "https://skills.md", source: "config" };
const selfHosted: DeploymentTarget = { mode: "self-hosted", apiUrl: "https://operator.example", source: "config" };
const loopback: DeploymentTarget = { mode: "self-hosted", apiUrl: "http://127.0.0.1:8787", source: "config" };
const loopbackEnv = {
  SKILLS_ALLOW_INSECURE_LOOPBACK: "1",
  SKILLS_TEST_MODE: "1",
};

describe("environment API credential binding", () => {
  test("keeps the generic legacy key cloud-only", () => {
    expect(resolveEnvironmentApiKey(cloud, { SKILLS_API_KEY: "cloud-fixture" })).toBe("cloud-fixture");
    expect(() => resolveEnvironmentApiKey(selfHosted, { SKILLS_API_KEY: "wrong-service" })).toThrow("cloud-only");
  });

  test("requires a self-hosted key and matching service URL as one binding", () => {
    expect(resolveEnvironmentApiKey(selfHosted, {
      SKILLS_SELF_HOSTED_API_KEY: "operator-fixture",
      SKILLS_SELF_HOSTED_API_URL: "https://operator.example/api/v1",
    })).toBe("operator-fixture");
    expect(() => resolveEnvironmentApiKey(selfHosted, {
      SKILLS_SELF_HOSTED_API_KEY: "operator-fixture",
    })).toThrow("both");
    expect(() => resolveEnvironmentApiKey(selfHosted, {
      SKILLS_SELF_HOSTED_API_KEY: "operator-fixture",
      SKILLS_SELF_HOSTED_API_URL: "https://other.example",
    })).toThrow("does not match");
  });

  test("never sends generic or production credentials to loopback", () => {
    expect(() => resolveEnvironmentApiKey(loopback, {
      ...loopbackEnv,
      SKILLS_API_KEY: "production-shaped-fixture",
    })).toThrow("never accepted");
    expect(() => resolveEnvironmentApiKey(loopback, {
      ...loopbackEnv,
      SKILLS_SELF_HOSTED_API_KEY: "operator-fixture",
      SKILLS_SELF_HOSTED_API_URL: loopback.apiUrl,
    })).toThrow("never accepted");
  });

  test("accepts only an explicitly bound test key for loopback", () => {
    expect(resolveEnvironmentApiKey(loopback, {
      ...loopbackEnv,
      SKILLS_TEST_API_KEY: "test-fixture",
      SKILLS_TEST_API_URL: "http://127.0.0.1:8787/api/v1",
    })).toBe("test-fixture");
    expect(() => resolveEnvironmentApiKey(loopback, {
      ...loopbackEnv,
      SKILLS_TEST_API_KEY: "test-fixture",
      SKILLS_TEST_API_URL: "http://127.0.0.1:9999",
    })).toThrow("does not match");
  });
});
