---
name: icon-pack
description: Generate a coordinated icon pack and return SVGs plus transparent PNGs. Use when a user asks for an icon set, icon pack, app icons, UI icons, or a coordinated set of glyphs for a brand or product.
---

# icon-pack

Generates a coordinated set of icons for a theme and returns them as SVGs and transparent PNGs at the sizes you request.

## Invocation

```
icon-pack --theme "<theme>" [--style line|filled|duotone] [--count 24|48|96] [--sizes 256,512] [--out ./icon-pack]
```

## Output

```
icon-pack/
├── manifest.csv         # name + tags per icon
├── svg/<name>.svg
└── png/<name>@<size>.png
```
