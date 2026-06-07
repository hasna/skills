---
name: onchain-skill-loader
description: Offline EVM development reference — function selectors, chain IDs, and Web3 hints from bundled data. Use when decoding EVM transactions, looking up function selectors, smart contract debugging, Web3 development, or working with ERC-20 and common contract patterns.
displayName: EVM Reference Bundle
category: Development Tools
tags: [web3, evm, reference, selectors, smart-contracts, erc20, development]
---

# EVM Reference Bundle

Bundled reference data for Web3 development. Fully offline.

## Usage

```bash
skills run onchain-skill-loader --json
```

## Data

Read `data/reference.json`:

- `common_selectors` — signature → hex selector
- `chains` — chain IDs
- `hints` — development notes

## Agent workflow

1. Load `data/reference.json` when skill activates
2. Use selectors and hints for the user's task
