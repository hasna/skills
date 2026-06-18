---
name: evm-tx-decoder
description: Decode EVM transaction calldata into function selectors, known ABI signatures, and 32-byte word layout. Use when debugging Ethereum transactions, analyzing smart contract calls, inspecting hex calldata, or working with Web3/EVM/blockchain tooling.
displayName: EVM Transaction Decoder
category: Development Tools
tags: [web3, ethereum, evm, blockchain, calldata, abi, solidity]
---

# EVM Transaction Decoder

Decode Ethereum calldata for Web3 debugging without external APIs or RPC calls.

## What It Does

- Extracts the 4-byte function selector from calldata
- Matches selectors against a built-in database of common ERC-20, ERC-721, ERC-1155, WETH, and Uniswap signatures
- Splits remaining bytes into 32-byte ABI words with hex offsets
- Validates hex input and reports byte length

## Usage

```bash
skills run evm-tx-decoder --data 0xa9059cbb000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa9604500000000000000000000000000000000000000000000000de0b6b3a7640000
```

```bash
skills run evm-tx-decoder --selector 0xa9059cbb
```

```bash
skills run evm-tx-decoder --list
```

## Options

| Option | Description |
|--------|-------------|
| `--data <hex>` | Full calldata hex string (with or without `0x`) |
| `--selector <hex>` | Lookup a 4-byte selector only |
| `--list` | Print common known selectors |
| `--json` | Machine-readable JSON output |

## Examples

**ERC-20 transfer:**
```
Selector: 0xa9059cbb
Signature: transfer(address,uint256)
Words:
  [0] to:    0xd8dA6Bf26964aF9D7eEd9e03E53415D37aA96045
  [1] amount: 1 ETH (1e18 wei)
```

## Requirements

- Bun runtime (installed with `@hasna/skills`)
- No API keys or network access required
