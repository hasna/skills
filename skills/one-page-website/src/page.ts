import { escapeHtml } from "./design.js";
import type { Content, CopyOverride, KnownSection, Tokens } from "./types.js";

const ICONS = [
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/><path d="m9 12 2 2 4-4"/></svg>',
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6H4v12h4M16 6h4v12h-4M10 16l4-8"/></svg>',
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h5M9.5 14.5h5"/></svg>',
];

export const SECTION_LABELS: Record<KnownSection, string> = {
  hero: "Overview",
  features: "Features",
  proof: "Proof",
  pricing: "Pricing",
  faq: "FAQ",
  cta: "Get started",
};

interface RenderContext {
  content: Content;
  overrides: Map<string, CopyOverride>;
  sections: string[];
}

function richOverride(ctx: RenderContext, slug: string): string | null {
  const override = ctx.overrides.get(slug);
  return override ? `      <div class="rich-text">\n${override.html
    .split("\n")
    .map((line) => `        ${line}`)
    .join("\n")}\n      </div>` : null;
}

function renderHero(ctx: RenderContext): string {
  const { content } = ctx;
  const custom = richOverride(ctx, "hero");
  const panelRows = content.stats
    .map(
      (stat) =>
        `          <div class="hero__panel-row"><span class="hero__panel-key">${escapeHtml(
          stat.label,
        )}</span><span class="hero__panel-val">${escapeHtml(stat.value)}</span></div>`,
    )
    .join("\n");

  return `    <section id="hero" class="section hero" aria-labelledby="hero-title">
      <div class="container hero__grid">
        <div>
          <p class="hero__badge">${escapeHtml(content.eyebrow)} &middot; ${escapeHtml(content.name)}</p>
          <h1 id="hero-title">${escapeHtml(content.tagline)}</h1>
          <p class="lede">${escapeHtml(content.lead)}</p>
${custom ? `${custom}\n` : ""}          <div class="hero__actions">
            <a class="btn btn--primary" href="#cta">${escapeHtml(content.goal)}</a>
            <a class="btn btn--ghost" href="#features">See how it works</a>
          </div>
          <p class="hero__note">No credit card required &middot; Built for ${escapeHtml(content.audience)}</p>
        </div>
        <div class="hero__panel" aria-hidden="true">
          <div class="hero__panel-bar"><span></span><span></span><span></span></div>
${panelRows}
        </div>
      </div>
    </section>`;
}

function renderFeatures(ctx: RenderContext): string {
  const custom = richOverride(ctx, "features");
  const cards = ctx.content.features
    .map(
      (feature, index) => `          <article class="card">
            <div class="card__icon">${ICONS[index % ICONS.length]}</div>
            <h3>${escapeHtml(feature.title)}</h3>
            <p>${escapeHtml(feature.body)}</p>
          </article>`,
    )
    .join("\n");

  return `    <section id="features" class="section section--alt" aria-labelledby="features-title">
      <div class="container">
        <div class="section__head">
          <span class="section__eyebrow">Features</span>
          <h2 id="features-title">What you actually get</h2>
          <p class="lede">Fewer moving parts than the stack it replaces, and every one of them is inspectable.</p>
        </div>
${custom ? `${custom}\n` : ""}        <div class="grid grid--3">
${cards}
        </div>
      </div>
    </section>`;
}

function renderProof(ctx: RenderContext): string {
  const { content } = ctx;
  const custom = richOverride(ctx, "proof");
  const stats = content.stats
    .map(
      (stat) => `          <div class="stat">
            <p class="stat__value">${escapeHtml(stat.value)}</p>
            <p class="stat__label">${escapeHtml(stat.label)}</p>
          </div>`,
    )
    .join("\n");

  return `    <section id="proof" class="section" aria-labelledby="proof-title">
      <div class="container">
        <div class="section__head">
          <span class="section__eyebrow">Proof</span>
          <h2 id="proof-title">Numbers first, story second</h2>
        </div>
        <div class="stats">
${stats}
        </div>
${custom ? `${custom}\n` : ""}        <figure class="quote">
          <blockquote><p>&ldquo;${escapeHtml(content.quote.text)}&rdquo;</p></blockquote>
          <footer>${escapeHtml(content.quote.author)} &middot; ${escapeHtml(content.quote.role)}</footer>
        </figure>
      </div>
    </section>`;
}

function renderPricing(ctx: RenderContext): string {
  const custom = richOverride(ctx, "pricing");
  const tiers = ctx.content.tiers
    .map(
      (tier) => `          <article class="card tier${tier.featured ? " tier--featured" : ""}">
            ${tier.featured ? '<span class="tier__badge">Most popular</span>' : ""}
            <h3>${escapeHtml(tier.name)}</h3>
            <p class="tier__price"><span class="tier__amount">${escapeHtml(tier.price)}</span><span class="tier__cadence">${escapeHtml(
              tier.cadence,
            )}</span></p>
            <p>${escapeHtml(tier.blurb)}</p>
            <ul class="tier__list">
${tier.items.map((item) => `              <li>${escapeHtml(item)}</li>`).join("\n")}
            </ul>
            <a class="btn ${tier.featured ? "btn--primary" : "btn--ghost"}" href="#cta">${escapeHtml(
              tier.featured ? ctx.content.goal : `Choose ${tier.name}`,
            )}</a>
          </article>`,
    )
    .join("\n");

  return `    <section id="pricing" class="section section--alt" aria-labelledby="pricing-title">
      <div class="container">
        <div class="section__head">
          <span class="section__eyebrow">Pricing</span>
          <h2 id="pricing-title">Priced so you can start today</h2>
          <p class="lede">Start free. Upgrade when the team does, not when a sales cycle says so.</p>
        </div>
${custom ? `${custom}\n` : ""}        <div class="grid grid--3">
${tiers}
        </div>
      </div>
    </section>`;
}

function renderFaq(ctx: RenderContext): string {
  const custom = richOverride(ctx, "faq");
  const items = ctx.content.faqs
    .map(
      (faq) => `          <details class="faq__item">
            <summary>${escapeHtml(faq.q)}</summary>
            <div class="faq__answer"><p>${escapeHtml(faq.a)}</p></div>
          </details>`,
    )
    .join("\n");

  return `    <section id="faq" class="section" aria-labelledby="faq-title">
      <div class="container">
        <div class="section__head">
          <span class="section__eyebrow">FAQ</span>
          <h2 id="faq-title">Questions people actually ask</h2>
        </div>
${custom ? `${custom}\n` : ""}        <div class="faq">
${items}
        </div>
      </div>
    </section>`;
}

function renderCta(ctx: RenderContext): string {
  const { content } = ctx;
  const custom = richOverride(ctx, "cta");
  return `    <section id="cta" class="section" aria-labelledby="cta-title">
      <div class="container">
        <div class="cta-band">
          <h2 id="cta-title">${escapeHtml(content.ctaHeading)}</h2>
          <p>${escapeHtml(content.ctaBody)}</p>
${custom ? `${custom}\n` : ""}          <p><a class="btn btn--primary" href="mailto:hello@example.com?subject=${encodeURIComponent(
            `${content.name} — ${content.goal}`,
          )}">${escapeHtml(content.goal)}</a></p>
        </div>
      </div>
    </section>`;
}

function renderCustomSection(override: CopyOverride): string {
  return `    <section id="${escapeHtml(override.slug)}" class="section" aria-labelledby="${escapeHtml(
    override.slug,
  )}-title">
      <div class="container">
        <div class="section__head">
          <h2 id="${escapeHtml(override.slug)}-title">${escapeHtml(override.title)}</h2>
        </div>
        <div class="rich-text">
${override.html
  .split("\n")
  .map((line) => `          ${line}`)
  .join("\n")}
        </div>
      </div>
    </section>`;
}

const RENDERERS: Record<KnownSection, (ctx: RenderContext) => string> = {
  hero: renderHero,
  features: renderFeatures,
  proof: renderProof,
  pricing: renderPricing,
  faq: renderFaq,
  cta: renderCta,
};

export interface NavEntry {
  id: string;
  label: string;
}

export function buildHtml(options: {
  content: Content;
  tokens: Tokens;
  css: string;
  sections: string[];
  overrides: Map<string, CopyOverride>;
  customSections: CopyOverride[];
  navEntries: NavEntry[];
}): string {
  const ctx: RenderContext = {
    content: options.content,
    overrides: options.overrides,
    sections: options.sections,
  };

  const rendered: string[] = [];
  for (const section of options.sections) {
    if (section === "cta" && options.customSections.length > 0) {
      for (const custom of options.customSections) rendered.push(renderCustomSection(custom));
    }
    rendered.push(RENDERERS[section as KnownSection](ctx));
  }
  if (!options.sections.includes("cta")) {
    for (const custom of options.customSections) rendered.push(renderCustomSection(custom));
  }

  const nav = options.navEntries
    .map((entry) => `            <li><a href="#${escapeHtml(entry.id)}">${escapeHtml(entry.label)}</a></li>`)
    .join("\n");

  const initials =
    options.content.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase() || "A";

  return `<!doctype html>
<html lang="en" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.content.name)} — ${escapeHtml(options.content.tagline)}</title>
  <meta name="description" content="${escapeHtml(options.content.lead.slice(0, 155))}">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="${options.tokens.accent}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(options.content.name)}">
  <meta property="og:description" content="${escapeHtml(options.content.tagline)}">
  <link rel="canonical" href="/">
  <script>document.documentElement.className = document.documentElement.className.replace("no-js", "js");</script>
  <style>
${options.css
  .split("\n")
  .map((line) => (line ? `    ${line}` : line))
  .join("\n")}
  </style>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>

  <header class="site-header">
    <div class="container site-header__inner">
      <a class="brand" href="#hero">
        <span class="brand__mark" aria-hidden="true">${escapeHtml(initials)}</span>
        <span>${escapeHtml(options.content.name)}</span>
      </a>

      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" hidden>
        <span class="nav-toggle__bars" aria-hidden="true"></span>
        <span>Menu</span>
      </button>

      <nav class="site-nav" id="site-nav" aria-label="Primary">
        <ul class="site-nav__list">
${nav}
        </ul>
      </nav>

      <a class="btn btn--primary btn--sm" href="#cta">${escapeHtml(options.content.goal)}</a>
    </div>
  </header>

  <main id="main">
${rendered.join("\n\n")}
  </main>

  <footer class="site-footer">
    <div class="container site-footer__inner">
      <p>&copy; ${options.content.year} ${escapeHtml(options.content.name)}. All rights reserved.</p>
      <ul>
        <li><a href="#hero">Back to top</a></li>
        <li><a href="mailto:hello@example.com">Contact</a></li>
        <li><a href="/privacy">Privacy</a></li>
      </ul>
    </div>
  </footer>

  <script src="script.js" defer></script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ */
/* docs                                                                */
/* ------------------------------------------------------------------ */


