export function generateHookConfig(hookName: string, shortName: string, event: string, matcher: string): string {
  return JSON.stringify(
    {
      name: hookName,
      description: `TODO: Describe what ${hookName} does`,
      version: '0.1.0',
      event,
      matcher,
      timeout: 5000,
      logFile: `${hookName}.log`,
    },
    null,
    2
  );
}

export function generatePackageJson(hookName: string, shortName: string): string {
  return JSON.stringify(
    {
      name: hookName,
      version: '0.1.0',
      description: `TODO: Describe ${hookName}`,
      type: 'module',
      main: 'src/index.ts',
      bin: {
        [hookName]: 'src/index.ts',
      },
      scripts: {
        start: 'bun run src/index.ts',
        dev: 'bun run --watch src/index.ts',
        test: 'bun test',
      },
      keywords: ['claude-code', 'hook', shortName],
      author: '',
      license: 'Apache-2.0',
      devDependencies: {
        '@types/bun': 'latest',
      },
      peerDependencies: {
        typescript: '^5.0.0',
      },
      repository: {
        type: 'git',
        url: `git+ssh://git@github.com/your-org/${hookName}.git`,
      },
    },
    null,
    2
  );
}

export function generateTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        declaration: true,
        declarationMap: true,
        outDir: './dist',
        rootDir: './src',
      },
      include: ['src/**/*'],
      exclude: ['node_modules', 'dist'],
    },
    null,
    2
  );
}

export function generateBunfig(): string {
  return `[install]
peer = false

[run]
bun = true
`;
}

export function generateGitignore(): string {
  return `node_modules/
dist/
*.log
.env
.env.local
.DS_Store
`;
}

export function generateReadme(hookName: string, shortName: string, event: string, matcher: string): string {
  return `# ${hookName}

TODO: Describe what this hook does.

## Installation

\`\`\`bash
bun add -g git+ssh://git@github.com/your-org/${hookName}.git
\`\`\`

## Setup

\`\`\`bash
${hookName} setup
\`\`\`

This will:
1. Ask for scope (global or project)
2. Configure verbosity level
3. Create \`.claude/hooks/${hookName}.log\`
4. Update Claude Code settings

## Usage

Once set up, the hook runs automatically on \`${event}\` events${matcher !== '*' ? ` for \`${matcher}\` tool` : ''}.

## Commands

| Command | Description |
|---------|-------------|
| \`${hookName}\` | Run the hook (stdin/stdout) |
| \`${hookName} setup\` | Configure Claude Code |
| \`${hookName} test\` | Test the hook manually |
| \`${hookName} config\` | Show configuration |
| \`${hookName} logs\` | View recent logs |

## Configuration

Edit \`~/.claude/hooks/${hookName}.config.json\` or \`.claude/hooks/${hookName}.config.json\`:

\`\`\`json
{
  "verbosity": "blocked",
  "enabled": true
}
\`\`\`

## License

MIT
`;
}

export function generateHookMd(hookName: string, shortName: string, event: string, matcher: string): string {
  return `# ${hookName}

## Overview

TODO: Describe what this hook does and why.

## Event

- **Type**: ${event}
- **Matcher**: ${matcher}
- **Timeout**: 5000ms

## Behavior

TODO: Describe the specific behavior of this hook.

## Examples

### Allowed

TODO: Show examples of operations that are allowed.

### Blocked (if applicable)

TODO: Show examples of operations that are blocked.

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| verbosity | string | "blocked" | Log level: none, blocked, all |
| enabled | boolean | true | Enable/disable the hook |

## Troubleshooting

### Hook not triggering

1. Check Claude Code settings: \`cat ~/.claude/settings.json\`
2. Verify hook is installed: \`which ${hookName}\`
3. Check logs: \`${hookName} logs\`

### Performance issues

Increase timeout in \`hook.config.json\` if needed.
`;
}
