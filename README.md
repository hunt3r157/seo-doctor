# SEO Doctor

> **Score it. Fix it. Ship it.**

A tiny, pragmatic CLI that audits a URL or a built site for **SEO fundamentals** and outputs a **0–100 score** with **actionable fixes**. Think “README Doctor,” but for SEO.

[![npm version](https://img.shields.io/npm/v/seo-doctor.svg)](https://www.npmjs.com/package/seo-doctor)
[![npm downloads](https://img.shields.io/npm/dm/seo-doctor.svg)](https://www.npmjs.com/package/seo-doctor)
[![release](https://img.shields.io/github/actions/workflow/status/hunt3r157/seo-doctor/release.yml?branch=main&label=release)](https://github.com/hunt3r157/seo-doctor/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=kofi&logoColor=white)](https://ko-fi.com/hunt3r157)

---

## Table of Contents

* [Quick start](#quick-start)
* [Install](#install)
* [Usage](#usage)

  * [Options](#options)
  * [Exit codes](#exit-codes)
* [Configuration](#configuration)
* [What it checks (MVP rubric)](#what-it-checks-mvp-rubric)
* [Example output](#example-output)
* [CI usage (safe for forks)](#ci-usage-safe-for-forks)
* [JSON report shape (abridged)](#json-report-shape-abridged)
* [Contributing](#contributing)
* [Security](#security)
* [FAQ](#faq)
* [Links](#links)
* [Roadmap](#roadmap)
* [License](#license)

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

**Target resolution order (when omitted)**

1. `SEO_TARGET_URL` env var
2. `homepage` in local `package.json` (if it’s a URL)
3. Local `index.html` (`./`, `./dist`, `./build`, `./public`, or `./out`) or any `.html` in CWD
4. Fallback: `http://localhost:3000`

---

## Install

```bash
# one-off (recommended)
npx seo-doctor check

# or install globally
npm i -g seo-doctor
seo-doctor check
```

---

## Usage

```bash
# Preferred subcommand
seo-doctor check [target] [options]

# Back-compat root command
seo-doctor [target] [options]
```

### Options

* `--crawl` — follow same-origin links (default off)
* `--max-pages <n>` — crawl budget (default `10`)
* `--json <file>` — write JSON report
* `--md <file>` — write Markdown report
* `--fail-under <score>` — exit non-zero if overall score < threshold
* `--timeout <ms>` — per-page fetch timeout (default `15000`)

**Examples**

```bash
# Crawl up to 25 pages on same origin
npx seo-doctor check https://your.site --crawl --max-pages 25

# Generate CI artifacts without failing the job
npx seo-doctor check https://your.site --json out.json --md out.md

# Gate in CI at 70
npx seo-doctor check https://your.site --fail-under 70
```

### Exit codes

* `0` — success (or score ≥ `--fail-under`)
* `1` — score below `--fail-under`
* `2` — usage or fetch error

---

## Configuration

SEO Doctor is “zero-config,” but you can influence defaults:

| Name                         | Type                 | Purpose                                                |
| ---------------------------- | -------------------- | ------------------------------------------------------ |
| `SEO_TARGET_URL`             | env var              | Default target when no URL is passed (used by `check`) |
| `homepage`                   | `package.json` field | If it’s a URL, used as the default target              |
| `GHA secret: SEO_TARGET_URL` | repo secret          | Secure target for CI (forks won’t see it)              |

**Requirements:** Node 18+
**Publishing:** Package ships only `dist`, `README.md`, `LICENSE`.

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

## Example output

```
SEO Doctor  v0.1.4
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

**Set the secret once:** `SEO_TARGET_URL = https://your-real-domain.com`
(Repo Settings → Secrets and variables → Actions → New repository secret)

---

## JSON report shape (abridged)

```json
{
  "version": "0.1.4",
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

## Contributing

PRs welcome! To get started:

```bash
git clone https://github.com/hunt3r157/seo-doctor.git
cd seo-doctor
npm i
npm run build
node dist/seo-doctor.js https://example.com --json out.json --md out.md
```

**Guidelines**

* Small, focused PRs; add tests where reasonable.
* Keep checks fast and deterministic.
* Prefer clear, copy-pasteable suggestions in findings.
* Use Conventional Commits for messages (e.g., `feat:`, `fix:`, `docs:`).

---

## Security

If you discover a vulnerability, **do not** open a public issue.
Report it via GitHub Security Advisories:
[https://github.com/hunt3r157/seo-doctor/security/advisories/new](https://github.com/hunt3r157/seo-doctor/security/advisories/new)

---

## FAQ

**Does it render JavaScript?**
Not yet. The MVP fetches HTML and parses it. JS rendering (Playwright) is on the roadmap.

**Why did my CI fail?**
You used `--fail-under` and your score was lower. Either improve the site (see findings), lower the threshold, or temporarily remove the flag.

**Can I run it on a local build without a server?**
Yes—point it at a local HTML file or folder (`seo-doctor check build/index.html`). The `check` subcommand will also auto-find common `index.html` paths.

**Will running this affect my SEO?**
No. It’s a read-only fetch of your pages.

**How is the score calculated?**
Each category is a weighted average of checks (0–1). Overall score is the sum of category scores × weights, scaled to 0–100.

---

## Links

* **Repository:** [https://github.com/hunt3r157/seo-doctor](https://github.com/hunt3r157/seo-doctor)
* **Package:** [https://www.npmjs.com/package/seo-doctor](https://www.npmjs.com/package/seo-doctor)

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
