# skill-siteanalyze

Analyze any website's design system — detects shadcn/ui, Tailwind, extracts colors, typography, and components via Playwright + Claude Vision.

## Usage

```bash
skill-siteanalyze <url>
```

## What It Does

- Navigates to the target URL using Playwright
- Takes a screenshot and analyzes it with Claude Vision
- Detects UI framework (shadcn/ui, Tailwind CSS, etc.)
- Extracts color palette, typography scale, and component patterns
- Outputs an open-styles compatible design profile

## Output

Returns a JSON design profile compatible with open-styles format, including:
- `colors` — primary, secondary, accent, background, text colors
- `typography` — font families, sizes, weights
- `framework` — detected UI framework
- `components` — identified component patterns
