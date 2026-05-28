import { join } from "path";
import { RUN_ID, SKILL_NAME } from "./constants";
import { writeFile, writeJson } from "./file-writer";
import {
  renderCopyDoc,
  renderCss,
  renderDeployNotes,
  renderHtml,
  renderReadme,
  renderScript,
} from "./renderers";
import type { Palette, WebsiteFiles, WebsiteOptions, WebsiteSection } from "./types";

export function writeArtifacts(options: WebsiteOptions, palette: Palette, sections: WebsiteSection[]) {
  const files: WebsiteFiles = {
    html: "site/index.html",
    css: "site/styles.css",
    script: "site/script.js",
    readme: "site/README.md",
    copy: "copy.md",
    sectionMap: "section-map.json",
    deployNotes: "deploy-notes.md",
    manifest: "manifest.json",
  };

  writeFile(join(options.outputDir, files.html), renderHtml(options, sections));
  writeFile(join(options.outputDir, files.css), renderCss(palette));
  writeFile(join(options.outputDir, files.script), renderScript());
  writeFile(join(options.outputDir, files.readme), renderReadme(options, files));
  writeFile(join(options.outputDir, files.copy), renderCopyDoc(options, sections));
  writeJson(join(options.outputDir, files.sectionMap), {
    pageName: options.name,
    primaryGoal: options.goal,
    sections: sections.map((section, index) => ({
      order: index + 1,
      id: section.id,
      kind: section.kind,
      headline: section.headline,
      primaryCta: section.primaryCta,
    })),
  });
  writeFile(join(options.outputDir, files.deployNotes), renderDeployNotes(options));
  writeJson(join(options.outputDir, files.manifest), {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    input: {
      brief: options.brief,
      name: options.name,
      audience: options.audience,
      goal: options.goal,
      style: options.style,
      proof: options.proof,
      sections: options.sections,
    },
    fileCount: Object.keys(files).length,
    files,
  });

  return files;
}
