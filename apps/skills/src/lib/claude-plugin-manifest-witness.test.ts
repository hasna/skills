import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { hashClaudePluginManifest, projectReviewedClaudePluginManifest } from "./claude-plugin-manifest-witness.js";

test("Claude plugin descriptive metadata is excluded while discovery and unknown fields remain bound", () => {
  const original = JSON.stringify({ name: "hasna-autogoal", skills: "./skills", version: "0.1.2", description: "Agent guidance" });
  const metadataOnly = JSON.stringify({
    description: "Updated summary",
    author: { name: "Hasna", email: "team@example.invalid" },
    name: "hasna-autogoal",
    version: "0.1.3",
    homepage: "https://example.invalid/project",
    repository: { type: "git", url: "https://example.invalid/repo" },
    license: "MIT",
    keywords: ["agent", "skills"],
    skills: "./skills",
  }, null, 2);
  const originalHash = hashClaudePluginManifest(original);
  expect(hashClaudePluginManifest(metadataOnly)).toBe(originalHash);

  for (const changed of [
    { name: "other-plugin", skills: "./skills" },
    { name: "hasna-autogoal", skills: "./alternate-skills" },
    { name: "hasna-autogoal", skills: "./skills", futurePromptExtension: { entrypoint: "inject.js" } },
    { name: "hasna-autogoal", skills: "./skills", futurePromptExtension: { first: "a", second: "b" } },
    { name: "hasna-autogoal", skills: "./skills", mcpServers: { recorder: { command: "run" } } },
    { name: "hasna-autogoal", skills: "./skills", commands: "./commands" },
    { name: "hasna-autogoal", skills: "./skills", hooks: {} },
  ]) expect(hashClaudePluginManifest(JSON.stringify(changed))).not.toBe(originalHash);
  expect(hashClaudePluginManifest('{"name":"hasna-autogoal","skills":"./skills","futurePromptExtension":{"second":"b","first":"a"}}'))
    .not.toBe(hashClaudePluginManifest('{"name":"hasna-autogoal","skills":"./skills","futurePromptExtension":{"first":"a","second":"b"}}'));
});

test("Claude plugin semantic witnesses reject malformed metadata and duplicate JSON keys", () => {
  for (const invalid of [
    '{"name":"plugin","description":{}}',
    '{"name":"plugin","version":1}',
    '{"name":"plugin","author":{"name":"a","unexpected":"b"}}',
    '{"name":"plugin","repository":{"url":"https://example.invalid","script":"run"}}',
    '{"name":"plugin","keywords":"agent"}',
    '{"name":"plugin","name":"other"}',
  ]) expect(() => hashClaudePluginManifest(invalid)).toThrow();
});

test("reviewed projection accepts only the exact raw bytes attested by the review", () => {
  const reviewed = '{"name":"plugin","version":"1.0.0","description":"old"}';
  const edited = '{"name":"plugin","version":"1.0.1","description":"new"}';
  const reviewedSha256 = createHash("sha256").update(reviewed).digest("hex");
  expect(projectReviewedClaudePluginManifest(reviewed, reviewedSha256)).toBe(hashClaudePluginManifest(reviewed));
  expect(() => projectReviewedClaudePluginManifest(edited, reviewedSha256)).toThrow("changed before semantic projection");
});
