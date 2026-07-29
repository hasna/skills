import { existsSync, readFileSync } from "fs";
import { extname } from "path";
import * as yaml from "yaml";
import { log } from "./logger";
import type { OpenAPISpec } from "./types";

export async function loadSpec(specPath: string): Promise<OpenAPISpec> {
  log(`Loading OpenAPI spec from: ${specPath}`);

  let content: string;

  if (specPath.startsWith("http://") || specPath.startsWith("https://")) {
    log("Fetching spec from URL...");
    const response = await fetch(specPath);
    if (!response.ok) {
      throw new Error(`Failed to fetch spec: ${response.statusText}`);
    }
    content = await response.text();
  } else {
    log("Reading spec from local file...");
    if (!existsSync(specPath)) {
      throw new Error(`Spec file not found: ${specPath}`);
    }
    content = readFileSync(specPath, "utf-8");
  }

  const ext = extname(specPath).toLowerCase();
  let spec: OpenAPISpec;

  if (ext === ".yaml" || ext === ".yml" || content.trim().startsWith("openapi:") || content.trim().startsWith("swagger:")) {
    log("Parsing YAML spec...");
    spec = yaml.parse(content);
  } else {
    log("Parsing JSON spec...");
    spec = JSON.parse(content);
  }

  if (!spec.openapi && !spec.swagger) {
    throw new Error("Invalid OpenAPI/Swagger specification: missing version field");
  }

  if (!spec.info?.title) {
    throw new Error("Invalid OpenAPI/Swagger specification: missing info.title");
  }

  log(`Loaded spec: ${spec.info.title} v${spec.info.version}`, "success");
  return spec;
}
