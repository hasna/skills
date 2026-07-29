import type { GenerateOptions, ProjectType } from "./types";

export function generateDockerignore(type: ProjectType): string {
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
`,
  };

  return common + (typeSpecific[type] || "");
}

export function generateDockerCompose(_type: ProjectType, options: GenerateOptions): string {
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
