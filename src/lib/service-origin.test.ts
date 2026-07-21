import { describe, expect, test } from "bun:test";
import {
  CLOUD_API_ORIGIN,
  normalizeCloudApiOrigin,
  normalizeSkillsApiOrigin,
} from "./service-origin";

const LOOPBACK_TEST_ENV = {
  SKILLS_ALLOW_INSECURE_LOOPBACK: "1",
  SKILLS_TEST_MODE: "1",
};

describe("service origin hygiene", () => {
  test("normalizes only root or versioned API bases to one origin", () => {
    expect(normalizeSkillsApiOrigin("https://operator.example/api/v1/", {})).toBe("https://operator.example");
    expect(normalizeSkillsApiOrigin("https://operator.example:8443/api", {})).toBe("https://operator.example:8443");
  });

  test("rejects user information, query, fragment, and application paths", () => {
    for (const value of [
      "https://user:password@operator.example",
      "https://operator.example?tenant=other",
      "https://operator.example#credential",
      "https://operator.example/customer/api/v1",
    ]) {
      expect(() => normalizeSkillsApiOrigin(value, {})).toThrow();
    }
  });

  test("requires an explicit non-production test or preview profile for HTTP loopback", () => {
    expect(() => normalizeSkillsApiOrigin("http://127.0.0.1:8787", {})).toThrow("HTTPS");
    expect(normalizeSkillsApiOrigin("http://127.0.0.1:8787/api/v1", LOOPBACK_TEST_ENV)).toBe("http://127.0.0.1:8787");
    expect(() => normalizeSkillsApiOrigin("http://127.0.0.1:8787", {
      ...LOOPBACK_TEST_ENV,
      NODE_ENV: "production",
    })).toThrow("HTTPS");
    const insecureRemote = ["http", "://operator.example"].join("");
    expect(() => normalizeSkillsApiOrigin(insecureRemote, LOOPBACK_TEST_ENV)).toThrow("HTTPS");
  });

  test("fixes cloud to skills.md except an explicitly enabled loopback test origin", () => {
    expect(normalizeCloudApiOrigin(undefined, {})).toBe(CLOUD_API_ORIGIN);
    expect(normalizeCloudApiOrigin("https://skills.md/api/v1", {})).toBe(CLOUD_API_ORIGIN);
    expect(() => normalizeCloudApiOrigin("https://other.example", {})).toThrow("fixed service origin");
    expect(normalizeCloudApiOrigin("http://localhost:8787", LOOPBACK_TEST_ENV)).toBe("http://localhost:8787");
  });
});
