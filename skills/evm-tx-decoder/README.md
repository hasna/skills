# evm-tx-decoder

Decode Ethereum transaction calldata for Web3 debugging without RPC calls or API keys.

## Usage

```bash
skills run evm-tx-decoder --selector 0xa9059cbb
skills run evm-tx-decoder --data 0xa9059cbb000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa9604500000000000000000000000000000000000000000000000de0b6b3a7640000
skills run evm-tx-decoder --list
```

## Options

- `--data <hex>` — full calldata
- `--selector <hex>` — lookup a 4-byte selector
- `--list` — print common ERC/Uniswap selectors
- `--json` — machine-readable output
