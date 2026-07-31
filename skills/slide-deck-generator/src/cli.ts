import { AUDIENCES, FORMATS, THEMES, type CliOptions } from "./types.js";

const VERSION = "0.1.0";

function printHelp(): void {
  console.log(`slide-deck-generator v${VERSION}

USAGE:
  slide-deck-generator --brief "<text>" [options]
  slide-deck-generator --source <outline.md> [options]

OPTIONS:
  -b, --brief <text>      Brief, outline, or narrative text. A bare positional also works.
  -s, --source <path>     Read the brief/outline from a Markdown or text file.
  -t, --title <text>      Deck title (default: first heading, or first line of the brief)
  -n, --slides <n>        Target slide count (default: 8)
      --theme <name>      ${Object.keys(THEMES).join(" | ")} (default: midnight)
      --audience <type>   ${AUDIENCES.join(" | ")} (default: team)
      --format <type>     ${FORMATS.join(" | ")} (default: general)
  -o, --output <dir>      Output directory (default: ./slide-deck)
      --no-pptx           Skip deck.pptx rendering (all other files still emitted)
      --json              Print the manifest as JSON instead of a text summary
  -h, --help              Show this help message
  -v, --version           Show the current version

EXAMPLES:
  slide-deck-generator --brief "Q2 launch review for AI billing" --slides 10 --theme aurora
  slide-deck-generator --source ./outline.md --audience executives --output ./out
`);
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    audience: "team",
    format: "general",
    slides: 8,
    theme: "midnight",
    output: "./slide-deck",
    json: false,
    noPptx: false,
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
      case "--source":
      case "-s":
        options.source = argv[++i];
        break;
      case "--title":
      case "-t":
        options.title = argv[++i];
        break;
      case "--slides":
      case "-n": {
        const value = Number.parseInt(argv[++i] ?? "", 10);
        if (!Number.isFinite(value) || value < 1 || value > 60) {
          throw new Error(`Invalid --slides value: ${argv[i]}. Use 1-60.`);
        }
        options.slides = value;
        break;
      }
      case "--theme": {
        const value = (argv[++i] ?? "").toLowerCase();
        if (!THEMES[value]) {
          throw new Error(`Unknown --theme: ${value}. Available: ${Object.keys(THEMES).join(", ")}`);
        }
        options.theme = value;
        break;
      }
      case "--audience": {
        const value = (argv[++i] ?? "").toLowerCase();
        if (!AUDIENCES.includes(value)) {
          throw new Error(`Unknown --audience: ${value}. Available: ${AUDIENCES.join(", ")}`);
        }
        options.audience = value;
        break;
      }
      case "--format": {
        const value = (argv[++i] ?? "").toLowerCase();
        if (!FORMATS.includes(value)) {
          throw new Error(`Unknown --format: ${value}. Available: ${FORMATS.join(", ")}`);
        }
        options.format = value;
        break;
      }
      case "--output":
      case "-o":
        options.output = argv[++i] ?? "./slide-deck";
        break;
      case "--no-pptx":
        options.noPptx = true;
        break;
      case "--json":
        options.json = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (!options.brief && !options.source) {
          options.brief = arg;
          break;
        }
        throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.brief && !options.source) {
    throw new Error("Provide --brief <text> or --source <file>. See --help.");
  }

  return options;
}

/* -------------------------------------------------------------------------- */
/* Text helpers                                                                */
/* -------------------------------------------------------------------------- */


