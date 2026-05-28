# icon-pack

Generate a coordinated set of high-quality icons for a theme and receive them as SVGs and transparent PNGs.

## Quick start

```bash
icon-pack --theme "finance app, line, geometric" --count 48 --sizes 256,512
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--theme` | Theme description | required |
| `--style` | `line`, `filled`, or `duotone` | `line` |
| `--count` | Number of icons | `48` |
| `--sizes` | Comma-separated PNG sizes | `256,512` |
| `--out` | Output directory | `./icon-pack` |

## Output

```
icon-pack/
├── manifest.csv
├── svg/
└── png/
```
