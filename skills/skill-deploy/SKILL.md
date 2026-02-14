# skill-deploy

## Description

Deployment automation skill for EC2 instances. Automates git pull, service restart, and health checks for configured hosts.

## Category

DevOps / Deployment / Automation

## Commands

### deploy
Deploy to one or more hosts with git pull, service restart, and health check.

```bash
bun run src/index.ts deploy <host...> [options]
```

Options:
- `--all` - Deploy to all configured hosts
- `--parallel, -p` - Deploy to multiple hosts in parallel
- `--skip-health` - Skip health check after deployment
- `--skip-restart` - Skip service restart (only pull code)
- `--verbose, -v` - Show detailed output
- `--dry-run` - Preview deployment without making changes
- `--force, -f` - Force deployment even if already up-to-date

### list / hosts
List all configured deployment hosts.

```bash
bun run src/index.ts list
```

### health
Run health check on a deployed service.

```bash
bun run src/index.ts health <host>
```

### status
Check systemd service status on a host.

```bash
bun run src/index.ts status <host>
```

## Dependencies

- **Bun**: Runtime environment
- **SSH**: Configured SSH access to target hosts
- **Git**: Git repositories on target hosts
- **systemd**: For service management (optional)

## Integration

### Use Cases

1. **Manual Deployments**: Deploy latest code to any environment on demand
2. **CI/CD Pipeline**: Automate deployments from GitHub Actions
3. **Health Monitoring**: Check service status and health endpoints
4. **Multi-Environment**: Support for lab, staging, and production environments

### Example: Deploy from Local

```bash
# Deploy single host
bun run src/index.ts deploy lab-mcp

# Deploy multiple hosts sequentially
bun run src/index.ts deploy lab-mcp prod-skill

# Deploy all hosts in parallel
bun run src/index.ts deploy --all --parallel

# Deploy with verbose logging
bun run src/index.ts deploy lab-mcp --verbose
```

### Example: CI/CD Integration

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Deploy
        run: |
          cd skill-deploy
          bun install
          bun run src/index.ts deploy lab-mcp
```

## Configuration

Hosts are configured in `src/hosts.ts`:

```typescript
{
  name: 'Display Name',
  sshHost: 'ssh-config-hostname',
  deployPath: '/opt/myapp',
  service: 'myapp.service',
  healthUrl: 'http://localhost:PORT/health',
  gitRepo: 'git@github.com:org/repo.git',
  gitBranch: 'main',
  user: 'ec2-user'
}
```

## Supported Hosts

- **lab-mcp**: Lab environment for MCP services
- **prod-skill**: Production skill server

## Deployment Process

1. SSH to target host
2. Pull latest code from configured branch
3. Restart systemd service (if configured)
4. Run health check (if configured)
5. Report results with detailed status

## Requirements

- SSH keys configured in `~/.ssh/config`
- Git SSH access to repositories
- Sudo permissions for service management
- Health endpoints (optional)
