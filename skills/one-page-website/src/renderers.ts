import type { Palette, WebsiteFiles, WebsiteOptions, WebsiteSection } from "./types";
import { escapeAttr, escapeHtml, navLabel, slugify, titleCase } from "./utils";

export function renderHtml(options: WebsiteOptions, sections: WebsiteSection[]) {
  const nav = sections
    .filter((section) => section.kind !== "hero")
    .slice(0, 5)
    .map((section) => `<a href="#${escapeAttr(section.id)}">${escapeHtml(navLabel(section))}</a>`)
    .join("\n        ");

  const body = sections.map((section) => renderSection(section)).join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(options.name)}</title>
    <meta name="description" content="${escapeAttr(options.brief)}">
    <link rel="stylesheet" href="./styles.css">
  </head>
  <body>
    <header class="site-header">
      <a class="brand" href="#hero">${escapeHtml(options.name)}</a>
      <nav aria-label="Page sections">
        ${nav}
      </nav>
    </header>
    <main>
${body}
    </main>
    <script src="./script.js"></script>
  </body>
</html>
`;
}

function renderSection(section: WebsiteSection) {
  if (section.kind === "hero") {
    return `      <section class="hero" id="${escapeAttr(section.id)}">
        <div class="hero-copy">
          <p class="eyebrow">${escapeHtml(section.eyebrow)}</p>
          <h1>${escapeHtml(section.headline)}</h1>
          <p class="lede">${escapeHtml(section.body)}</p>
          <a class="button" href="#cta">${escapeHtml(section.primaryCta)}</a>
        </div>
        <div class="product-panel" aria-label="Product preview">
          <div class="panel-bar"><span></span><span></span><span></span></div>
          <div class="metric-row"><strong>87%</strong><span>clearer handoffs</span></div>
          <div class="chart"><i></i><i></i><i></i><i></i></div>
          <div class="task-list">
            ${section.bullets.map((item) => `<span>${escapeHtml(item)}</span>`).join("\n            ")}
          </div>
        </div>
      </section>`;
  }

  if (section.kind === "pricing") {
    return `      <section class="band" id="${escapeAttr(section.id)}">
        <p class="eyebrow">${escapeHtml(section.eyebrow)}</p>
        <h2>${escapeHtml(section.headline)}</h2>
        <p>${escapeHtml(section.body)}</p>
        <div class="pricing-grid">
          ${section.bullets.map((item, index) => `<article><strong>${escapeHtml(item)}</strong><span>${index === 1 ? "Recommended" : "Clear scope"}</span><a href="#cta">${escapeHtml(section.primaryCta)}</a></article>`).join("\n          ")}
        </div>
      </section>`;
  }

  if (section.kind === "faq") {
    return `      <section class="band" id="${escapeAttr(section.id)}">
        <p class="eyebrow">${escapeHtml(section.eyebrow)}</p>
        <h2>${escapeHtml(section.headline)}</h2>
        <p>${escapeHtml(section.body)}</p>
        <div class="faq-list">
          ${section.bullets.map((item) => `<details><summary>${escapeHtml(item)}</summary><p>Keep this answer specific, short, and tied to the buying decision.</p></details>`).join("\n          ")}
        </div>
      </section>`;
  }

  return `      <section class="${section.kind === "cta" ? "final-cta" : "band"}" id="${escapeAttr(section.id)}">
        <p class="eyebrow">${escapeHtml(section.eyebrow)}</p>
        <h2>${escapeHtml(section.headline)}</h2>
        <p>${escapeHtml(section.body)}</p>
        <div class="feature-grid">
          ${section.bullets.map((item) => `<article><span></span><strong>${escapeHtml(item)}</strong></article>`).join("\n          ")}
        </div>
        <a class="button" href="mailto:hello@example.com?subject=${encodeURIComponent(section.primaryCta)}">${escapeHtml(section.primaryCta)}</a>
      </section>`;
}

export function renderCss(palette: Palette) {
  return `:root {
  color-scheme: light;
  --ink: ${palette.ink};
  --paper: ${palette.paper};
  --accent: ${palette.accent};
  --support: ${palette.support};
  --line: ${palette.line};
  --muted: color-mix(in srgb, var(--ink), white 46%);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
}

.site-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 18px clamp(20px, 5vw, 72px);
  background: color-mix(in srgb, var(--paper), white 70%);
  border-bottom: 1px solid var(--line);
  backdrop-filter: blur(18px);
}

.brand {
  color: var(--ink);
  font-weight: 800;
  text-decoration: none;
}

nav {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px 18px;
}

nav a {
  color: var(--muted);
  font-size: 0.92rem;
  text-decoration: none;
}

.hero,
.band,
.final-cta {
  padding: clamp(56px, 8vw, 112px) clamp(20px, 5vw, 72px);
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 0.84fr);
  gap: clamp(36px, 7vw, 96px);
  align-items: center;
  min-height: 84vh;
}

h1,
h2,
p {
  margin: 0;
}

h1 {
  max-width: 12ch;
  font-size: clamp(3.2rem, 8vw, 7.2rem);
  line-height: 0.92;
  letter-spacing: 0;
}

h2 {
  max-width: 15ch;
  font-size: clamp(2.1rem, 4.4vw, 4.2rem);
  line-height: 1;
  letter-spacing: 0;
}

.eyebrow {
  margin-bottom: 16px;
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

.lede,
.band > p,
.final-cta > p {
  max-width: 760px;
  margin-top: 20px;
  color: var(--muted);
  font-size: clamp(1rem, 1.4vw, 1.24rem);
  line-height: 1.7;
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  margin-top: 28px;
  padding: 0 20px;
  border: 1px solid var(--ink);
  border-radius: 8px;
  background: var(--ink);
  color: var(--paper);
  font-weight: 800;
  text-decoration: none;
}

.product-panel {
  min-height: 520px;
  padding: 28px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: white;
  box-shadow: 0 30px 90px rgb(0 0 0 / 0.12);
}

.panel-bar,
.metric-row,
.task-list span,
.feature-grid article,
.pricing-grid article,
details {
  border: 1px solid var(--line);
  border-radius: 8px;
}

.panel-bar {
  display: flex;
  gap: 8px;
  padding: 14px;
}

.panel-bar span,
.feature-grid span {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent);
}

.metric-row {
  display: flex;
  align-items: end;
  justify-content: space-between;
  margin-top: 22px;
  padding: 28px;
  background: var(--ink);
  color: var(--paper);
}

.metric-row strong {
  font-size: 4rem;
  line-height: 0.9;
}

.chart {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  align-items: end;
  gap: 16px;
  height: 180px;
  margin-top: 22px;
  padding: 24px;
  background: color-mix(in srgb, var(--support), white 78%);
  border-radius: 8px;
}

.chart i {
  display: block;
  min-height: 42px;
  border-radius: 8px 8px 0 0;
  background: var(--accent);
}

.chart i:nth-child(2) { height: 82px; }
.chart i:nth-child(3) { height: 132px; }
.chart i:nth-child(4) { height: 164px; }

.task-list,
.feature-grid,
.pricing-grid,
.faq-list {
  display: grid;
  gap: 14px;
  margin-top: 24px;
}

.task-list span,
.feature-grid article,
.pricing-grid article,
details {
  padding: 18px;
  background: white;
}

.feature-grid,
.pricing-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.feature-grid article {
  display: flex;
  align-items: center;
  gap: 12px;
}

.pricing-grid article {
  display: grid;
  gap: 16px;
}

.pricing-grid a {
  color: var(--accent);
  font-weight: 800;
}

summary {
  cursor: pointer;
  font-weight: 800;
}

details p {
  margin-top: 12px;
  color: var(--muted);
  line-height: 1.6;
}

.final-cta {
  background: var(--ink);
  color: var(--paper);
}

.final-cta .eyebrow,
.final-cta p {
  color: color-mix(in srgb, var(--paper), white 70%);
}

.final-cta .button {
  background: var(--paper);
  color: var(--ink);
}

@media (max-width: 820px) {
  .site-header {
    align-items: flex-start;
    flex-direction: column;
  }

  nav {
    justify-content: flex-start;
  }

  .hero {
    grid-template-columns: 1fr;
    min-height: auto;
  }

  h1 {
    max-width: 10ch;
  }

  .product-panel {
    min-height: 420px;
  }

  .feature-grid,
  .pricing-grid {
    grid-template-columns: 1fr;
  }
}
`;
}

export function renderScript() {
  return `const links = document.querySelectorAll('a[href^="#"]');

for (const link of links) {
  link.addEventListener("click", (event) => {
    const target = document.querySelector(link.getAttribute("href"));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
`;
}

export function renderReadme(options: WebsiteOptions, files: WebsiteFiles) {
  return [
    `# ${options.name} One-Page Website`,
    "",
    "This folder contains a complete static website bundle.",
    "",
    "## Files",
    "",
    `- \`${files.html}\`: page markup`,
    `- \`${files.css}\`: responsive styling`,
    `- \`${files.script}\`: smooth section navigation`,
    "",
    "## Run Locally",
    "",
    "Open `index.html` in a browser or serve this folder with any static file server.",
    "",
    "## Before Publishing",
    "",
    "- Replace placeholder contact links.",
    "- Swap proof points for real customer or product evidence.",
    "- Confirm page copy matches the final offer and pricing.",
  ].join("\n");
}

export function renderCopyDoc(options: WebsiteOptions, sections: WebsiteSection[]) {
  return [
    `# Website Copy: ${options.name}`,
    "",
    `Brief: ${options.brief}`,
    `Audience: ${options.audience}`,
    `Goal: ${options.goal}`,
    `Style: ${options.style}`,
    "",
    ...sections.flatMap((section) => [
      `## ${titleCase(section.id)}`,
      "",
      `Eyebrow: ${section.eyebrow}`,
      `Headline: ${section.headline}`,
      "",
      section.body,
      "",
      "Bullets:",
      ...section.bullets.map((bullet) => `- ${bullet}`),
      "",
      `CTA: ${section.primaryCta}`,
      "",
    ]),
  ].join("\n");
}

export function renderDeployNotes(options: WebsiteOptions) {
  return [
    `# Deploy Notes: ${options.name}`,
    "",
    "## Static Bundle",
    "",
    "The `site/` folder is self-contained and can be uploaded to any static hosting target.",
    "",
    "## Recommended Checks",
    "",
    "- Run a mobile viewport review before publishing.",
    "- Replace `hello@example.com` with the real conversion destination.",
    "- Add analytics only after the event names and privacy notice are approved.",
    "- Compress any images added later and set width/height attributes to avoid layout shift.",
    "",
    "## Suggested Tracking Events",
    "",
    `- primary_goal: ${slugify(options.goal)}`,
    `- page_name: ${slugify(options.name)}`,
  ].join("\n");
}
