#!/usr/bin/env node
import { Command } from 'commander';
import { writeFileSync, readFileSync, statSync, readdirSync } from 'fs';
import { resolve, extname, join } from 'path';
import * as cheerio from 'cheerio';
import { request } from 'undici';
import * as url from 'url';

type Finding = {
  id: string;
  title: string;
  severity: 'info' | 'warn' | 'error';
  score: number; // 0..1
  suggestion?: string;
  evidence?: Record<string, any>;
  page: string;
};

type CategoryId = 'discoverability' | 'semantics' | 'metadata' | 'i18n_mobile' | 'structured';

interface PageAuditResult {
  url: string;
  categoryScores: Record<CategoryId, number>;
  findings: Finding[];
}

interface Report {
  version: string;
  target: string;
  pages: number;
  score: number; // 0..100
  categories: Record<CategoryId, { score: number; weight: number }>;
  findings: Finding[];
}

const CATEGORY_WEIGHTS: Record<CategoryId, number> = {
  discoverability: 0.25,
  semantics: 0.25,
  metadata: 0.25,
  i18n_mobile: 0.15,
  structured: 0.10,
};

const VERSION = '0.1.0';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function normalizeUrl(u: string) {
  try { return new url.URL(u).toString(); } catch { return u; }
}

async function fetchText(target: string, timeoutMs = 15000): Promise<{ status: number; text: string; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await request(target, { method: 'GET', signal: controller.signal, headers: { 'user-agent': 'seo-doctor/0.1' } });
    const text = await res.body.text();
    const finalUrl = target; // undici.request doesn't expose final URL directly
    return { status: res.statusCode, text, finalUrl };
  } finally {
    clearTimeout(timer);
  }
}

function extractLinks($: cheerio.CheerioAPI, base: string): string[] {
  const baseUrl = new url.URL(base);
  const links = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = String($(el).attr('href'));
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    try {
      const abs = new url.URL(href, baseUrl).toString();
      if (new url.URL(abs).origin === baseUrl.origin) links.add(abs);
    } catch {}
  });
  return Array.from(links);
}

function scoreRange(min: number, max: number, value: number): number {
  if (value < min) return Math.max(0, (value / min));
  if (value > max) return Math.max(0, (2 - value / max));
  return 1;
}

async function auditPage(pageUrl: string, html: string): Promise<PageAuditResult> {
  const $ = cheerio.load(html);
  const findings: Finding[] = [];

  const add = (f: Finding) => findings.push(f);

  // Metadata: title
  const title = $('head > title').first().text().trim();
  const titleLen = title.length;
  const titleScore = title ? scoreRange(15, 60, titleLen) : 0;
  if (!title) add({ id: 'title-missing', title: 'Missing <title>', severity: 'error', score: 0, suggestion: 'Add a concise, keyword‑focused <title> (15–60 chars).', page: pageUrl });
  else if (titleScore < 1) add({ id: 'title-length', title: `Title length suboptimal (${titleLen})`, severity: 'warn', score: titleScore, suggestion: 'Aim for 15–60 characters with the primary keyword near the front.', page: pageUrl, evidence: { title } });

  // Metadata: description
  const metaDesc = $('meta[name="description"]').attr('content')?.trim() ?? '';
  const descLen = metaDesc.length;
  const descScore = metaDesc ? scoreRange(70, 160, descLen) : 0;
  if (!metaDesc) add({ id: 'meta-description-missing', title: 'Missing meta description', severity: 'warn', score: 0, suggestion: 'Add <meta name="description" content="…"> (70–160 chars).', page: pageUrl });
  else if (descScore < 1) add({ id: 'meta-description-length', title: `Meta description length suboptimal (${descLen})`, severity: 'info', score: descScore, suggestion: 'Target 70–160 characters that summarize user intent.', page: pageUrl, evidence: { metaDesc } });

  // Metadata: OG & Twitter
  const ogTitle = $('meta[property="og:title"]').attr('content');
  const ogDesc = $('meta[property="og:description"]').attr('content');
  const ogImage = $('meta[property="og:image"]').attr('content');
  const twitterCard = $('meta[name="twitter:card"]').attr('content');
  const ogCount = [ogTitle, ogDesc, ogImage].filter(Boolean).length;
  const ogScore = ogCount === 3 ? 1 : ogCount === 2 ? 0.6 : ogCount === 1 ? 0.3 : 0;
  if (!ogImage) add({ id: 'og-image-missing', title: 'Missing og:image', severity: 'warn', score: 0, suggestion: 'Add <meta property="og:image" content="https://…/og.jpg"> (≈1200×630).', page: pageUrl });
  if (!twitterCard) add({ id: 'twitter-card-missing', title: 'Missing Twitter card', severity: 'info', score: 0, suggestion: 'Add <meta name="twitter:card" content="summary_large_image">.', page: pageUrl });

  // Discoverability: canonical
  const canon = $('link[rel="canonical"]').attr('href');
  let canonScore = 0;
  if (!canon) add({ id: 'canonical-missing', title: 'Missing canonical', severity: 'warn', score: 0, suggestion: `Add <link rel="canonical" href="${pageUrl}">.`, page: pageUrl });
  else {
    try {
      const abs = new url.URL(canon, pageUrl).toString();
      canonScore = 1;
      if (abs !== canon) add({ id: 'canonical-relative', title: 'Canonical is relative', severity: 'info', score: 0.9, suggestion: `Prefer absolute canonical URLs (${abs}).`, page: pageUrl, evidence: { canonical: canon, resolved: abs } });
    } catch {
      add({ id: 'canonical-invalid', title: 'Canonical is invalid URL', severity: 'warn', score: 0.2, suggestion: 'Use a valid absolute canonical URL.', page: pageUrl, evidence: { canonical: canon } });
    }
  }

  // I18n & mobile
  const lang = $('html').attr('lang');
  const viewport = $('meta[name="viewport"]').attr('content');
  const i18nScore = (lang ? 0.5 : 0) + (viewport ? 0.5 : 0);
  if (!lang) add({ id: 'html-lang-missing', title: 'Missing <html lang>', severity: 'warn', score: 0, suggestion: 'Add <html lang="en"> (or appropriate).', page: pageUrl });
  if (!viewport) add({ id: 'viewport-missing', title: 'Missing meta viewport', severity: 'warn', score: 0, suggestion: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.', page: pageUrl });

  // Semantics: headings
  const h1s = $('h1');
  const h1Count = h1s.length;
  let headingScore = 1;
  if (h1Count === 0) { headingScore = 0; add({ id: 'h1-missing', title: 'Missing <h1>', severity: 'warn', score: 0, suggestion: 'Add a single, descriptive <h1> per page.', page: pageUrl }); }
  if (h1Count > 1) { headingScore = 0.4; add({ id: 'h1-multiple', title: 'Multiple <h1> elements', severity: 'info', score: 0.4, suggestion: 'Use one <h1>; demote extras to <h2>/<h3>.', page: pageUrl, evidence: { count: h1Count } }); }

  // Semantics: images alt ratio
  const imgs = $('img');
  const totalImgs = imgs.length;
  let missingAlt = 0;
  imgs.each((_, el) => { if ($(el).attr('alt') === undefined) missingAlt += 1; });
  const missingPct = totalImgs ? (missingAlt / totalImgs) : 0;
  const imgAltScore = totalImgs ? (missingPct <= 0.1 ? 1 : missingPct <= 0.3 ? 0.6 : 0.2) : 1;
  if (missingAlt) add({ id: 'img-alt-missing', title: `Images missing alt (${Math.round(missingPct*100)}%)`, severity: missingPct > 0.3 ? 'warn' : 'info', score: imgAltScore, suggestion: `Add alt to ~${missingAlt}/${totalImgs} images (decorative images may use alt="").`, page: pageUrl });

  // Semantics: anchor text quality
  const anchors = $('a[href]');
  let emptyAnchors = 0;
  anchors.each((_, el) => { const txt = $(el).text().trim(); if (!txt) emptyAnchors += 1; });
  const anchorScore = anchors.length ? (emptyAnchors === 0 ? 1 : emptyAnchors <= 2 ? 0.7 : 0.4) : 1;
  if (emptyAnchors) add({ id: 'empty-anchors', title: `Links with empty text (${emptyAnchors})`, severity: 'info', score: anchorScore, suggestion: 'Use descriptive, non‑empty anchor text; avoid “click here.”', page: pageUrl });

  // Discoverability: noindex
  const robotsMeta = $('meta[name="robots"]').attr('content')?.toLowerCase() ?? '';
  const noindex = robotsMeta.includes('noindex');
  const noindexScore = noindex ? 0 : 1;
  if (noindex) add({ id: 'noindex-set', title: 'noindex is set', severity: 'error', score: 0, suggestion: 'Remove noindex for pages that should appear in search.', page: pageUrl, evidence: { robots: robotsMeta } });

  // Structured data: JSON‑LD parse
  let structuredScore = 0;
  const jsonLdBlocks: any[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    try {
      const parsed = JSON.parse(raw);
      jsonLdBlocks.push(parsed);
    } catch {}
  });
  structuredScore = jsonLdBlocks.length ? 1 : 0;
  if (!jsonLdBlocks.length) add({ id: 'jsonld-missing', title: 'No JSON‑LD structured data', severity: 'info', score: 0, suggestion: 'Add JSON‑LD (Organization, WebSite; Article/BlogPosting for posts).', page: pageUrl });

  const cat: Record<CategoryId, number> = {
    metadata: Math.min(1, (titleScore + descScore + ogScore + (twitterCard ? 1 : 0)) / 4),
    discoverability: Math.min(1, (canonScore + (noindex ? 0 : 1)) / 2),
    semantics: Math.min(1, (headingScore + imgAltScore + anchorScore) / 3),
    i18n_mobile: i18nScore,
    structured: structuredScore,
  };

  return { url: pageUrl, categoryScores: cat, findings };
}

async function checkRobotsAndSitemap(root: string, timeoutMs: number) {
  const origin = new url.URL(root).origin;
  let robotsOk = 0, sitemapOk = 0, robotsEvidence: any = {}, sitemapEvidence: any = {};

  try {
    const robotsUrl = origin + '/robots.txt';
    const r = await fetchText(robotsUrl, timeoutMs);
    robotsOk = r.status >= 200 && r.status < 400 ? 1 : 0;
    robotsEvidence = { url: robotsUrl, status: r.status };
  } catch { robotsOk = 0; }

  try {
    const smUrl = origin + '/sitemap.xml';
    const s = await fetchText(smUrl, timeoutMs);
    sitemapOk = s.status >= 200 && s.status < 400 ? 1 : 0;
    sitemapEvidence = { url: smUrl, status: s.status };
  } catch { sitemapOk = 0; }

  return { robotsOk, sitemapOk, robotsEvidence, sitemapEvidence };
}

function toMarkdown(report: Report): string {
  const lines: string[] = [];
  lines.push(`# SEO Doctor Report`);
  lines.push('');
  lines.push(`**Target:** ${report.target}  `);
  lines.push(`**Pages audited:** ${report.pages}  `);
  lines.push(`**Overall Score:** ${report.score}/100`);
  lines.push('');
  lines.push('## Summary by Category');
  const prettyName: Record<CategoryId,string> = {
    discoverability: 'Discoverability',
    semantics: 'On‑page semantics',
    metadata: 'Metadata',
    i18n_mobile: 'Internationalization & Mobile',
    structured: 'Structured data'
  };
  (Object.keys(report.categories) as CategoryId[]).forEach((k) => {
    const c = report.categories[k];
    const weighted = Math.round(c.score * c.weight * 100);
    const max = Math.round(c.weight * 100);
    lines.push(`- **${prettyName[k]}:** ${weighted}/${max}`);
  });
  lines.push('');
  lines.push('## Findings & Fixes');
  report.findings.forEach((f, i) => {
    lines.push(`${i+1}) **${f.title}**  `);
    if (f.suggestion) lines.push(`${f.suggestion}`);
    if (f.page) lines.push(`_Page:_ ${f.page}`);
    lines.push('');
  });
  return lines.join('\n');
}

async function main() {
  const program = new Command();
  program
    .argument('<target>', 'URL, HTML file, or directory of HTML')
    .option('--crawl', 'crawl same‑origin links', false)
    .option('--max-pages <n>', 'max pages to crawl', (v) => parseInt(v,10), 10)
    .option('--json <file>', 'write JSON report')
    .option('--md <file>', 'write Markdown report')
    .option('--fail-under <score>', 'exit non‑zero if score below', (v)=>parseInt(v,10), 0)
    .option('--timeout <ms>', 'request timeout', (v)=>parseInt(v,10), 15000)
    .parse(process.argv);

  const opts = program.opts();
  const target = normalizeUrl(program.args[0]);

  const pages: string[] = [];

  if (/^https?:\/\//i.test(target)) {
    if (!opts.crawl) {
      pages.push(target);
    } else {
      const toVisit = [target];
      const seen = new Set<string>();
      while (toVisit.length && pages.length < opts.maxPages) {
        const next = toVisit.shift()!;
        if (seen.has(next)) continue; seen.add(next);
        try {
          const { status, text, finalUrl } = await fetchText(next, opts.timeout);
          if (status >= 200 && status < 400) {
            pages.push(finalUrl);
            const $ = cheerio.load(text);
            const links = extractLinks($, finalUrl);
            for (const l of links) if (!seen.has(l)) toVisit.push(l);
          }
        } catch {}
        await sleep(50);
      }
    }
  } else {
    const p = resolve(process.cwd(), target);
    const st = statSync(p);
    if (st.isFile()) {
      const html = readFileSync(p, 'utf8');
      pages.push('file://' + p);
      pageContent.set('file://' + p, html);
    } else if (st.isDirectory()) {
      const files = readdirSync(p).filter(f => ['.html', '.htm'].includes(extname(f)));
      for (const f of files) {
        const fp = join(p, f);
        const html = readFileSync(fp, 'utf8');
        const u = 'file://' + fp;
        pages.push(u); pageContent.set(u, html);
      }
    }
  }

  if (!pages.length) {
    console.error('No pages to audit.');
    process.exit(2);
  }

  let robotsOk = 1, sitemapOk = 1, robotsEvidence: any = {}, sitemapEvidence: any = {};
  if (/^https?:\/\//i.test(target)) {
    try {
      const r = await checkRobotsAndSitemap(target, opts.timeout);
      robotsOk = r.robotsOk; sitemapOk = r.sitemapOk; robotsEvidence = r.robotsEvidence; sitemapEvidence = r.sitemapEvidence;
    } catch {}
  }

  const findings: Finding[] = [];
  const perPage: PageAuditResult[] = [];

  for (const p of pages) {
    let html = pageContent.get(p);
    if (!html) {
      try { const res = await fetchText(p, opts.timeout); html = res.text; } catch { html = ''; }
    }
    const result = await auditPage(p, html || '');
    perPage.push(result);
    findings.push(...result.findings);
  }

  const sumCat: Record<CategoryId, number> = { discoverability: 0, semantics: 0, metadata: 0, i18n_mobile: 0, structured: 0 };
  for (const r of perPage) for (const k of Object.keys(sumCat) as CategoryId[]) sumCat[k] += r.categoryScores[k];
  const avgCat: Record<CategoryId, number> = { discoverability: 0, semantics: 0, metadata: 0, i18n_mobile: 0, structured: 0 };
  for (const k of Object.keys(sumCat) as CategoryId[]) avgCat[k] = sumCat[k] / perPage.length;

  if (/^https?:\/\//i.test(target)) {
    avgCat.discoverability = Math.min(1, (avgCat.discoverability * 0.7) + ((robotsOk + sitemapOk) / 2) * 0.3);
    if (!robotsOk) findings.push({ id: 'robots-missing', title: 'robots.txt missing or unreachable', severity: 'warn', score: 0, suggestion: 'Provide /robots.txt (allow crawling of indexable content).', page: pages[0], evidence: robotsEvidence });
    if (!sitemapOk) findings.push({ id: 'sitemap-missing', title: 'sitemap.xml missing or unreachable', severity: 'info', score: 0, suggestion: 'Provide /sitemap.xml referencing key URLs.', page: pages[0], evidence: sitemapEvidence });
  }

  const categories: Report['categories'] = {
    discoverability: { score: round2(avgCat.discoverability), weight: CATEGORY_WEIGHTS.discoverability },
    semantics: { score: round2(avgCat.semantics), weight: CATEGORY_WEIGHTS.semantics },
    metadata: { score: round2(avgCat.metadata), weight: CATEGORY_WEIGHTS.metadata },
    i18n_mobile: { score: round2(avgCat.i18n_mobile), weight: CATEGORY_WEIGHTS.i18n_mobile },
    structured: { score: round2(avgCat.structured), weight: CATEGORY_WEIGHTS.structured },
  };

  const overall = round0(100 * (
    categories.discoverability.score * categories.discoverability.weight +
    categories.semantics.score * categories.semantics.weight +
    categories.metadata.score * categories.metadata.weight +
    categories.i18n_mobile.score * categories.i18n_mobile.weight +
    categories.structured.score * categories.structured.weight
  ));

  const report: Report = {
    version: VERSION,
    target,
    pages: pages.length,
    score: overall,
    categories,
    findings,
  };

  console.log(`SEO Doctor  v${VERSION}`);
  console.log(`Target: ${target}  (${pages.length} page${pages.length>1?'s':''})\n`);
  console.log(`Score  ${report.score}/100\n`);

  const order: [CategoryId, string][] = [
    ['discoverability', 'Discoverability'],
    ['semantics', 'On‑page semantics'],
    ['metadata', 'Metadata'],
    ['i18n_mobile', 'I18n & Mobile'],
    ['structured', 'Structured data'],
  ];
  for (const [id, label] of order) {
    const c = report.categories[id];
    const weighted = Math.round(c.score * c.weight * 100);
    const max = Math.round(c.weight * 100);
    console.log(`${label}  ${weighted}/${max}`);
  }
  console.log('');

  for (const f of report.findings.slice(0, 10)) {
    const mark = f.severity === 'error' ? '✗' : f.severity === 'warn' ? '!' : '·';
    console.log(` ${mark} ${f.title}${f.suggestion?` → ${f.suggestion}`:''}`);
  }

  if (opts.json) writeFileSync(opts.json, JSON.stringify(report, null, 2));
  if (opts.md) writeFileSync(opts.md, toMarkdown(report));

  if (opts.failUnder && report.score < opts.failUnder) process.exit(1);
}

const pageContent = new Map<string,string>();

function round2(n: number) { return Math.round(n*100)/100; }
function round0(n: number) { return Math.round(n); }

main().catch(err => { console.error(err); process.exit(2); });
