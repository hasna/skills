import { VERSION } from "./constants.js";
import { normalizeHex } from "./palette.js";
import type { CliOptions } from "./types.js";

function printHelp(): void {
  console.log(`logo-design v${VERSION}

Generate deterministic geometric logo marks as SVG. No network access and no
API keys: every mark is composed locally from a hash of your brief, so the same
inputs always produce the same output.

USAGE:
  logo-design --brief <text> [options]
  logo-design "<brief text>" [options]

OPTIONS:
  -b, --brief <text>        Logo brief (positional text also works)   [required]
      --brand <name>        Brand or product name                     [Brand]
      --style <text>        Style direction, recorded in the brief    [clean geometric mark]
      --palette <list>      Comma-separated colors: names or hex      [navy,white,accent]
  -n, --variations <1-6>    Number of concepts to generate            [3]
  -o, --output <dir>        Output directory                          [./logo-design]
      --background          Draw a solid backdrop rect in each SVG    [off, transparent]
      --png                 Also rasterize PNGs (requires sharp)      [off]
      --png-size <px>       PNG width/height when --png is used       [512]
      --json                Print the run summary as JSON
      --help                Show this help message
      --version             Show the current version

OUTPUTS:
  vector/logo-NN.svg        Standalone mark, 256x256 viewBox
  vector/logo-NN-lockup.svg Horizontal mark + wordmark lockup
  png/logo-NN.png           Optional raster export (--png)
  concepts.json             Per-variant seed, geometry, palette, rationale
  logo-brief.md             The brief as interpreted by this run
  usage-notes.md            Clear space, minimum sizes, do / don't
  manifest.json             Every file written, with byte sizes

EXAMPLES:
  logo-design --brief "minimal geometric owl mark for a developer tool" --brand Acme
  logo-design "vintage badge for a coffee roaster" --palette "#2B1B12,cream,rust" -n 4
  logo-design --brief "ledger app" --brand Ledgerly --png --png-size 1024
`);
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    brand: "Brand",
    style: "clean geometric mark",
    palette: "navy,white,accent",
    variations: 3,
    output: "./logo-design",
    png: false,
    pngSize: 512,
    background: false,
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
      case "--brief":
      case "-b":
        options.brief = argv[++i];
        break;
      case "--brand":
        options.brand = argv[++i] ?? options.brand;
        break;
      case "--style":
        options.style = argv[++i] ?? options.style;
        break;
      case "--palette":
        options.palette = argv[++i] ?? options.palette;
        break;
      case "--variations":
      case "-n": {
        const value = Number.parseInt(argv[++i] ?? "", 10);
        if (!Number.isFinite(value) || value < 1 || value > 6) {
          throw new Error(`Invalid --variations value: ${argv[i]} (expected 1-6)`);
        }
        options.variations = value;
        break;
      }
      case "--output":
      case "-o":
        options.output = argv[++i] ?? options.output;
        break;
      case "--background":
        options.background = true;
        break;
      case "--png":
        options.png = true;
        break;
      case "--png-size": {
        const value = Number.parseInt(argv[++i] ?? "", 10);
        if (!Number.isFinite(value) || value < 16 || value > 4096) {
          throw new Error(`Invalid --png-size value: ${argv[i]} (expected 16-4096)`);
        }
        options.pngSize = value;
        break;
      }
      case "--json":
        options.json = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (!options.brief) {
          options.brief = arg;
          break;
        }
        throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.brief || options.brief.trim() === "") {
    throw new Error("Missing required --brief <text> argument (a positional brief also works)");
  }

  return options;
}


