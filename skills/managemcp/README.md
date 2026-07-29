# Manage MCP

Public contract for managing MCP server connections.

## Boundary

The OSS package keeps a lightweight CLI stub and documentation only. It does not
ship a PostgreSQL service, REST API server, migration scripts, hosted registry,
or agent-folder installer implementation.

Use the shared Skills MCP registration flow for agent integration:

```bash
skills mcp --register all
```

## Usage

```bash
skills run managemcp --help
```

Hosted MCP catalog state, account-scoped server listings, billing, and
connector management belong in the hosted platform or an external service.
