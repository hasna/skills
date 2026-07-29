import { readdirSync } from "node:fs";
import { log } from "./logger";
import { PROJECT_PATTERNS, type BaseImageVariant, type ProjectType } from "./types";

export function detectProjectType(dir: string): ProjectType | null {
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

export function getBaseImage(type: ProjectType, variant: BaseImageVariant): string {
  const images: Record<ProjectType, Record<BaseImageVariant, string>> = {
    nodejs: {
      alpine: "node:20-alpine",
      slim: "node:20-slim",
      standard: "node:20",
    },
    python: {
      alpine: "python:3.12-alpine",
      slim: "python:3.12-slim",
      standard: "python:3.12",
    },
    go: {
      alpine: "golang:1.22-alpine",
      slim: "golang:1.22",
      standard: "golang:1.22",
    },
    rust: {
      alpine: "rust:1.75-alpine",
      slim: "rust:1.75-slim",
      standard: "rust:1.75",
    },
    java: {
      alpine: "eclipse-temurin:21-jdk-alpine",
      slim: "eclipse-temurin:21-jdk",
      standard: "eclipse-temurin:21-jdk",
    },
    ruby: {
      alpine: "ruby:3.3-alpine",
      slim: "ruby:3.3-slim",
      standard: "ruby:3.3",
    },
    php: {
      alpine: "php:8.3-fpm-alpine",
      slim: "php:8.3-fpm",
      standard: "php:8.3-fpm",
    },
    static: {
      alpine: "nginx:alpine",
      slim: "nginx:stable",
      standard: "nginx:stable",
    },
  };

  return images[type][variant];
}
