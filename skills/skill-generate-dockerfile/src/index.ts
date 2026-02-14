#!/usr/bin/env bun

import { existsSync, mkdirSync, appendFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "util";
import { randomUUID } from "crypto";

// Skill configuration
const SKILL_NAME = "generate-dockerfile";
const SESSION_ID = randomUUID().slice(0, 8);

// Environment paths
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19);
const LOG_FILE = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);

// Ensure output directories exist
[EXPORTS_DIR, LOGS_DIR].forEach((dir) => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
});

// Logging utility
function log(message: string, level: "info" | "error" | "warn" | "success" = "info") {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(LOG_FILE, logMessage);
  
  const prefix = level === "error" ? "❌" : level === "success" ? "✅" : level === "warn" ? "⚠️" : "ℹ️";
  if (level === "error") {
    console.error(`${prefix} ${message}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

// Project type detection patterns
const PROJECT_PATTERNS = {
  nodejs: ["package.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb"],
  python: ["requirements.txt", "setup.py", "pyproject.toml", "Pipfile"],
  go: ["go.mod", "go.sum"],
  rust: ["Cargo.toml", "Cargo.lock"],
  java: ["pom.xml", "build.gradle", "build.gradle.kts"],
  ruby: ["Gemfile", "Gemfile.lock"],
  php: ["composer.json", "composer.lock"],
  static: ["index.html", "index.htm"]
};

type ProjectType = keyof typeof PROJECT_PATTERNS;
type BaseImageVariant = "alpine" | "slim" | "standard";

interface GenerateOptions {
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

// Parse command line arguments
function parseOptions(): GenerateOptions {
  const { values, positionals } = parseArgs({
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

// Auto-detect project type
function detectProjectType(dir: string): ProjectType | null {
  try {
    const files = readdirSync(dir);

    for (const [type, patterns] of Object.entries(PROJECT_PATTERNS)) {
      for (const pattern of patterns) {
        if (files.includes(pattern)) {
          return type as ProjectType;
        }
      }
    }
  } catch (error) {
    log(`Error detecting project type: ${error}`, "warn");
  }

  return null;
}

// Get base image for project type
function getBaseImage(type: ProjectType, variant: BaseImageVariant): string {
  const images: Record<ProjectType, Record<BaseImageVariant, string>> = {
    nodejs: {
      alpine: "node:20-alpine",
      slim: "node:20-slim",
      standard: "node:20"
    },
    python: {
      alpine: "python:3.12-alpine",
      slim: "python:3.12-slim",
      standard: "python:3.12"
    },
    go: {
      alpine: "golang:1.22-alpine",
      slim: "golang:1.22",
      standard: "golang:1.22"
    },
    rust: {
      alpine: "rust:1.75-alpine",
      slim: "rust:1.75-slim",
      standard: "rust:1.75"
    },
    java: {
      alpine: "eclipse-temurin:21-jdk-alpine",
      slim: "eclipse-temurin:21-jdk",
      standard: "eclipse-temurin:21-jdk"
    },
    ruby: {
      alpine: "ruby:3.3-alpine",
      slim: "ruby:3.3-slim",
      standard: "ruby:3.3"
    },
    php: {
      alpine: "php:8.3-fpm-alpine",
      slim: "php:8.3-fpm",
      standard: "php:8.3-fpm"
    },
    static: {
      alpine: "nginx:alpine",
      slim: "nginx:stable",
      standard: "nginx:stable"
    }
  };

  return images[type][variant];
}

// Generate Node.js Dockerfile
function generateNodejsDockerfile(options: GenerateOptions): string {
  const baseImage = getBaseImage("nodejs", options.base);
  const comment = (text: string) => options.minimal ? "" : `# ${text}\n`;

  if (options.multistage) {
    return `${comment("Build stage")}FROM ${baseImage} AS builder

${comment("Set working directory")}WORKDIR ${options.workdir}

${comment("Copy package files")}COPY package*.json ./

${comment("Install dependencies")}RUN npm ci --only=production && \\
    npm cache clean --force

${comment("Copy application files")}COPY . .

${comment("Build application if needed (uncomment if using TypeScript/build step)")}# RUN npm run build

${comment("Production stage")}FROM ${baseImage}

${comment("Install dumb-init for proper signal handling")}RUN apk add --no-cache dumb-init

${comment("Create non-root user")}RUN addgroup -g 1001 -S ${options.user} && \\
    adduser -S ${options.user} -u 1001

${comment("Set working directory")}WORKDIR ${options.workdir}

${comment("Copy dependencies from builder")}COPY --from=builder --chown=${options.user}:${options.user} ${options.workdir}/node_modules ./node_modules

${comment("Copy application files")}COPY --chown=${options.user}:${options.user} . .

${comment("Set environment variables")}ENV NODE_ENV=production \\
    PORT=${options.port}

${comment("Switch to non-root user")}USER ${options.user}

${comment("Expose port")}EXPOSE ${options.port}

${comment("Add health check")}${options.healthcheck ? `HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD node -e "require('http').get('http://localhost:${options.port}/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

` : ""}${comment("Start application")}ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
`;
  } else {
    return `FROM ${baseImage}

${comment("Create non-root user")}RUN addgroup -g 1001 -S ${options.user} && \\
    adduser -S ${options.user} -u 1001

${comment("Set working directory")}WORKDIR ${options.workdir}

${comment("Copy package files")}COPY package*.json ./

${comment("Install dependencies")}RUN npm ci --only=production && \\
    npm cache clean --force

${comment("Copy application files")}COPY --chown=${options.user}:${options.user} . .

${comment("Set environment variables")}ENV NODE_ENV=production \\
    PORT=${options.port}

${comment("Switch to non-root user")}USER ${options.user}

${comment("Expose port")}EXPOSE ${options.port}

${comment("Add health check")}${options.healthcheck ? `HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD node -e "require('http').get('http://localhost:${options.port}/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

` : ""}${comment("Start application")}CMD ["node", "index.js"]
`;
  }
}

// Generate Python Dockerfile
function generatePythonDockerfile(options: GenerateOptions): string {
  const baseImage = getBaseImage("python", options.base);
  const comment = (text: string) => options.minimal ? "" : `# ${text}\n`;

  if (options.multistage) {
    return `${comment("Build stage")}FROM ${baseImage} AS builder

${comment("Set working directory")}WORKDIR ${options.workdir}

${comment("Install build dependencies")}${options.base === "alpine" ? `RUN apk add --no-cache gcc musl-dev libffi-dev

` : ""}${comment("Create virtual environment")}RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

${comment("Copy requirements and install dependencies")}COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

${comment("Production stage")}FROM ${baseImage}

${comment("Install runtime dependencies")}${options.base === "alpine" ? `RUN apk add --no-cache libffi

` : ""}${comment("Create non-root user")}RUN addgroup -g 1001 -S ${options.user} && \\
    adduser -S ${options.user} -u 1001

${comment("Set working directory")}WORKDIR ${options.workdir}

${comment("Copy virtual environment from builder")}COPY --from=builder /opt/venv /opt/venv

${comment("Copy application files")}COPY --chown=${options.user}:${options.user} . .

${comment("Set environment variables")}ENV PATH="/opt/venv/bin:$PATH" \\
    PYTHONUNBUFFERED=1 \\
    PYTHONDONTWRITEBYTECODE=1 \\
    PORT=${options.port}

${comment("Switch to non-root user")}USER ${options.user}

${comment("Expose port")}EXPOSE ${options.port}

${comment("Add health check")}${options.healthcheck ? `HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${options.port}/health').read()"

` : ""}${comment("Start application")}CMD ["python", "app.py"]
`;
  } else {
    return `FROM ${baseImage}

${comment("Create non-root user")}RUN addgroup -g 1001 -S ${options.user} && \\
    adduser -S ${options.user} -u 1001

${comment("Set working directory")}WORKDIR ${options.workdir}

${comment("Copy requirements and install dependencies")}COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

${comment("Copy application files")}COPY --chown=${options.user}:${options.user} . .

${comment("Set environment variables")}ENV PYTHONUNBUFFERED=1 \\
    PYTHONDONTWRITEBYTECODE=1 \\
    PORT=${options.port}

${comment("Switch to non-root user")}USER ${options.user}

${comment("Expose port")}EXPOSE ${options.port}

${comment("Add health check")}${options.healthcheck ? `HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${options.port}/health').read()"

` : ""}${comment("Start application")}CMD ["python", "app.py"]
`;
  }
}

// Generate Go Dockerfile
function generateGoDockerfile(options: GenerateOptions): string {
  const buildImage = getBaseImage("go", options.base);
  const comment = (text: string) => options.minimal ? "" : `# ${text}\n`;

  return `${comment("Build stage")}FROM ${buildImage} AS builder

${comment("Set working directory")}WORKDIR ${options.workdir}

${comment("Copy go mod files")}COPY go.mod go.sum ./

${comment("Download dependencies")}RUN go mod download

${comment("Copy source code")}COPY . .

${comment("Build application")}RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main .

${comment("Production stage - use minimal image")}FROM alpine:latest

${comment("Install ca-certificates for HTTPS")}RUN apk --no-cache add ca-certificates

${comment("Create non-root user")}RUN addgroup -g 1001 -S ${options.user} && \\
    adduser -S ${options.user} -u 1001

${comment("Set working directory")}WORKDIR /root/

${comment("Copy binary from builder")}COPY --from=builder ${options.workdir}/main .

${comment("Set ownership")}RUN chown ${options.user}:${options.user} main

${comment("Switch to non-root user")}USER ${options.user}

${comment("Expose port")}EXPOSE ${options.port}

${comment("Add health check")}${options.healthcheck ? `HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD wget --no-verbose --tries=1 --spider http://localhost:${options.port}/health || exit 1

` : ""}${comment("Start application")}CMD ["./main"]
`;
}

// Generate Rust Dockerfile
function generateRustDockerfile(options: GenerateOptions): string {
  const buildImage = getBaseImage("rust", options.base);
  const comment = (text: string) => options.minimal ? "" : `# ${text}\n`;

  return `${comment("Build stage")}FROM ${buildImage} AS builder

${comment("Set working directory")}WORKDIR ${options.workdir}

${comment("Copy Cargo files")}COPY Cargo.toml Cargo.lock ./

${comment("Create dummy main to cache dependencies")}RUN mkdir src && \\
    echo "fn main() {}" > src/main.rs && \\
    cargo build --release && \\
    rm -rf src

${comment("Copy source code")}COPY . .

${comment("Build application")}RUN cargo build --release

${comment("Production stage")}FROM alpine:latest

${comment("Install runtime dependencies")}RUN apk --no-cache add ca-certificates libgcc

${comment("Create non-root user")}RUN addgroup -g 1001 -S ${options.user} && \\
    adduser -S ${options.user} -u 1001

${comment("Set working directory")}WORKDIR /root/

${comment("Copy binary from builder")}COPY --from=builder ${options.workdir}/target/release/app .

${comment("Set ownership")}RUN chown ${options.user}:${options.user} app

${comment("Switch to non-root user")}USER ${options.user}

${comment("Expose port")}EXPOSE ${options.port}

${comment("Add health check")}${options.healthcheck ? `HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD wget --no-verbose --tries=1 --spider http://localhost:${options.port}/health || exit 1

` : ""}${comment("Start application")}CMD ["./app"]
`;
}

// Generate Java Dockerfile
function generateJavaDockerfile(options: GenerateOptions): string {
  const buildImage = getBaseImage("java", options.base);
  const runtimeImage = buildImage.replace("-jdk", "-jre");
  const comment = (text: string) => options.minimal ? "" : `# ${text}\n`;

  return `${comment("Build stage")}FROM ${buildImage} AS builder

${comment("Set working directory")}WORKDIR ${options.workdir}

${comment("Copy Maven/Gradle files")}COPY pom.xml ./
${comment("Uncomment for Gradle: COPY build.gradle settings.gradle ./")}\

${comment("Copy source code")}COPY src ./src

${comment("Build application")}RUN ./mvnw package -DskipTests
${comment("Uncomment for Gradle: RUN ./gradlew build -x test")}

${comment("Production stage")}FROM ${runtimeImage}

${comment("Create non-root user")}RUN addgroup -g 1001 -S ${options.user} && \\
    adduser -S ${options.user} -u 1001

${comment("Set working directory")}WORKDIR ${options.workdir}

${comment("Copy JAR from builder")}COPY --from=builder ${options.workdir}/target/*.jar app.jar

${comment("Set ownership")}RUN chown ${options.user}:${options.user} app.jar

${comment("Set environment variables")}ENV JAVA_OPTS="-Xmx512m -Xms256m" \\
    PORT=${options.port}

${comment("Switch to non-root user")}USER ${options.user}

${comment("Expose port")}EXPOSE ${options.port}

${comment("Add health check")}${options.healthcheck ? `HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \\
  CMD wget --no-verbose --tries=1 --spider http://localhost:${options.port}/actuator/health || exit 1

` : ""}${comment("Start application")}ENTRYPOINT ["java", "-jar", "app.jar"]
`;
}

// Generate Ruby Dockerfile
function generateRubyDockerfile(options: GenerateOptions): string {
  const baseImage = getBaseImage("ruby", options.base);
  const comment = (text: string) => options.minimal ? "" : `# ${text}\n`;

  return `FROM ${baseImage}

${comment("Install dependencies")}${options.base === "alpine" ? `RUN apk add --no-cache build-base postgresql-dev

` : ""}${comment("Create non-root user")}RUN addgroup -g 1001 -S ${options.user} && \\
    adduser -S ${options.user} -u 1001

${comment("Set working directory")}WORKDIR ${options.workdir}

${comment("Copy Gemfile")}COPY Gemfile Gemfile.lock ./

${comment("Install gems")}RUN bundle install --without development test

${comment("Copy application files")}COPY --chown=${options.user}:${options.user} . .

${comment("Set environment variables")}ENV RAILS_ENV=production \\
    RACK_ENV=production \\
    PORT=${options.port}

${comment("Switch to non-root user")}USER ${options.user}

${comment("Expose port")}EXPOSE ${options.port}

${comment("Add health check")}${options.healthcheck ? `HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD wget --no-verbose --tries=1 --spider http://localhost:${options.port}/health || exit 1

` : ""}${comment("Start application")}CMD ["bundle", "exec", "rackup", "-o", "0.0.0.0", "-p", "${options.port}"]
`;
}

// Generate PHP Dockerfile
function generatePhpDockerfile(options: GenerateOptions): string {
  const baseImage = getBaseImage("php", options.base);
  const comment = (text: string) => options.minimal ? "" : `# ${text}\n`;

  return `FROM ${baseImage}

${comment("Install dependencies")}${options.base === "alpine" ? `RUN apk add --no-cache nginx supervisor

` : ""}${comment("Install composer")}COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

${comment("Create non-root user")}RUN addgroup -g 1001 -S ${options.user} && \\
    adduser -S ${options.user} -u 1001

${comment("Set working directory")}WORKDIR ${options.workdir}

${comment("Copy composer files")}COPY composer.json composer.lock ./

${comment("Install PHP dependencies")}RUN composer install --no-dev --optimize-autoloader

${comment("Copy application files")}COPY --chown=${options.user}:${options.user} . .

${comment("Set environment variables")}ENV PHP_FPM_USER=${options.user} \\
    PHP_FPM_GROUP=${options.user}

${comment("Expose port")}EXPOSE ${options.port}

${comment("Add health check")}${options.healthcheck ? `HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD wget --no-verbose --tries=1 --spider http://localhost:${options.port}/health.php || exit 1

` : ""}${comment("Start PHP-FPM")}CMD ["php-fpm"]
`;
}

// Generate static site Dockerfile
function generateStaticDockerfile(options: GenerateOptions): string {
  const baseImage = getBaseImage("static", options.base);
  const comment = (text: string) => options.minimal ? "" : `# ${text}\n`;

  return `FROM ${baseImage}

${comment("Remove default nginx config")}RUN rm /etc/nginx/conf.d/default.conf

${comment("Copy custom nginx config")}COPY nginx.conf /etc/nginx/conf.d/

${comment("Copy static files")}COPY . /usr/share/nginx/html

${comment("Set permissions")}RUN chown -R nginx:nginx /usr/share/nginx/html && \\
    chmod -R 755 /usr/share/nginx/html

${comment("Switch to non-root user")}USER nginx

${comment("Expose port")}EXPOSE 80

${comment("Add health check")}${options.healthcheck ? `HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD wget --no-verbose --tries=1 --spider http://localhost || exit 1

` : ""}${comment("Start nginx")}CMD ["nginx", "-g", "daemon off;"]
`;
}

// Generate Dockerfile based on project type
function generateDockerfile(type: ProjectType, options: GenerateOptions): string {
  switch (type) {
    case "nodejs":
      return generateNodejsDockerfile(options);
    case "python":
      return generatePythonDockerfile(options);
    case "go":
      return generateGoDockerfile(options);
    case "rust":
      return generateRustDockerfile(options);
    case "java":
      return generateJavaDockerfile(options);
    case "ruby":
      return generateRubyDockerfile(options);
    case "php":
      return generatePhpDockerfile(options);
    case "static":
      return generateStaticDockerfile(options);
    default:
      throw new Error(`Unsupported project type: ${type}`);
  }
}

// Generate .dockerignore
function generateDockerignore(type: ProjectType): string {
  const common = `# Version control
.git
.gitignore
.svn
.hg

# IDE files
.vscode
.idea
*.swp
*.swo
*~

# OS files
.DS_Store
Thumbs.db

# Environment files
.env
.env.*
!.env.example

# Logs
*.log
logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Temporary files
tmp
temp
*.tmp

# Documentation
README.md
CHANGELOG.md
LICENSE
docs
*.md

# CI/CD
.github
.gitlab-ci.yml
.travis.yml
Jenkinsfile

# Testing
coverage
.nyc_output
test
tests
*.test.js
*.spec.js
`;

  const typeSpecific: Record<ProjectType, string> = {
    nodejs: `# Node.js
node_modules
dist
build
.npm
.cache
`,
    python: `# Python
__pycache__
*.py[cod]
*$py.class
venv
env
.Python
*.egg-info
dist
build
.pytest_cache
.coverage
`,
    go: `# Go
vendor
*.exe
*.exe~
*.dll
*.so
*.dylib
`,
    rust: `# Rust
target
Cargo.lock
*.rs.bk
`,
    java: `# Java
target
*.class
*.jar
*.war
.mvn
.gradle
build
`,
    ruby: `# Ruby
.bundle
vendor/bundle
*.gem
.rspec
`,
    php: `# PHP
vendor
composer.phar
*.cache
storage/logs
`,
    static: `# Static
node_modules
src
*.scss
*.sass
*.less
`
  };

  return common + (typeSpecific[type] || "");
}

// Generate docker-compose.yml
function generateDockerCompose(type: ProjectType, options: GenerateOptions): string {
  const serviceName = "app";

  return `version: '3.8'

services:
  ${serviceName}:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "${options.port}:${options.port}"
    environment:
      - NODE_ENV=production
      - PORT=${options.port}
    volumes:
      - ./${options.workdir}:${options.workdir}
    restart: unless-stopped
    ${options.healthcheck ? `healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:${options.port}/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 5s
` : ""}
# Uncomment to add database service
#  db:
#    image: postgres:16-alpine
#    environment:
#      POSTGRES_DB: myapp
#      POSTGRES_USER: user
#      POSTGRES_PASSWORD: password
#    volumes:
#      - db_data:/var/lib/postgresql/data
#    restart: unless-stopped

# Uncomment to add Redis cache
#  redis:
#    image: redis:7-alpine
#    restart: unless-stopped

# volumes:
#   db_data:
`;
}

// Main execution
async function main() {
  try {
    log(`Starting ${SKILL_NAME} skill (Session: ${SESSION_ID})`);
    
    const options = parseOptions();

    // Detect project type if not specified
    let projectType = options.type;
    if (!projectType) {
      console.log("Detecting project type...");
      projectType = detectProjectType(options.dir);

      if (!projectType) {
        throw new Error(
          "Could not detect project type. Please specify with --type option.\n" +
          "Supported types: nodejs, python, go, rust, java, ruby, php, static"
        );
      }

      console.log(`✓ Detected: ${projectType}`);
      log(`Auto-detected project type: ${projectType}`);
    }

    console.log("\nGenerating files...");

    // Generate Dockerfile
    const dockerfile = generateDockerfile(projectType, options);
    const dockerfilePath = join(options.output, "Dockerfile");
    await Bun.write(dockerfilePath, dockerfile);
    console.log(`✓ Generated: Dockerfile (${options.multistage ? "multi-stage, " : ""}${options.base})`);
    log(`Generated Dockerfile at: ${dockerfilePath}`);

    // Save to exports
    const exportDockerfile = join(EXPORTS_DIR, `Dockerfile_${SESSION_ID}`);
    await Bun.write(exportDockerfile, dockerfile);

    // Generate .dockerignore
    if (options.dockerignore) {
      const dockerignore = generateDockerignore(projectType);
      const dockerignorePath = join(options.output, ".dockerignore");
      await Bun.write(dockerignorePath, dockerignore);
      console.log("✓ Generated: .dockerignore");
      log(`Generated .dockerignore at: ${dockerignorePath}`);

      const exportDockerignore = join(EXPORTS_DIR, `.dockerignore_${SESSION_ID}`);
      await Bun.write(exportDockerignore, dockerignore);
    }

    // Generate docker-compose.yml
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
