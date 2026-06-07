#!/usr/bin/env bun

const KNOWN_SELECTORS: Record<string, string> = {
  "0xa9059cbb": "transfer(address,uint256)",
  "0x23b872dd": "transferFrom(address,address,uint256)",
  "0x095ea7b3": "approve(address,uint256)",
  "0xdd62ed3e": "allowance(address,address)",
  "0x70a08231": "balanceOf(address)",
  "0x18160ddd": "totalSupply()",
  "0x06fdde03": "name()",
  "0x95d89b41": "symbol()",
  "0x313ce567": "decimals()",
  "0x42842e0e": "safeTransferFrom(address,address,uint256)",
  "0xb88d4fde": "safeTransferFrom(address,address,uint256,bytes)",
  "0x6352211e": "ownerOf(uint256)",
  "0x42966c68": "burn(uint256)",
  "0xa22cb465": "setApprovalForAll(address,bool)",
  "0xe985e9c5": "isApprovedForAll(address,address)",
  "0xf242432a": "safeTransferFrom(address,address,uint256,uint256,bytes)",
  "0x2eb2c2d6": "safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)",
  "0xd0e30db0": "deposit()",
  "0x2e1a7d4d": "withdraw(uint256)",
  "0x7ff36ab5": "swapExactETHForTokens(uint256,address[],address,uint256)",
  "0x38ed1739": "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
  "0x18cbafe5": "swapExactTokensForETH(uint256,uint256,address[],address,uint256)",
  "0x4a25d94a": "claim()",
  "0x3ccfd60b": "withdraw()",
  "0x1249c58b": "mint()",
  "0x40c10f19": "mint(address,uint256)",
};

interface DecodeResult {
  selector: string;
  signature: string | null;
  byteLength: number;
  words: Array<{ index: number; offset: number; hex: string; address?: string; uint256?: string }>;
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--list") args.list = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--data" && argv[i + 1]) { args.data = argv[++i]; }
    else if (arg === "--selector" && argv[i + 1]) { args.selector = argv[++i]; }
  }
  return args;
}

function normalizeHex(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-f]*$/.test(hex)) throw new Error("Invalid hex: only 0-9 and a-f allowed");
  if (hex.length % 2 !== 0) throw new Error("Invalid hex: odd number of nibbles");
  return hex;
}

function formatSelector(hex: string): string {
  const clean = normalizeHex(hex);
  if (clean.length !== 8) throw new Error("Selector must be exactly 4 bytes (8 hex chars)");
  return `0x${clean}`;
}

function lookupSignature(selector: string): string | null {
  return KNOWN_SELECTORS[selector.toLowerCase()] ?? null;
}

function formatUint256(word: string): string {
  const value = BigInt(`0x${word}`);
  if (value === 0n) return "0";
  const eth = Number(value) / 1e18;
  if (eth >= 0.000001 && eth <= 1e15) return `${value.toString()} (${eth} if 18 decimals)`;
  return value.toString();
}

function decodeCalldata(data: string): DecodeResult {
  const hex = normalizeHex(data);
  if (hex.length < 8) throw new Error("Calldata must be at least 4 bytes for a selector");

  const selector = `0x${hex.slice(0, 8)}`;
  const payload = hex.slice(8);
  const words: DecodeResult["words"] = [];

  for (let i = 0; i < payload.length; i += 64) {
    const chunk = payload.slice(i, i + 64).padEnd(64, "0");
    const index = i / 64;
    const word: DecodeResult["words"][number] = {
      index,
      offset: 4 + index * 32,
      hex: `0x${chunk}`,
    };

    const sig = lookupSignature(selector);
    if (sig?.includes("address") && chunk.slice(0, 24) === "0".repeat(24)) {
      word.address = `0x${chunk.slice(24)}`;
    }
    if (sig?.includes("uint256") || sig?.includes("uint")) {
      word.uint256 = formatUint256(chunk);
    }
    words.push(word);
  }

  return {
    selector,
    signature: lookupSignature(selector),
    byteLength: hex.length / 2,
    words,
  };
}

function printHelp() {
  console.log(`EVM Transaction Decoder

Usage:
  evm-tx-decoder --data <hex>        Decode full calldata
  evm-tx-decoder --selector <hex>    Lookup known signature
  evm-tx-decoder --list              List common selectors
  evm-tx-decoder --json --data <hex> JSON output

Examples:
  evm-tx-decoder --selector 0xa9059cbb
  evm-tx-decoder --data 0xa9059cbb000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa9604500000000000000000000000000000000000000000000000de0b6b3a7640000`);
}

function printList() {
  const entries = Object.entries(KNOWN_SELECTORS).sort((a, b) => a[1].localeCompare(b[1]));
  console.log(`Known selectors (${entries.length}):\n`);
  for (const [sel, sig] of entries) {
    console.log(`  ${sel}  ${sig}`);
  }
}

function printDecode(result: DecodeResult) {
  console.log(`Selector:  ${result.selector}`);
  console.log(`Signature: ${result.signature ?? "(unknown — not in built-in database)"}`);
  console.log(`Length:    ${result.byteLength} bytes`);
  if (result.words.length === 0) {
    console.log("Payload:   (empty — likely a zero-arg call or selector-only lookup)");
    return;
  }
  console.log(`\nABI words (${result.words.length}):`);
  for (const word of result.words) {
    let line = `  [${word.index}] offset ${word.offset}: ${word.hex}`;
    if (word.address) line += ` → address ${word.address}`;
    if (word.uint256) line += ` → uint256 ${word.uint256}`;
    console.log(line);
  }
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

if (args.list) {
  printList();
  process.exit(0);
}

try {
  if (args.selector) {
    const selector = formatSelector(String(args.selector));
    const signature = lookupSignature(selector);
    const payload = { selector, signature, known: signature !== null };
    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(`Selector:  ${selector}`);
      console.log(`Signature: ${signature ?? "(unknown)"}`);
    }
    process.exit(0);
  }

  if (!args.data) {
    printHelp();
    process.exit(1);
  }

  const result = decodeCalldata(String(args.data));
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else printDecode(result);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (args.json) console.log(JSON.stringify({ error: message }));
  else console.error(`Error: ${message}`);
  process.exit(1);
}
