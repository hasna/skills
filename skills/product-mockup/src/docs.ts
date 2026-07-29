import type { CliOptions, VariantPlan } from "./types.js";

export function imagePrompts(options: CliOptions, plans: VariantPlan[]): string {
  return `# Image prompts — ${options.product}

The SVG frames in \`variants/\` are drawn deterministically by this skill and are
ready to use as-is. This file is the *other* half: written prompts you can paste
into whichever image model you use. **This skill never calls an image model and
never needs a key** — copy a prompt out and run it wherever you like.

- Product: ${options.product}
- Audience: ${options.audience}
- Style direction: ${options.style}
- Scene family: ${options.scene}

## Prompt anatomy

\`\`\`
<subject and surface> , <composition> , <lighting> , <color> , <finish> , <negatives>
\`\`\`

Keep the subject concrete, name the camera position, and always add negatives —
image models over-decorate product shots by default.

${plans
  .map(
    (plan) => `## ${plan.id} — ${plan.scene}${plan.device ? ` (${plan.device})` : ""}

**Prompt**

> ${promptFor(options, plan)}

**Negative prompt**

> lorem ipsum text, garbled letterforms, watermark, stock-photo people, heavy drop shadows, lens flare, skeuomorphic gradients, cluttered UI, extra fingers, distorted geometry

**Settings to try**: ${plan.width}x${plan.height} (matches \`${plan.file}\`), guidance 5-7, 2 seeds per prompt.
`,
  )
  .join("\n")}
## Compositing recipe

1. Render the prompt above at the same aspect ratio as the matching SVG.
2. Open the SVG, delete the \`canvas\` layer, and export the frame with a transparent background.
3. Place the generated image behind the frame — the SVG layer names in
   \`asset-metadata.json\` tell you exactly what each group is.
4. Keep the real UI text in the SVG layer. Image models still cannot render legible product copy.
`;
}

function promptFor(options: CliOptions, plan: VariantPlan): string {
  const surface =
    plan.scene === "dashboard"
      ? "a wide analytics dashboard screen floating on a soft studio backdrop"
      : plan.device === "phone"
        ? "a modern smartphone held upright, screen facing the camera"
        : plan.device === "laptop"
          ? "an open thin-bezel laptop on a clean desk, screen facing the camera"
          : "a desktop browser window floating in a clean studio space";
  const tone = plan.tokens.dark ? "low-key lighting, deep charcoal background" : "bright even lighting, soft neutral background";
  return `Product marketing shot of ${surface} showing ${options.product} for ${options.audience}, ${options.style}, three-quarter camera at eye level with a slight perspective, ${tone}, accent color ${plan.tokens.accent}, crisp focus edge to edge, subtle contact shadow, high-detail render, no text artifacts`;
}

export function mockupBrief(options: CliOptions, plans: VariantPlan[]): string {
  return `# Mockup brief — ${options.product}

| Field | Value |
|-------|-------|
| Product | ${options.product} |
| Headline in frame | ${options.title ?? options.product} |
| Audience | ${options.audience} |
| Scene | ${options.scene} |
| Style input | ${options.style} |
| Style preset matched | ${plans[0].tokens.name} |
| Variants | ${options.variants} |

## What was generated

${plans
  .map(
    (plan) =>
      `- **${plan.id}** — ${plan.notes} Accent \`${plan.tokens.accent}\`, surface \`${plan.tokens.surface}\`, seed \`${plan.seed}\`.`,
  )
  .join("\n")}

## Reproducibility

Variant geometry is seeded from the product text, scene, style, and variant
index. Re-running the same command reproduces the same SVGs exactly. Change
\`--style\` or \`--accent\` to move the palette without changing the layout.
`;
}

export function usageNotes(options: CliOptions, plans: VariantPlan[]): string {
  return `# Usage notes

## Editing

Every frame is plain SVG with named groups. Open it in Figma (File > Import),
Illustrator, Inkscape, or a text editor. The group ids are listed per file in
\`asset-metadata.json\`; the common ones are:

- \`canvas\` — the full-bleed background rect. Delete it for a transparent export.
- \`chrome\` / \`device-body\` / \`lid\` — the frame hardware.
- \`page-content\` / \`app-content\` / \`app-window\` — the screen contents you will
  usually replace with a real screenshot.
- \`kpi-row\`, \`chart-bar\`, \`chart-line\`, \`table\` — dashboard modules.

## Dropping in a real screenshot

1. Delete the content group (\`page-content\`, \`app-content\`, or the dashboard modules).
2. Place your screenshot and clip it to the \`screen\` rect.
3. Keep the frame hardware on top so the bezel corners stay clean.

## Exporting

\`\`\`bash
# any SVG renderer works; here are two common ones
rsvg-convert -w 2560 variants/variant-01.svg -o variant-01@2x.png
inkscape variants/variant-01.svg --export-type=png --export-width=2560
\`\`\`

## Sizes in this package

${plans.map((plan) => `- \`${plan.file}\` — ${plan.width}x${plan.height}`).join("\n")}

## Color

The accent rotates per variant so a set reads as a family rather than a repeat.
Pass \`--accent "#RRGGBB"\` to lock every variant to your brand color.
`;
}


