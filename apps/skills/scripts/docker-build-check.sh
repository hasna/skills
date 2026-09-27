#!/usr/bin/env bash
# Regression check for O15-00677 — the skills docker image must build.
#
# Background: the deps stage runs `bun install`, whose lifecycle scripts
# include `prepare` ("bun run build:js"). At that point only package.json +
# bun.lock + bunfig.toml exist in the stage, so the prepare build fails on
# the missing src/ (FileNotFound opening root directory "./src/"). The
# install line therefore skips lifecycle scripts (--ignore-scripts) and the
# build runs explicitly afterwards in the build stage, where src/ exists.
# This check runs the real docker build to prove the whole thing.
#
# Usage: bash scripts/docker-build-check.sh   (also wired as `bun run docker:check`)
set -euo pipefail

cd "$(dirname "$0")/.."

docker build --platform=linux/arm64 --target runtime -t hasna/skills:docker-check .

echo "docker build OK (target runtime)"
