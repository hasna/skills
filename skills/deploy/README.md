# deploy

Automated deployment CLI for EC2 instances with git pull, service restart, and health checks.

## Overview

`deploy` automates the complete deployment process for services running on EC2 instances:

1. **Pull latest code** from GitHub
2. **Restart services** via systemd
3. **Health checks** to verify deployment success
4. **Status reporting** with detailed output

## Features

- **Automated Deployments**: One command to deploy to any configured host
- **Multi-Host Deployment**: Deploy to multiple hosts in a single command
- **Parallel Execution**: Deploy to multiple hosts concurrently for faster deployments
- **Health Checks**: Verify services are running correctly after deployment
- **Service Management**: Restart and check status of systemd services
- **Git Integration**: Pull latest code from configured branches
- **Extensible**: Easy to add new hosts and services
- **Verbose Mode**: Detailed output for debugging
- **Dry Run**: Preview deployments without making changes

## Installation

```bash
cd deploy
bun install
```

## Configuration

Hosts are configured in `src/hosts.ts`. Each host configuration includes:

```typescript
{
  name: 'Display Name',
  sshHost: 'ssh-config-hostname',  // Must match ~/.ssh/config
  deployPath: '/path/to/deploy',
  service: 'service-name.service',  // Optional systemd service
  healthUrl: 'http://localhost:3847/health',  // Optional health check endpoint
  gitRepo: 'git@github.com:org/repo.git',
  gitBranch: 'main',
  user: 'ec2-user'  // User to run git commands as
}
```

### Configured Hosts

- **lab-mcp**: Lab environment for MCP services
- **prod-skill**: Production skill server

## Usage

### Deploy Command

Deploy to one or more configured hosts:

```bash
# Basic deployment to single host
bun run src/index.ts deploy lab-mcp

# Deploy to multiple hosts (sequential)
bun run src/index.ts deploy lab-mcp prod-skill

# Deploy to multiple hosts (parallel for faster execution)
bun run src/index.ts deploy lab-mcp prod-skill --parallel

# Deploy to all configured hosts
bun run src/index.ts deploy --all

# Deploy to all hosts in parallel
bun run src/index.ts deploy --all --parallel

# Deployment with verbose output
bun run src/index.ts deploy lab-mcp --verbose

# Skip service restart (only pull code)
bun run src/index.ts deploy prod-skill --skip-restart

# Skip health check
bun run src/index.ts deploy lab-mcp --skip-health

# Dry run (preview only)
bun run src/index.ts deploy lab-mcp --dry-run

# Force deployment even if already up-to-date
bun run src/index.ts deploy lab-mcp --force
```

### Health Check Command

Run health check on a deployed service:

```bash
bun run src/index.ts health lab-mcp
```

### Status Command

Check systemd service status:

```bash
bun run src/index.ts status lab-mcp
```

### List Hosts Command

List all configured hosts:

```bash
bun run src/index.ts list
```

## Commands Reference

| Command | Description |
|---------|-------------|
| `deploy <host...>` | Deploy to one or more specified hosts |
| `list` | List available hosts |
| `health <host>` | Run health check on host |
| `status <host>` | Check service status on host |
| `help` | Show help message |

## Options Reference

| Option | Description |
|--------|-------------|
| `--host, -h <name>` | Target host name (can use multiple times) |
| `--all` | Deploy to all configured hosts |
| `--parallel, -p` | Deploy to multiple hosts in parallel |
| `--skip-health` | Skip health check |
| `--skip-restart` | Skip service restart |
| `--dry-run` | Show what would be done |
| `--verbose, -v` | Verbose output |
| `--force, -f` | Force deployment even if up-to-date |

## Deployment Process

When you run a deployment, the following steps occur:

1. **Connect via SSH** using configured hostname from `~/.ssh/config`
2. **Check current git status** to see what commit is deployed
3. **Pull latest code** from the configured branch
4. **Restart systemd service** (if configured and not skipped)
5. **Wait for service to start** (2 second delay)
6. **Run health check** (if configured and not skipped)
7. **Report results** with detailed status

## Adding New Hosts

To add a new deployment host:

1. Add SSH configuration to `~/.ssh/config`:
   ```
   Host my-new-host
       HostName 1.2.3.4
       User ec2-user
       IdentityFile ~/.ssh/keys/my-key.pem
       StrictHostKeyChecking no
   ```

2. Add host configuration to `src/hosts.ts`:
   ```typescript
   'my-new-host': {
     name: 'My New Host',
     sshHost: 'my-new-host',
     deployPath: '/opt/myapp',
     service: 'myapp.service',
     healthUrl: 'http://localhost:8080/health',
     gitRepo: 'git@github.com:org/myapp.git',
     gitBranch: 'main',
     user: 'ec2-user',
   },
   ```

3. Deploy:
   ```bash
   bun run src/index.ts deploy my-new-host
   ```

## Examples

### Deploy to Single Host

```bash
# Full deployment with health check
bun run src/index.ts deploy lab-mcp

# Output:
# 🚀 Deploying to Lab MCP (lab-mcp)
#    Path: /opt/mcp-mail
#    Service: mcp-mail.service
#
# 📦 Pulling latest code from main...
# ✅ Updated from e8ab824 to 537c644
# 🔄 Restarting service mcp-mail.service...
# ✅ Service restarted
# 🏥 Running health check: http://localhost:3847/health...
# ✅ Health check passed (45ms)
#
# ✅ Deployment completed successfully in 3245ms
#
# ============================================================
#
# 📊 Deployment Summary:
#    Total: 1
#    ✅ Success: 1
#    ❌ Failed: 0
```

### Deploy to Multiple Hosts

```bash
# Sequential deployment to multiple hosts
bun run src/index.ts deploy lab-mcp prod-skill

# Parallel deployment (faster)
bun run src/index.ts deploy --all --parallel

# Output:
# 🚀 Starting parallel deployment to 2 hosts...
#
# [Deployment logs for each host appear concurrently]
#
# ============================================================
#
# 📊 Deployment Summary:
#    Total: 2
#    ✅ Success: 2
#    ❌ Failed: 0
```

### Check Service Health

```bash
bun run src/index.ts health lab-mcp

# Output:
# 🏥 Running health check for Lab MCP...
#
# ✅ Health check passed (42ms)
#
# Response:
# {
#   "status": "ok",
#   "version": "1.0.0",
#   "transport": "sse"
# }
```

### List All Hosts

```bash
bun run src/index.ts list

# Output:
# Available Deployment Hosts:
#
# 📦 Lab MCP (lab-mcp)
#    Path: /opt/mcp-mail
#    Service: mcp-mail.service
#    Health: http://localhost:3847/health
#
# 📦 Prod Skill (prod-skill)
#    Path: /opt/skills
#    Service: N/A
#    Health: N/A
```

## CI/CD Integration

### GitHub Actions

```yaml
name: Deploy to Lab
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1

      - name: Deploy
        run: |
          cd deploy
          bun install
          bun run src/index.ts deploy lab-mcp
```

## Troubleshooting

### SSH Connection Failed

Ensure your SSH key is loaded and `~/.ssh/config` is configured correctly:

```bash
ssh-add ~/.ssh/keys/your-key.pem
ssh your-host-name "echo OK"
```

### Git Pull Failed

Check that the deploy user has SSH access to GitHub:

```bash
ssh your-host-name "cd /opt/myapp && git pull origin main"
```

### Service Restart Failed

Verify systemd service exists and user has sudo permissions:

```bash
ssh your-host-name "sudo systemctl status myservice.service"
```

### Health Check Failed

Check that the service is listening on the correct port:

```bash
ssh your-host-name "curl http://localhost:3847/health"
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│         deploy (Local Machine)            │
│                                                  │
│  1. Read host config                            │
│  2. SSH to remote host                          │
│  3. Pull latest code                            │
│  4. Restart service                             │
│  5. Run health check                            │
└─────────────────┬───────────────────────────────┘
                  │ SSH
                  │
┌─────────────────▼───────────────────────────────┐
│          EC2 Instance (Remote Host)             │
│                                                  │
│  ┌────────────────────────────────────────┐    │
│  │  /opt/myapp/                            │    │
│  │  - Git repository                       │    │
│  │  - Application code                     │    │
│  └────────────────────────────────────────┘    │
│                                                  │
│  ┌────────────────────────────────────────┐    │
│  │  Systemd Service                        │    │
│  │  - myapp.service                        │    │
│  │  - Auto-start on boot                   │    │
│  └────────────────────────────────────────┘    │
│                                                  │
│  ┌────────────────────────────────────────┐    │
│  │  Health Endpoint                        │    │
│  │  - http://localhost:PORT/health         │    │
│  └────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

## Development

```bash
# Watch mode (auto-reload on changes)
bun run dev

# Run directly
bun run src/index.ts <command>
```

## License

MIT
