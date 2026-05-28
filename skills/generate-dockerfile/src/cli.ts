import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { BaseImageVariant, GenerateOptions, ProjectType } from "./types";

export function parseOptions(): GenerateOptions {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      type: { type: "string" },
      base: { type: "string", default: "alpine" },
      dir: { type: "string" },
      output: { type: "string" },
      compose: { type: "boolean", default: false },
      dockerignore: { type: "boolean", default: true },
      "no-dockerignore": { type: "boolean", default: false },
      multistage: { type: "boolean", default: true },
      "no-multistage": { type: "boolean", default: false },
      healthcheck: { type: "boolean", default: true },
      "no-healthcheck": { type: "boolean", default: false },
      minimal: { type: "boolean", default: false },
      all: { type: "boolean", default: false },
      port: { type: "string", default: "3000" },
      user: { type: "string", default: "appuser" },
      workdir: { type: "string", default: "/app" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Generate Dockerfile - Create Docker configuration files

Usage:
  skills run generate-dockerfile -- [options]

Options:
  --type <type>        Project type (nodejs, python, go, rust, java, ruby, php, static)
  --base <variant>     Base image variant (alpine, slim, standard) [default: alpine]
  --dir <path>         Project directory [default: cwd]
  --output <path>      Output directory [default: cwd]
  --compose            Generate docker-compose.yml
  --no-dockerignore    Skip .dockerignore generation
  --no-multistage      Disable multi-stage build
  --no-healthcheck     Disable healthcheck
  --minimal            Minimal comments
  --all                Generate all files (Dockerfile, .dockerignore, docker-compose.yml)
  --port <number>      Application port [default: 3000]
  --user <name>        Non-root user name [default: appuser]
  --workdir <path>     Working directory [default: /app]
  --help, -h           Show this help
`);
    process.exit(0);
  }

  const options: GenerateOptions = {
    type: values.type as ProjectType | undefined,
    base: values.base as BaseImageVariant,
    dir: values.dir ? resolve(values.dir as string) : process.cwd(),
    output: values.output ? resolve(values.output as string) : process.cwd(),
    compose: values.compose as boolean,
    dockerignore: !(values["no-dockerignore"] as boolean),
    multistage: !(values["no-multistage"] as boolean),
    healthcheck: !(values["no-healthcheck"] as boolean),
    minimal: values.minimal as boolean,
    all: values.all as boolean,
    port: parseInt(values.port as string, 10),
    user: values.user as string,
    workdir: values.workdir as string,
  };

  if (values.all) {
    options.compose = true;
    options.dockerignore = true;
  }

  return options;
}
