# Manage MCP

Use this skill as a public contract for MCP server management workflows.

Do not copy this skill into agent-native skill folders. Register the shared
Skills MCP server instead:

```bash
skills mcp --register all
```

The OSS package does not include a database-backed MCP catalog service,
migrations, hosted API server, or installer implementation. Those concerns
belong in the hosted platform or an external MCP management service.
