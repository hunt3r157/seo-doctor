# SEO Doctor

**Tagline:** *Score it. Fix it. Ship it.*

A tiny, pragmatic, open‑source CLI that audits a URL or a built site for **SEO fundamentals** and outputs a **0–100 score** with **actionable fixes**. Think “README Doctor,” but for SEO.

---

## Features (MVP)
- **CLI**: `seo-doctor <url|file|dir>`
- **Optional crawl** (same‑origin) with `--crawl --max-pages 25`
- **Deterministic scoring** (0–100) across weighted categories
- **Reporters**: pretty console, **Markdown** (`--md`), **JSON** (`--json`)
- **Actionable suggestions** per finding
- **Exit codes** for CI (`--fail-under 85`)

### Scoring Categories
- **Discoverability** (robots.txt, sitemap.xml, canonical, noindex)
- **On‑page semantics** (one `<h1>`, heading order, image `alt`, descriptive anchors)
- **Metadata** (title/description length, Open Graph essentials, Twitter card)
- **Internationalization & Mobile** (`<html lang>`, `<meta viewport>`)
- **Structured data** (presence of valid JSON‑LD)

---

## Install / Run
```bash
# Local dev
npm i
npm run build
node dist/seo-doctor.js https://example.com --json seo-report.json --md seo-report.md --fail-under 85

# Iterate during dev
npx ts-node src/seo-doctor.ts https://example.com --json out.json --md out.md
```

### CLI flags
- `--crawl` – follow same‑origin links (default off)
- `--max-pages <n>` – crawl budget (default `10`)
- `--md <file>` – write Markdown report
- `--json <file>` – write JSON report
- `--fail-under <score>` – non‑zero exit if overall score below threshold
- `--timeout <ms>` – fetch timeout per page (default `15000`)

---

## CI (GitHub Actions)
Create `.github/workflows/seo-doctor.yml`:
```yaml
name: SEO Doctor
on:
  pull_request:
  push:
    branches: [ main ]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run build
      - name: Run SEO Doctor against prod
        run: node dist/seo-doctor.js https://yourdomain.com --json seo-report.json --md seo-report.md --fail-under 85
      - name: Upload report
        uses: actions/upload-artifact@v4
        with:
          name: seo-report
          path: |
            seo-report.json
            seo-report.md
```

---

## Example
```
SEO Doctor  v0.1.0
Target: https://example.com  (1 page)

Score  84/100

Discoverability  21/25
  ✓ robots.txt found
  ✓ sitemap.xml found
  ✗ canonical missing → Add <link rel="canonical" href="https://example.com/">

On‑page semantics  22/25
  ✓ 1 × <h1>
  ! 6% images missing alt → Add alt to 3/48 images

Metadata  18/25
  ! <title> 8 chars (too short) → Aim 15–60
  ✓ meta description OK (134 chars)
  ✗ Missing og:image → Add <meta property="og:image" content="…">

I18n & Mobile  14/15
  ✓ <html lang="en">
  ✓ <meta name="viewport">

Structured data  9/10
  ✓ 1 JSON‑LD block (Organization)
```

---

## Roadmap
- Headless render for JS‑heavy SPAs (`--render` via Playwright, opt‑in)
- Parse sitemap.xml to seed crawl
- PSI integration (LCP/CLS/INP) via PageSpeed Insights API
- Plugin API for custom audits
- Auto‑generate meta tags and optional PRs

---

## License
MIT
