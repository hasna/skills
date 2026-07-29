import { getBaseImage } from "./project-detection";
import type { GenerateOptions, ProjectType } from "./types";

const commentFor = (options: GenerateOptions) => (text: string) => options.minimal ? "" : `# ${text}\n`;

function generateNodejsDockerfile(options: GenerateOptions): string {
  const baseImage = getBaseImage("nodejs", options.base);
  const comment = commentFor(options);

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
  }

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

function generatePythonDockerfile(options: GenerateOptions): string {
  const baseImage = getBaseImage("python", options.base);
  const comment = commentFor(options);

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
  }

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

function generateGoDockerfile(options: GenerateOptions): string {
  const buildImage = getBaseImage("go", options.base);
  const comment = commentFor(options);

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

function generateRustDockerfile(options: GenerateOptions): string {
  const buildImage = getBaseImage("rust", options.base);
  const comment = commentFor(options);

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

function generateJavaDockerfile(options: GenerateOptions): string {
  const buildImage = getBaseImage("java", options.base);
  const runtimeImage = buildImage.replace("-jdk", "-jre");
  const comment = commentFor(options);

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

function generateRubyDockerfile(options: GenerateOptions): string {
  const baseImage = getBaseImage("ruby", options.base);
  const comment = commentFor(options);

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

function generatePhpDockerfile(options: GenerateOptions): string {
  const baseImage = getBaseImage("php", options.base);
  const comment = commentFor(options);

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

function generateStaticDockerfile(options: GenerateOptions): string {
  const baseImage = getBaseImage("static", options.base);
  const comment = commentFor(options);

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

export function generateDockerfile(type: ProjectType, options: GenerateOptions): string {
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
