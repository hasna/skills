#!/usr/bin/env bun

import { join } from "node:path";
import { parseOptions } from "./cli";
import { generateDockerfile } from "./dockerfile-templates";
import { EXPORTS_DIR, SESSION_ID, SKILL_NAME, log } from "./logger";
import { detectProjectType } from "./project-detection";
import { generateDockerCompose, generateDockerignore } from "./support-files";

async function main() {
  try {
    log(`Starting ${SKILL_NAME} skill (Session: ${SESSION_ID})`);

    const options = parseOptions();
    let projectType = options.type;

    if (!projectType) {
      console.log("Detecting project type...");
      const detectedType = detectProjectType(options.dir);

      if (!detectedType) {
        throw new Error(
          "Could not detect project type. Please specify with --type option.\n" +
            "Supported types: nodejs, python, go, rust, java, ruby, php, static"
        );
      }

      projectType = detectedType;
      console.log(`✓ Detected: ${projectType}`);
      log(`Auto-detected project type: ${projectType}`);
    }

    console.log("\nGenerating files...");

    const dockerfile = generateDockerfile(projectType, options);
    const dockerfilePath = join(options.output, "Dockerfile");
    await Bun.write(dockerfilePath, dockerfile);
    console.log(`✓ Generated: Dockerfile (${options.multistage ? "multi-stage, " : ""}${options.base})`);
    log(`Generated Dockerfile at: ${dockerfilePath}`);

    const exportDockerfile = join(EXPORTS_DIR, `Dockerfile_${SESSION_ID}`);
    await Bun.write(exportDockerfile, dockerfile);

    if (options.dockerignore) {
      const dockerignore = generateDockerignore(projectType);
      const dockerignorePath = join(options.output, ".dockerignore");
      await Bun.write(dockerignorePath, dockerignore);
      console.log("✓ Generated: .dockerignore");
      log(`Generated .dockerignore at: ${dockerignorePath}`);

      const exportDockerignore = join(EXPORTS_DIR, `.dockerignore_${SESSION_ID}`);
      await Bun.write(exportDockerignore, dockerignore);
    }

    if (options.compose) {
      const compose = generateDockerCompose(projectType, options);
      const composePath = join(options.output, "docker-compose.yml");
      await Bun.write(composePath, compose);
      console.log("✓ Generated: docker-compose.yml");
      log(`Generated docker-compose.yml at: ${composePath}`);

      const exportCompose = join(EXPORTS_DIR, `docker-compose_${SESSION_ID}.yml`);
      await Bun.write(exportCompose, compose);
    }

    console.log(`\nFiles created in: ${options.output}`);
    console.log("\nNext steps:");
    console.log("1. Review and customize Dockerfile if needed");
    console.log("2. Build image: docker build -t my-app .");
    console.log(options.compose ? "3. Run container: docker compose up" : "3. Run container: docker run -p 3000:3000 my-app");

    log(`Successfully generated Dockerfile for ${projectType} project`, "success");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error: ${errorMessage}`, "error");
    console.error(`\nError: ${errorMessage}`);
    process.exit(1);
  }
}

main();
