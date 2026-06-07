# evm-tx-decoder

Decode EVM calldata into selectors, known ABI signatures, and 32-byte words.

## Quick Reference

```bash
bun run src/index.ts --selector 0xa9059cbb
bun run src/index.ts --data 0xa9059cbb...
bun run src/index.ts --list
bun run src/index.ts --json --data 0x...
```

## Agent Integration

Register the root Skills MCP server instead of copying this skill locally:

```bash
skills mcp --register all
```
