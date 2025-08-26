# SEO Doctor

> **Score it. Fix it. Ship it.**

A tiny, pragmatic CLI that audits a URL or a built site for **SEO fundamentals** and outputs a **0–100 score** with **actionable fixes**. Think “README Doctor,” but for SEO.

[![npm version](https://img.shields.io/npm/v/seo-doctor.svg)](https://www.npmjs.com/package/seo-doctor)
[![npm downloads](https://img.shields.io/npm/dm/seo-doctor.svg)](https://www.npmjs.com/package/seo-doctor)

---

## Quick start

```bash
# Zero-config: resolves a target automatically (see order below)
npx seo-doctor check

# Explicit target
npx seo-doctor check https://example.com \
  --json seo-report.json --md seo-report.md --fail-under 60

# Back-compat (works the old way too)
npx seo-doctor https://example.com
```

### Target resolution order (when omitted)

1. `SEO_TARGET_URL` env var
2. `homepage` in local `package.json` (if it’s a URL)
3. Local `index.html` (`./`, `./dist`, `./build`, `./public`, or `./out`) or any `.html` in CWD
4. Fallback: `http://localhost:3000`

---

## What it checks (MVP rubric)

Weighted categories → averaged to 0–100.

| Category              | Weight | Examples of checks                                                                         |
| --------------------- | -----: | ------------------------------------------------------------------------------------------ |
| **Discoverability**   |    25% | `robots.txt`/`sitemap.xml` reachable, canonical present/valid, not `noindex`               |
| **On-page semantics** |    25% | Exactly one `<h1>`, heading sanity, image `alt` coverage, no empty anchors                 |
| **Metadata**          |    25% | Title (15–60 chars), meta description (70–160), OG basics (title/desc/image), Twitter card |
| **I18n & Mobile**     |    15% | `<html lang>` and responsive viewport meta                                                 |
| **Structured data**   |    10% | JSON-LD present & parses (Organization / WebSite / Article, etc.)                          |

Each finding includes a concise, copy-pasteable suggestion.

---

## CLI

```bash
# Preferred
seo-doctor check [target] [--crawl] [--max-pages N] [--json FILE] [--md FILE] [--fail-under N] [--timeout MS]

# Back-compat root command
seo-doctor [target] [--crawl] [--max-pages N] [--json FILE] [--md FILE] [--fail-under N] [--timeout MS]
```

**Flags**

* `--crawl` — follow same-origin links (default off)
* `--max-pages <n>` — crawl budget (default `10`)
* `--json <file>` — write JSON report
* `--md <file>` — write Markdown report
* `--fail-under <score>` — exit non-zero if overall score < threshold
* `--timeout <ms>` — per-page fetch timeout (default `15000`)

---

## Example output

```
SEO Doctor  v0.1.3
Target: https://example.com/  (1 page)

Score  84/100

Discoverability  21/25
On-page semantics  22/25
Metadata  18/25
I18n & Mobile  14/15
Structured data  9/10

 ✗ Missing og:image → Add <meta property="og:image" content="https://…/og.jpg"> (≈1200×630).
 ! Title length suboptimal (8) → Aim 15–60.
 · Images missing alt (6%) → Add alt to ~3/48 images (decorative: alt="").
```

---

## CI usage (safe for forks)

Add `.github/workflows/seo-doctor.yml`:

```yaml
name: SEO Doctor
on:
  pull_request:
  push:
    branches: [ main ]
    tags-ignore: [ 'v*' ]  # skip release tags

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run build

      - name: Determine target
        id: target
        shell: bash
        run: |
          if [ -n "${{ secrets.SEO_TARGET_URL }}" ]; then
            echo "url=${{ secrets.SEO_TARGET_URL }}" >> "$GITHUB_OUTPUT"
            echo "skip_gate=false" >> "$GITHUB_OUTPUT"
          else
            echo "url=https://example.com" >> "$GITHUB_OUTPUT"
            echo "skip_gate=true" >> "$GITHUB_OUTPUT"
          fi

      - name: Run SEO Doctor (gated)
        if: steps.target.outputs.skip_gate == 'false'
        env: { TARGET_URL: ${{ steps.target.outputs.url }} }
        run: |
          node dist/seo-doctor.js "$TARGET_URL" \
            --json seo-report.json --md seo-report.md \
            --fail-under 60

      - name: Run SEO Doctor (non-gated placeholder)
        if: steps.target.outputs.skip_gate == 'true'
        env: { TARGET_URL: ${{ steps.target.outputs.url }} }
        run: node dist/seo-doctor.js "$TARGET_URL" --json seo-report.json --md seo-report.md
        continue-on-error: true

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: seo-report
          path: |
            seo-report.json
            seo-report.md
```

**Set the secret once**: `SEO_TARGET_URL = https://your-real-domain.com`
(Repo Settings → Secrets and variables → Actions → New repository secret)

---

## JSON report shape (abridged)

```json
{
  "version": "0.1.3",
  "target": "https://example.com",
  "pages": 1,
  "score": 84,
  "categories": {
    "discoverability": {"score": 0.84, "weight": 0.25},
    "semantics": {"score": 0.88, "weight": 0.25},
    "metadata": {"score": 0.72, "weight": 0.25},
    "i18n_mobile": {"score": 0.93, "weight": 0.15},
    "structured": {"score": 0.90, "weight": 0.10}
  },
  "findings": [
    {
      "id": "og-image-missing",
      "severity": "warn",
      "suggestion": "Add <meta property=\"og:image\" content=\"https://…/og.jpg\"> (≈1200×630).",
      "page": "https://example.com/"
    }
  ]
}
```

---

## Local development

```bash
npm i
npm run build
node dist/seo-doctor.js https://example.com --json seo-report.json --md seo-report.md
```

---

## Roadmap

* Optional JS rendering for SPAs (Playwright)
* Parse & seed crawl from `sitemap.xml`
* PSI integration (LCP/CLS/INP) via PageSpeed Insights API
* Plugin API for custom audits
* “Fix suggestions” generator (meta tags / JSON-LD templates)

---

## License

MIT
