import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scaffoldPortableSkill, validatePortableSkillDirectory } from "./portable-skills.js";
import { writeSkillJsonWithHash } from "./portable-skills-files.js";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
test("manifest-only instruction validates as instruction with no runtime", () => {
 const root = mkdtempSync(join(tmpdir(), "portable-kind-")); roots.push(root);
 const skill = scaffoldPortableSkill("kind-fixture", { rootDir: root, kind: "instruction" });
 writeFileSync(join(skill.path, "SKILL.md"), `---\nname: ${skill.name}\ndescription: Fixture\n---\nSynthetic instructions.\n`);
 writeSkillJsonWithHash(skill.path, skill.manifest);
 const result = validatePortableSkillDirectory(skill.name, skill.path);
 expect(result.valid).toBe(true);
 expect(result.metadata.portableManifest?.kind).toBe("instruction");
 expect(result.metadata.kind).toBe("instruction");
 expect(result.metadata.runtime).toBe("none");
});

test("legacy instruction frontmatter remains the fallback without skill.json", () => {
 const root = mkdtempSync(join(tmpdir(), "portable-legacy-")); roots.push(root);
 writeFileSync(join(root, "SKILL.md"), "---\nname: legacy-fixture\ndescription: Fixture\nkind: instruction\n---\nSynthetic instructions.\n");
 const result = validatePortableSkillDirectory("legacy-fixture", root);
 expect(result.valid).toBe(true); expect(result.metadata.kind).toBe("instruction"); expect(result.metadata.runtime).toBe("none");
});
test("an executable manifest stays executable even when frontmatter says instruction", () => {
 const root = mkdtempSync(join(tmpdir(), "portable-executable-")); roots.push(root);
 const skill = scaffoldPortableSkill("exec-fixture", { rootDir: root, kind: "executable" });
 writeFileSync(join(skill.path, "SKILL.md"), "---\nname: exec-fixture\ndescription: Fixture\nkind: instruction\n---\nSynthetic executable docs.\n");
 writeSkillJsonWithHash(skill.path, skill.manifest);
 const result = validatePortableSkillDirectory(skill.name, skill.path);
 expect(result.metadata.kind).toBe("executable"); expect(result.metadata.runtime).toBe("local");
 rmSync(join(skill.path, "package.json")); writeSkillJsonWithHash(skill.path, skill.manifest);
 const missing = validatePortableSkillDirectory(skill.name, skill.path);
 expect(missing.valid).toBe(false); expect(missing.issues.some(issue => issue.code === "package.missing")).toBe(true);
});
test("an unreadable skill.json is reported as portable.manifest_invalid instead of throwing", () => {
 const root = mkdtempSync(join(tmpdir(), "portable-broken-")); roots.push(root);
 writeFileSync(join(root, "SKILL.md"), "---\nname: broken-fixture\ndescription: Fixture\n---\nSynthetic instructions.\n");
 writeFileSync(join(root, "skill.json"), "[]\n");
 const result = validatePortableSkillDirectory("broken-fixture", root);
 expect(result.valid).toBe(false);
 expect(result.metadata.portableManifest).toBeUndefined();
 expect(result.issues.filter(issue => issue.code === "portable.manifest_invalid").map(issue => issue.message)).toEqual(["skill.json must contain a JSON object"]);
});
