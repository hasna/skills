# @hasna/skills

Skills library for AI coding agents

[![npm](https://img.shields.io/npm/v/@hasna/skills)](https://www.npmjs.com/package/@hasna/skills)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/skills
```

## CLI Usage

```bash
skills --help
```

- `skills install`
- `skills list`
- `skills search`
- `skills info`
- `skills docs`
- `skills run`
- `skills remove`
- `skills categories`
- `skills tags`

## MCP Server

```bash
skills-mcp
```

5 tools available.

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service skills
cloud sync pull --service skills
```

## Data Directory

Data is stored in `~/.hasna/skills/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
