import { normalizeHex } from "./design.js";
import type { CliOptions } from "./types.js";

const VERSION = "0.1.0";

function printHelp(): void {
  console.log(`product-mockup v${VERSION}

Emit parametric SVG product mockup frames. Everything is drawn locally as real
SVG geometry: no image model, no network access, no API keys. The package also
includes written image prompts you can hand to an image model yourself.

USAGE:
  product-mockup --product <text> [options]
  product-mockup "<product text>" [options]

OPTIONS:
  -p, --product <text>      Product, feature, or campaign (positional works)  [required]
      --title <text>        Headline rendered inside the frame     [product text]
  -s, --scene <name>        browser | device | dashboard           [browser]
      --device <kind>       auto | phone | laptop (scene=device)   [auto]
  -n, --variants <1-4>      Number of mockup variants              [3]
      --style <text>        Style direction keyword or phrase      [polished SaaS, crisp product UI]
      --audience <text>     Target audience, recorded in the brief [software buyers]
      --accent <hex>        Force the accent color (#RRGGBB)       [derived from style]
      --url <text>          URL shown in the browser address pill  [https://example.com]
  -o, --output <dir>        Output directory                       [./product-mockup]
      --json                Print the run summary as JSON
      --help                Show this help message
      --version             Show the current version

STYLE KEYWORDS:
  polished (default) | noir/dark | warm | editorial | technical | vivid

OUTPUTS:
  variants/variant-NN.svg   Real SVG frames, one per variant
  scene-plan.json           Scene, tokens, and seed for every variant
  asset-metadata.json       Dimensions, viewBox, and layer names per file
  image-prompts.md          Text prompts for your own image model
  mockup-brief.md           Brief, audience, and style interpretation
  usage-notes.md            How to edit, export, and place the frames
  manifest.json             Every file written, with byte sizes

EXAMPLES:
  product-mockup "Usage-based billing dashboard" --scene dashboard -n 3
  product-mockup --product "AI meeting assistant" --scene device --device phone
  product-mockup -p "MeterKit" --scene browser --style noir --url https://example.com
`);
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    scene: "browser",
    device: "auto",
    variants: 3,
    style: "polished SaaS, crisp product UI",
    audience: "software buyers",
    url: "https://example.com",
    output: "./product-mockup",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      case "--version":
      case "-v":
        console.log(VERSION);
        process.exit(0);
      case "--product":
      case "-p":
        options.product = argv[++i];
        break;
      case "--title":
        options.title = argv[++i];
        break;
      case "--scene":
      case "-s": {
        const value = (argv[++i] ?? "").toLowerCase();
        if (value !== "browser" && value !== "device" && value !== "dashboard") {
          throw new Error(`Invalid --scene value: ${value} (expected browser | device | dashboard)`);
        }
        options.scene = value;
        break;
      }
      case "--device": {
        const value = (argv[++i] ?? "").toLowerCase();
        if (value !== "auto" && value !== "phone" && value !== "laptop") {
          throw new Error(`Invalid --device value: ${value} (expected auto | phone | laptop)`);
        }
        options.device = value;
        break;
      }
      case "--variants":
      case "-n": {
        const value = Number.parseInt(argv[++i] ?? "", 10);
        if (!Number.isFinite(value) || value < 1 || value > 4) {
          throw new Error(`Invalid --variants value: ${argv[i]} (expected 1-4)`);
        }
        options.variants = value;
        break;
      }
      case "--style":
        options.style = argv[++i] ?? options.style;
        break;
      case "--audience":
        options.audience = argv[++i] ?? options.audience;
        break;
      case "--accent": {
        const value = normalizeHex(argv[++i] ?? "");
        if (!value) {
          throw new Error(`Invalid --accent value: ${argv[i]} (expected a hex color such as #2E86C1)`);
        }
        options.accent = value;
        break;
      }
      case "--url":
        options.url = argv[++i] ?? options.url;
        break;
      case "--output":
      case "-o":
        options.output = argv[++i] ?? options.output;
        break;
      case "--json":
        options.json = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (!options.product) {
          options.product = arg;
          break;
        }
        throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.product || options.product.trim() === "") {
    throw new Error("Missing required --product <text> argument (a positional description also works)");
  }

  return options;
}


