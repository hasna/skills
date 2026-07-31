import { CANVAS, MARGIN, SAFE } from "./constants.js";
import { FONT_STACK, initialsOf, pick, polygonPoints, round, xmlEscape } from "./palette.js";
import type { Geometry, Palette } from "./types.js";

const CONTAINERS = ["circle", "squircle", "hexagon", "shield"] as const;

function containerShape(kind: (typeof CONTAINERS)[number], fill: string): string {
  const cx = CANVAS / 2;
  switch (kind) {
    case "circle":
      return `  <circle id="container" cx="${cx}" cy="${cx}" r="${SAFE / 2}" fill="${fill}"/>`;
    case "squircle":
      return `  <rect id="container" x="${MARGIN}" y="${MARGIN}" width="${SAFE}" height="${SAFE}" rx="${round(
        SAFE * 0.26,
      )}" fill="${fill}"/>`;
    case "hexagon":
      return `  <polygon id="container" points="${polygonPoints(cx, cx, SAFE / 2, 6, -Math.PI / 2)}" fill="${fill}"/>`;
    default:
      return `  <path id="container" d="M ${cx} ${MARGIN} L ${CANVAS - MARGIN} ${MARGIN + 26} L ${
        CANVAS - MARGIN
      } ${cx + 18} Q ${CANVAS - MARGIN} ${CANVAS - MARGIN} ${cx} ${CANVAS - MARGIN} Q ${MARGIN} ${
        CANVAS - MARGIN
      } ${MARGIN} ${cx + 18} L ${MARGIN} ${MARGIN + 26} Z" fill="${fill}"/>`;
  }
}

export const GEOMETRIES: Geometry[] = [
  {
    name: "monogram",
    build: ({ rng, palette, brand }) => {
      const container = pick(rng, CONTAINERS);
      const initials = initialsOf(brand);
      const fontSize = initials.length > 1 ? 92 : 118;
      const barY = CANVAS - MARGIN - 14;
      return {
        description: `Brand initials "${initials}" knocked out of a solid ${container} container with an accent underline.`,
        body: [
          containerShape(container, palette.primary),
          `  <text id="monogram" x="${CANVAS / 2}" y="${CANVAS / 2 + 2}" text-anchor="middle" dominant-baseline="central" font-family="${FONT_STACK}" font-size="${fontSize}" font-weight="700" letter-spacing="-2" fill="${palette.background}">${xmlEscape(
            initials,
          )}</text>`,
          `  <rect id="accent-bar" x="${CANVAS / 2 - 26}" y="${barY}" width="52" height="8" rx="4" fill="${palette.accent}"/>`,
        ].join("\n"),
      };
    },
  },
  {
    name: "glyph-grid",
    build: ({ rng, palette }) => {
      const cells = rng() > 0.5 ? 4 : 3;
      const gap = 10;
      const size = (SAFE - gap * (cells - 1)) / cells;
      const parts: string[] = [];
      const half = Math.ceil(cells / 2);
      const plan: string[][] = [];
      for (let row = 0; row < cells; row += 1) {
        const rowPlan: string[] = [];
        for (let col = 0; col < half; col += 1) {
          const roll = rng();
          rowPlan.push(roll < 0.22 ? "none" : roll < 0.52 ? "square" : roll < 0.8 ? "circle" : "triangle");
        }
        for (let col = 0; col < cells; col += 1) {
          rowPlan[col] = rowPlan[col] ?? rowPlan[cells - 1 - col];
        }
        plan.push(rowPlan);
      }
      let filled = 0;
      for (let row = 0; row < cells; row += 1) {
        for (let col = 0; col < cells; col += 1) {
          const shape = plan[row][col];
          if (shape === "none") continue;
          filled += 1;
          const x = MARGIN + col * (size + gap);
          const y = MARGIN + row * (size + gap);
          const fill = (row + col) % 2 === 0 ? palette.primary : palette.accent;
          if (shape === "square") {
            parts.push(
              `  <rect x="${round(x)}" y="${round(y)}" width="${round(size)}" height="${round(size)}" rx="${round(
                size * 0.22,
              )}" fill="${fill}"/>`,
            );
          } else if (shape === "circle") {
            parts.push(
              `  <circle cx="${round(x + size / 2)}" cy="${round(y + size / 2)}" r="${round(size / 2)}" fill="${fill}"/>`,
            );
          } else {
            parts.push(
              `  <polygon points="${round(x + size / 2)},${round(y)} ${round(x + size)},${round(
                y + size,
              )} ${round(x)},${round(y + size)}" fill="${fill}"/>`,
            );
          }
        }
      }
      return {
        description: `${cells}x${cells} modular glyph grid, mirrored across the vertical axis, ${filled} active cells alternating primary and accent.`,
        body: `  <g id="glyph-grid">\n${parts.join("\n")}\n  </g>`,
      };
    },
  },
  {
    name: "orbit",
    build: ({ rng, palette }) => {
      const cx = CANVAS / 2;
      const ringWidth = 14 + Math.floor(rng() * 8);
      const outer = SAFE / 2 - ringWidth / 2;
      const gapDegrees = 40 + Math.floor(rng() * 50);
      const circumference = 2 * Math.PI * outer;
      const dash = circumference * (1 - gapDegrees / 360);
      const rotation = Math.floor(rng() * 360);
      const dotAngle = ((rotation - 90 + gapDegrees / 2) * Math.PI) / 180;
      return {
        description: `Open orbital ring with a ${gapDegrees} degree aperture, a solid accent core, and a satellite dot on the ring path.`,
        body: [
          `  <g id="orbit" transform="rotate(${rotation} ${cx} ${cx})">`,
          `    <circle cx="${cx}" cy="${cx}" r="${round(outer)}" fill="none" stroke="${palette.primary}" stroke-width="${ringWidth}" stroke-linecap="round" stroke-dasharray="${round(
            dash,
          )} ${round(circumference - dash)}"/>`,
          `  </g>`,
          `  <circle id="core" cx="${cx}" cy="${cx}" r="${round(outer * 0.42)}" fill="${palette.accent}"/>`,
          `  <circle id="satellite" cx="${round(cx + outer * Math.cos(dotAngle))}" cy="${round(
            cx + outer * Math.sin(dotAngle),
          )}" r="${round(ringWidth * 0.62)}" fill="${palette.secondary}"/>`,
        ].join("\n"),
      };
    },
  },
  {
    name: "chevron-stack",
    build: ({ rng, palette }) => {
      const layers = 3 + Math.floor(rng() * 2);
      const thickness = 16 + Math.floor(rng() * 6);
      const spacing = SAFE / (layers + 1);
      const parts: string[] = [];
      for (let i = 0; i < layers; i += 1) {
        const y = MARGIN + spacing * (i + 0.5);
        const inset = i * 10;
        const fill = i % 2 === 0 ? palette.primary : palette.accent;
        parts.push(
          `    <polyline points="${round(MARGIN + inset)},${round(y)} ${CANVAS / 2},${round(
            y + spacing * 0.58,
          )} ${round(CANVAS - MARGIN - inset)},${round(y)}" fill="none" stroke="${fill}" stroke-width="${thickness}" stroke-linecap="round" stroke-linejoin="round"/>`,
        );
      }
      return {
        description: `${layers} nested chevrons with ${thickness}px strokes reading as forward motion or an upward stack.`,
        body: `  <g id="chevron-stack">\n${parts.join("\n")}\n  </g>`,
      };
    },
  },
  {
    name: "prism",
    build: ({ rng, palette }) => {
      const cx = CANVAS / 2;
      const radius = SAFE / 2;
      const rotationA = Math.floor(rng() * 60);
      const rotationB = rotationA + 120 + Math.floor(rng() * 60);
      return {
        description: `Two overlapping equilateral triangles rotated ${rotationA} and ${rotationB} degrees, forming a translucent prism intersection.`,
        body: [
          `  <g id="prism">`,
          `    <polygon points="${polygonPoints(cx, cx, radius, 3, -Math.PI / 2)}" fill="${palette.primary}" transform="rotate(${rotationA} ${cx} ${cx})"/>`,
          `    <polygon points="${polygonPoints(cx, cx, radius, 3, -Math.PI / 2)}" fill="${palette.accent}" fill-opacity="0.78" transform="rotate(${rotationB} ${cx} ${cx})"/>`,
          `  </g>`,
        ].join("\n"),
      };
    },
  },
  {
    name: "aperture",
    build: ({ rng, palette }) => {
      const cx = CANVAS / 2;
      const blades = 5 + Math.floor(rng() * 3);
      const inner = SAFE * 0.16;
      const outer = SAFE / 2;
      const parts: string[] = [];
      for (let i = 0; i < blades; i += 1) {
        const angle = (360 / blades) * i;
        const fill = i % 2 === 0 ? palette.primary : palette.accent;
        parts.push(
          `    <path d="M ${round(cx)} ${round(cx - inner)} L ${round(cx + outer * 0.62)} ${round(
            cx - outer * 0.78,
          )} A ${round(outer)} ${round(outer)} 0 0 1 ${round(cx + outer * 0.95)} ${round(cx - outer * 0.2)} Z" fill="${fill}" transform="rotate(${round(
            angle,
          )} ${cx} ${cx})"/>`,
        );
      }
      return {
        description: `${blades}-blade aperture rotating around a hollow center, alternating primary and accent fills.`,
        body: [
          `  <g id="aperture">`,
          ...parts,
          `    <circle cx="${cx}" cy="${cx}" r="${round(inner * 0.9)}" fill="${palette.secondary}"/>`,
          `  </g>`,
        ].join("\n"),
      };
    },
  },
  {
    name: "layer-stack",
    build: ({ rng, palette }) => {
      const layers = 3;
      const height = 34 + Math.floor(rng() * 10);
      const skew = 18 + Math.floor(rng() * 14);
      const parts: string[] = [];
      for (let i = 0; i < layers; i += 1) {
        const y = MARGIN + 18 + i * (height + 12);
        const fill = i === 1 ? palette.accent : palette.primary;
        const opacity = i === 2 ? "0.72" : "1";
        parts.push(
          `    <polygon points="${round(MARGIN + skew)},${round(y)} ${round(CANVAS - MARGIN)},${round(
            y,
          )} ${round(CANVAS - MARGIN - skew)},${round(y + height)} ${MARGIN},${round(y + height)}" fill="${fill}" fill-opacity="${opacity}"/>`,
        );
      }
      return {
        description: `Three offset parallelogram layers with a ${skew}px shear, reading as stacked planes or data layers.`,
        body: `  <g id="layer-stack">\n${parts.join("\n")}\n  </g>`,
      };
    },
  },
  {
    name: "arc-mark",
    build: ({ rng, palette }) => {
      const cx = CANVAS / 2;
      const strokes = 2 + Math.floor(rng() * 2);
      const width = 18 + Math.floor(rng() * 8);
      const parts: string[] = [];
      for (let i = 0; i < strokes; i += 1) {
        const radius = SAFE / 2 - i * (width + 10);
        if (radius < width) break;
        const sweep = i % 2 === 0 ? 1 : 0;
        const fill = i % 2 === 0 ? palette.primary : palette.accent;
        parts.push(
          `    <path d="M ${round(cx - radius)} ${cx} A ${round(radius)} ${round(radius)} 0 0 ${sweep} ${round(
            cx + radius,
          )} ${cx}" fill="none" stroke="${fill}" stroke-width="${width}" stroke-linecap="round"/>`,
        );
      }
      return {
        description: `${parts.length} alternating half-arcs of ${width}px weight forming a rising, balanced mark.`,
        body: `  <g id="arc-mark">\n${parts.join("\n")}\n  </g>`,
      };
    },
  },
];

/* ------------------------------------------------------------------ */
/* document assembly                                                   */
/* ------------------------------------------------------------------ */

export function svgDocument(options: {
  width: number;
  height: number;
  title: string;
  description: string;
  background?: string;
  body: string;
}): string {
  const backdrop = options.background
    ? `  <rect id="backdrop" width="${options.width}" height="${options.height}" fill="${options.background}"/>\n`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${options.width} ${options.height}" width="${options.width}" height="${options.height}" role="img" aria-labelledby="title desc">
  <title id="title">${xmlEscape(options.title)}</title>
  <desc id="desc">${xmlEscape(options.description)}</desc>
${backdrop}${options.body}
</svg>
`;
}

export function buildLockup(options: {
  brand: string;
  tagline: string;
  markBody: string;
  palette: Palette;
  background: boolean;
}): string {
  const width = 720;
  const height = 200;
  const scale = 0.55;
  const markSize = CANVAS * scale;
  const markX = 40;
  const markY = (height - markSize) / 2;
  const textX = markX + markSize + 36;
  const brandSize = 60;
  const hasTagline = options.tagline.trim().length > 0;
  const brandY = hasTagline ? height / 2 - 10 : height / 2;

  const body = [
    `  <g id="mark" transform="translate(${markX} ${round(markY)}) scale(${scale})">`,
    options.markBody
      .split("\n")
      .map((line) => (line ? `  ${line}` : line))
      .join("\n"),
    `  </g>`,
    `  <text id="wordmark" x="${textX}" y="${round(brandY)}" dominant-baseline="central" font-family="${FONT_STACK}" font-size="${brandSize}" font-weight="700" letter-spacing="-1.5" fill="${options.palette.primary}">${xmlEscape(
      options.brand,
    )}</text>`,
  ];

  if (hasTagline) {
    body.push(
      `  <text id="tagline" x="${textX}" y="${round(height / 2 + 40)}" dominant-baseline="central" font-family="${FONT_STACK}" font-size="22" font-weight="500" letter-spacing="0.5" fill="${options.palette.secondary}">${xmlEscape(
        options.tagline,
      )}</text>`,
    );
  }

  return svgDocument({
    width,
    height,
    title: `${options.brand} horizontal lockup`,
    description: `Horizontal lockup pairing the ${options.brand} mark with the wordmark.`,
    background: options.background ? options.palette.background : undefined,
    body: body.join("\n"),
  });
}

/* ------------------------------------------------------------------ */
/* cli                                                                 */
/* ------------------------------------------------------------------ */


