export const PROJECT_PATTERNS = {
  nodejs: ["package.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb"],
  python: ["requirements.txt", "setup.py", "pyproject.toml", "Pipfile"],
  go: ["go.mod", "go.sum"],
  rust: ["Cargo.toml", "Cargo.lock"],
  java: ["pom.xml", "build.gradle", "build.gradle.kts"],
  ruby: ["Gemfile", "Gemfile.lock"],
  php: ["composer.json", "composer.lock"],
  static: ["index.html", "index.htm"],
};

export type ProjectType = keyof typeof PROJECT_PATTERNS;
export type BaseImageVariant = "alpine" | "slim" | "standard";

export interface GenerateOptions {
  type?: ProjectType;
  base: BaseImageVariant;
  dir: string;
  output: string;
  compose: boolean;
  dockerignore: boolean;
  multistage: boolean;
  healthcheck: boolean;
  minimal: boolean;
  all: boolean;
  port: number;
  user: string;
  workdir: string;
}
