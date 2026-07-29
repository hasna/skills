import { THEMES, type CliOptions, type Slide, type Theme } from "./types.js";
import { titleCase } from "./utils.js";

const VERSION = "0.1.0";

export function renderDeckMarkdown(deckTitle: string, slides: Slide[], theme: Theme, options: CliOptions): string {
  const lines: string[] = [
    `# ${deckTitle}`,
    "",
    `_${titleCase(options.format)} deck · audience: ${options.audience} · theme: ${theme.label} · ${slides.length} slides_`,
    "",
  ];

  for (const slide of slides) {
    lines.push("---", "", `## ${slide.index}. ${slide.title}`, "");
    if (slide.subtitle) lines.push(`**${slide.subtitle}**`, "");
    for (const bullet of slide.bullets) lines.push(`- ${bullet}`);
    if (slide.bullets.length > 0) lines.push("");
    lines.push(`> Notes: ${slide.notes}`, "");
  }

  return lines.join("\n");
}

export function renderSpeakerNotes(deckTitle: string, slides: Slide[], options: CliOptions): string {
  const lines: string[] = [
    `# Speaker notes — ${deckTitle}`,
    "",
    `Audience: **${options.audience}** · Format: **${options.format}** · Slides: **${slides.length}**`,
    "",
    `Estimated runtime: **${Math.max(1, Math.round(slides.length * 0.9))}–${Math.max(2, slides.length * 2)} minutes** at 1–2 minutes per slide.`,
    "",
  ];

  for (const slide of slides) {
    lines.push(`## Slide ${slide.index} — ${slide.title}`, "");
    if (slide.bullets.length > 0) {
      lines.push("On screen:", "");
      for (const bullet of slide.bullets) lines.push(`- ${bullet}`);
      lines.push("");
    }
    lines.push("Say:", "", slide.notes, "");
  }

  lines.push(
    "## Delivery checklist",
    "",
    "- [ ] Open with the decision or outcome, not the agenda",
    "- [ ] Replace every scaffold bullet with a specific, verifiable claim",
    "- [ ] Name an owner and a date for each next step",
    "- [ ] Rehearse the first and last 30 seconds verbatim",
    "",
  );

  return lines.join("\n");
}

export function renderThemeGuide(theme: Theme, slides: Slide[]): string {
  return [
    `# Theme guide — ${theme.label}`,
    "",
    theme.mood,
    "",
    "## Palette",
    "",
    "| Token | Hex | Use |",
    "|-------|-----|-----|",
    `| Background | \`#${theme.background}\` | Slide canvas |`,
    `| Surface | \`#${theme.surface}\` | Cards, agenda blocks, quote panels |`,
    `| Text | \`#${theme.text}\` | Headings and body copy |`,
    `| Muted | \`#${theme.muted}\` | Subtitles, slide numbers, captions |`,
    `| Accent | \`#${theme.accent}\` | Rules, bullet markers, section fills |`,
    `| Accent text | \`#${theme.accentText}\` | Text placed on the accent fill |`,
    "",
    "## Typography",
    "",
    `- Headings: \`${theme.headingFont}\``,
    `- Body: \`${theme.bodyFont}\``,
    "- Slide title: 40–44pt · Bullets: 18–20pt · Captions: 12pt",
    "",
    "## Layout rules",
    "",
    "- 16:9 canvas (10in × 5.625in in PPTX, 1280×720 in HTML).",
    "- Keep a 0.6in outer margin; never let text touch the edge.",
    "- Maximum 6 bullets per slide and roughly 12 words per bullet.",
    "- One idea per slide; if a slide needs a second idea, split it.",
    "",
    "## Applied in this deck",
    "",
    `- ${slides.length} slides`,
    `- Layouts used: ${Array.from(new Set(slides.map((slide) => slide.layout))).join(", ")}`,
    "",
    "## Swapping themes",
    "",
    "Re-run with `--theme <name>`. Available: " + Object.keys(THEMES).join(", ") + ".",
    "",
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderHtml(deckTitle: string, slides: Slide[], theme: Theme, options: CliOptions): string {
  const slideMarkup = slides
    .map((slide) => {
      const parts: string[] = [];
      parts.push(`<section class="slide layout-${slide.layout}" data-index="${slide.index}" aria-label="Slide ${slide.index}">`);
      parts.push('  <div class="slide-inner">');
      if (slide.layout === "quote") {
        parts.push(`    <blockquote class="quote">${escapeHtml(slide.title)}</blockquote>`);
      } else {
        parts.push(`    <h2 class="slide-title">${escapeHtml(slide.title)}</h2>`);
      }
      if (slide.subtitle) parts.push(`    <p class="slide-subtitle">${escapeHtml(slide.subtitle)}</p>`);
      if (slide.bullets.length > 0) {
        parts.push('    <ul class="bullets">');
        for (const bullet of slide.bullets) parts.push(`      <li>${escapeHtml(bullet)}</li>`);
        parts.push("    </ul>");
      }
      parts.push(`    <p class="slide-number">${slide.index} / ${slides.length}</p>`);
      parts.push("  </div>");
      parts.push(`  <aside class="notes" hidden>${escapeHtml(slide.notes)}</aside>`);
      parts.push("</section>");
      return parts.join("\n");
    })
    .join("\n");

  const css = `
:root {
  --bg: #${theme.background};
  --surface: #${theme.surface};
  --text: #${theme.text};
  --muted: #${theme.muted};
  --accent: #${theme.accent};
  --accent-text: #${theme.accentText};
  --heading-font: ${theme.headingFont};
  --body-font: ${theme.bodyFont};
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; background: var(--bg); color: var(--text); font-family: var(--body-font); }
#deck { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
.slide { position: absolute; inset: 0; display: none; padding: 5vh 7vw; }
.slide.active { display: flex; }
.slide-inner { margin: auto; width: 100%; max-width: 1100px; }
.slide-title { font-family: var(--heading-font); font-size: clamp(28px, 4.6vw, 56px); line-height: 1.1; margin: 0 0 0.4em; }
.slide-title::after { content: ""; display: block; width: 84px; height: 5px; margin-top: 0.35em; background: var(--accent); border-radius: 3px; }
.slide-subtitle { color: var(--muted); font-size: clamp(15px, 1.8vw, 22px); margin: 0 0 1em; }
.bullets { margin: 0; padding: 0; list-style: none; }
.bullets li { position: relative; padding-left: 1.5em; margin: 0 0 0.7em; font-size: clamp(15px, 2vw, 24px); line-height: 1.45; }
.bullets li::before { content: ""; position: absolute; left: 0; top: 0.55em; width: 0.6em; height: 0.6em; background: var(--accent); border-radius: 50%; }
.slide-number { position: absolute; right: 7vw; bottom: 4vh; color: var(--muted); font-size: 13px; letter-spacing: 0.08em; margin: 0; }
.layout-title .slide-inner, .layout-closing .slide-inner { text-align: center; }
.layout-title .slide-title::after, .layout-closing .slide-title::after { margin-left: auto; margin-right: auto; }
.layout-title .slide-title { font-size: clamp(34px, 6vw, 72px); }
.layout-title .bullets, .layout-closing .bullets { display: inline-block; text-align: left; }
.layout-section { background: var(--accent); color: var(--accent-text); }
.layout-section .slide-title::after { background: var(--accent-text); }
.layout-agenda .slide-inner { background: var(--surface); border-radius: 18px; padding: 4vh 4vw; }
.quote { font-family: var(--heading-font); font-size: clamp(22px, 3.4vw, 40px); line-height: 1.35; margin: 0; padding-left: 0.7em; border-left: 6px solid var(--accent); font-style: italic; }
#progress { position: fixed; left: 0; bottom: 0; height: 4px; background: var(--accent); width: 0; transition: width 160ms ease; z-index: 5; }
#help { position: fixed; left: 7vw; bottom: 4vh; color: var(--muted); font-size: 12px; letter-spacing: 0.06em; }
@media print {
  @page { size: 1280px 720px; margin: 0; }
  html, body, #deck { height: auto; width: auto; overflow: visible; }
  #progress, #help { display: none !important; }
  .slide { position: relative; display: flex !important; inset: auto; width: 1280px; height: 720px; page-break-after: always; break-after: page; background: var(--bg); }
  .slide.layout-section { background: var(--accent); }
}
`.trim();

  const js = `
(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll(".slide"));
  var progress = document.getElementById("progress");
  var current = 0;

  function show(next) {
    current = Math.max(0, Math.min(slides.length - 1, next));
    slides.forEach(function (slide, index) {
      slide.classList.toggle("active", index === current);
    });
    if (progress) progress.style.width = ((current + 1) / slides.length * 100) + "%";
    if (location.hash !== "#" + (current + 1)) history.replaceState(null, "", "#" + (current + 1));
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " " || event.key === "Enter") {
      show(current + 1);
      event.preventDefault();
    } else if (event.key === "ArrowLeft" || event.key === "PageUp" || event.key === "Backspace") {
      show(current - 1);
      event.preventDefault();
    } else if (event.key === "Home") {
      show(0);
      event.preventDefault();
    } else if (event.key === "End") {
      show(slides.length - 1);
      event.preventDefault();
    } else if (event.key === "n" || event.key === "N") {
      document.body.classList.toggle("show-notes");
      slides.forEach(function (slide) {
        var notes = slide.querySelector(".notes");
        if (notes) notes.hidden = !document.body.classList.contains("show-notes");
      });
    }
  });

  document.addEventListener("click", function (event) {
    if (event.target && event.target.closest && event.target.closest("a")) return;
    show(current + 1);
  });

  var start = parseInt((location.hash || "#1").slice(1), 10);
  show(isNaN(start) ? 0 : start - 1);
})();
`.trim();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(deckTitle)}</title>
<meta name="generator" content="slide-deck-generator v${VERSION}">
<meta name="description" content="${escapeHtml(`${titleCase(options.format)} deck for ${options.audience}`)}">
<style>
${css}
</style>
</head>
<body>
<div id="deck">
${slideMarkup}
</div>
<div id="progress"></div>
<p id="help">← → navigate · N notes · Ctrl/Cmd-P print</p>
<script>
${js}
</script>
</body>
</html>
`;
}

