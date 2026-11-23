// Build-time static generation for Cloudflare Pages (23 Nov 2026, Phase 1).
//
// The build fetches the published posts from the live public API and
// renders real static HTML, so crawlers see full article text, meta tags
// and links without JavaScript:
//
// - dist/<slug>/index.html        one static page per published post
// - dist/index.html               homepage with rendered article cards
// - dist/<Category>/index.html    one page per category with its posts
// - dist/<page>/index.html        about, contact, privacy, terms,
//   disclaimer, editorial-policy, Health-Tools
// - dist/slugs.json               JSON array of all published slugs
//   (used by functions/[[path]].js to validate /article?id= redirects)
//
// Content source: the live API https://blogsphere.info/api/public-data
// (full payload, with article bodies). For local testing set
// BLOGSPHERE_CONTENT_JSON to a local JSON file with the same shape.
// The build FAILS LOUDLY (throws) when it cannot fetch the content, so a
// bad deploy never ships an empty or stale site.
//
// Behaviour kept from the original build: only allowlisted files are
// copied to dist/, CSS is minified into dist/ only, _redirects/_headers/
// _routes.json/deployment-config.js are generated, and preview builds
// (non-master Cloudflare Pages branches) get a disallow-all robots.txt.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const SITE_ORIGIN = 'https://blogsphere.info';
// The content source is read inside loadPosts() (not at module load) so
// tests can point the build at a fixture after requiring this module.
const DEFAULT_API_URL = 'https://blogsphere.info/api/public-data';

// Files copied verbatim into dist/ (CSS is minified, see below). The
// content templates (index.html, article.html, the five category pages and
// the static pages) are NOT in this list any more: they are generated into
// directory form (dist/<slug>/index.html, dist/<Category>/index.html,
// dist/<page>/index.html) so the clean URL is the only URL.
const publicFiles = [
  '404.html',
  'Business.jpeg',
  'Favicon_11zon.webp',
  'Health-Fitness.jpeg',
  'Home-Decor.webp',
  'Logo.webp',
  'Make-Money-Online.webp',
  'Technology.jpeg',
  'admin-api-routing.js',
  'admin-full.html',
  'admin-full.js',
  'blogsphere-smartfit-health-fitness-tool-v3.html',
  'deployment-config.js',
  'llms.txt',
  'robots.txt',
  'script.js',
  'sitemap-articles.xml',
  'sitemap-pages.xml',
  'sitemap.xml',
  'style.css'
];

const CATEGORY_ORDER = [
  'Technology',
  'Business',
  'Home Decor',
  'Make Money Online',
  'Health & Fitness'
];
const CATEGORY_PAGES = {
  Technology: '/Technology',
  Business: '/Business',
  'Home Decor': '/Home-Decor',
  'Make Money Online': '/Make-Money-Online',
  'Health & Fitness': '/Health-Fitness'
};
const CATEGORY_FILES = {
  Technology: 'Technology.html',
  Business: 'Business.html',
  'Home Decor': 'Home-Decor.html',
  'Make Money Online': 'Make-Money-Online.html',
  'Health & Fitness': 'Health-Fitness.html'
};
// Static pages served in directory form: dist/<dir>/index.html.
const STATIC_PAGES = [
  { file: 'about.html', dir: 'about' },
  { file: 'contact.html', dir: 'contact' },
  { file: 'privacy-policy.html', dir: 'privacy-policy' },
  { file: 'terms-and-conditions.html', dir: 'terms-and-conditions' },
  { file: 'disclaimer.html', dir: 'disclaimer' },
  { file: 'editorial-policy.html', dir: 'editorial-policy' },
  { file: 'Health-Tools.html', dir: 'Health-Tools' }
];

const redirects = [
  '/admin /admin-full.html 301',
  '/admin.html /admin-full.html 301',
  // SEO fix (16 Nov 2026): clean slug / lowercase-category URLs that Google
  // already found and reports as 404. Absolute destinations so a www request
  // lands on the apex in one hop instead of chaining. Destinations updated
  // 23 Nov 2026 to the clean static URLs (was /article?id=...).
  '/best-cardio-for-weight-loss https://blogsphere.info/best-cardio-for-weight-loss/ 301',
  '/best-weight-loss-exercises-small-uk-flat https://blogsphere.info/best-weight-loss-exercises-small-uk-flat/ 301',
  '/technology https://blogsphere.info/Technology 301',
  '/business https://blogsphere.info/Business 301',
  '/home-decor https://blogsphere.info/Home-Decor 301',
  '/make-money-online https://blogsphere.info/Make-Money-Online 301',
  '/health-fitness https://blogsphere.info/Health-Fitness 301',
  // Health Tools subpage (16 Nov 2026).
  '/health-tools https://blogsphere.info/Health-Tools 301',
  // Old .html forms -> clean URLs (23 Nov 2026 static generation). The
  // /article and /article.html routes are NOT listed here: they carry a
  // ?id= query string, which _redirects cannot match, so the catch-all
  // Function (functions/[[path]].js) handles them instead.
  '/Technology.html /Technology 301',
  '/Business.html /Business 301',
  '/Home-Decor.html /Home-Decor 301',
  '/Make-Money-Online.html /Make-Money-Online 301',
  '/Health-Fitness.html /Health-Fitness 301',
  '/Health-Tools.html /Health-Tools 301',
  '/about.html /about 301',
  '/contact.html /contact 301',
  '/privacy-policy.html /privacy-policy 301',
  '/terms-and-conditions.html /terms-and-conditions 301',
  '/disclaimer.html /disclaimer 301',
  '/editorial-policy.html /editorial-policy 301'
].join('\n') + '\n';

const baseHeaders = [
  '/*.webp',
  '  Cache-Control: public, max-age=31536000, immutable',
  '',
  '/*.jpeg',
  '  Cache-Control: public, max-age=31536000, immutable',
  '',
  '/*.jpg',
  '  Cache-Control: public, max-age=31536000, immutable',
  '',
  '/*.png',
  '  Cache-Control: public, max-age=31536000, immutable',
  '',
  '/style.css',
  '  Cache-Control: public, max-age=3600, must-revalidate',
  '',
  '/script.js',
  '  Cache-Control: public, max-age=3600, must-revalidate',
  '',
  '/*.html',
  '  Cache-Control: public, max-age=0, must-revalidate',
  '  X-Content-Type-Options: nosniff',
  ''
].join('\n');

function isCloudflarePreviewBuild() {
  return process.env.CF_PAGES === '1' && process.env.CF_PAGES_BRANCH !== 'master';
}

// Perf (17 Nov 2026): dependency-free CSS minifier, used for dist only.
// The Cloudflare Pages build command is set in the dashboard (not in this
// repo), so a real minifier package cannot be relied on here. This
// conservative pass only strips comments (quote-aware) and collapses
// whitespace; it never touches spacing around + / - so calc() expressions
// stay valid. JS is deliberately NOT minified by hand (too risky without
// terser); add terser as a devDependency only once the dashboard build
// command is confirmed to run `npm install`.
function minifyCss(css) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < css.length) {
    const ch = css[i];
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

// ---------------------------------------------------------------------------
// Content loading
// ---------------------------------------------------------------------------

function normalizePosts(data) {
  const posts = Array.isArray(data) ? data : data.posts || data.data || [];
  return posts
    .filter((p) => p && p.slug && p.status === 'published' && !p.deleted_at)
    .sort((a, b) => {
      const da = Date.parse(a.published_at || a.created_at || a.date || '') || 0;
      const db = Date.parse(b.published_at || b.created_at || b.date || '') || 0;
      if (da !== db) return db - da;
      return Number(b.id || 0) - Number(a.id || 0);
    });
}

async function loadPosts() {
  const contentJson = process.env.BLOGSPHERE_CONTENT_JSON || '';
  const apiUrl = process.env.BLOGSPHERE_API_URL || DEFAULT_API_URL;
  if (contentJson) {
    const raw = fs.readFileSync(path.resolve(contentJson), 'utf8');
    return normalizePosts(JSON.parse(raw));
  }
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    try {
      const res = await fetch(apiUrl, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`API request failed: ${res.status} ${apiUrl}`);
      return normalizePosts(await res.json());
    } catch (err) {
      lastError = err;
      console.error(`Content fetch attempt ${attempt}/3 failed: ${err.message}`);
    }
  }
  throw new Error(
    `Could not fetch post data from ${apiUrl} after 3 attempts: ${lastError && lastError.message}`
  );
}

// ---------------------------------------------------------------------------
// Text helpers (mirrored in script.js so hydration never undoes the build)
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function truncateAtWord(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

function plainTextFromHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function articleTitle(post) {
  return truncateAtWord(post.meta_title || post.title, 60);
}

function articleDescription(post) {
  const stored = String(post.meta_description || '').trim();
  if (stored.length >= 120 && stored.length <= 155) return stored;
  const derived =
    String(post.excerpt || post.summary || '').trim() ||
    plainTextFromHtml(post.content || '') ||
    stored;
  return truncateAtWord(derived, 155);
}

function dateOnly(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function formatDisplayDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

// ---------------------------------------------------------------------------
// Language detection (23 Nov 2026, Phase 1 item 28).
//
// Posts carry no language field, so the language is detected from the
// content: French and Spanish stopwords are scored over the title + body,
// and the higher score wins when it clears a low threshold. Slug markers
// are a fallback for short or mixed text. Verified against the 23 Nov
// backup (134 posts): 14 fr, 14 es, 106 en. That is three more non-English
// posts than the audit's 12 fr / 13 es, because the audit counted slug
// markers only and missed decoration-de-noel (French), stomach-fat-workout
// (French body, English slug) and benefits-of-working-out-in-the-morning
// (Spanish body, English slug) — all three verified as French/Spanish
// content, so they are labelled fr/es here. No hreflang is added in Phase 1.
// ---------------------------------------------------------------------------

const FR_WORDS = new Set(
  'le la les de des du un une et est pour dans que qui avec sur pas plus aux ce il vous nous votre vos comment choisir acheter en france francais noel sapin au cette sont par comme tout faire etre avoir ils elle on ne se sa ses son leur leurs ou mais aussi tres bien peut apres avant entre chez sans sous vers lors meme encore toujours souvent parfois deja donc alors ainsi pourquoi quand quel quelle quels quelles'.split(
    ' '
  )
);
const ES_WORDS = new Set(
  'el los las de un una en y es para con que por se su sus como que mas pero este esta estos estas son del al lo le me te nos os mi tu muy bien tambien porque cuando donde cual cuales cuanto cuanta hay tiene tienen puede pueden hacer estar ser haber ir va van desde hasta entre sin sobre tras durante contra hacia segun aunque mientras si no ya todavia siempre nunca ahora hoy ayer manana aqui ahi alli espana dinero ganar movil telefono guia emprendedores navidad arbol'.split(
    ' '
  )
);
const FR_SLUG_MARKERS = ['france', 'francais', 'noel', 'sapin'];
const ES_SLUG_MARKERS = ['espana', 'guia', 'navidad', 'arbol', 'adornos'];

function detectLanguage(post) {
  const text = `${post.title || ''} ${plainTextFromHtml(post.content || '')}`.toLowerCase();
  const tokens = text.match(/[a-zàâäéèêëîïôöùûüçñ]+/g) || [];
  let fr = 0;
  let es = 0;
  for (const token of tokens) {
    if (FR_WORDS.has(token)) fr += 1;
    if (ES_WORDS.has(token)) es += 1;
  }
  const total = tokens.length || 1;
  const frScore = fr / total;
  const esScore = es / total;
  if (Math.max(frScore, esScore) > 0.08) return frScore > esScore ? 'fr' : 'es';
  const slug = String(post.slug || '').toLowerCase();
  if (FR_SLUG_MARKERS.some((marker) => slug.includes(marker))) return 'fr';
  if (ES_SLUG_MARKERS.some((marker) => slug.includes(marker))) return 'es';
  return 'en';
}

// ---------------------------------------------------------------------------
// Internal-link rewriting (mirrored in script.js)
// ---------------------------------------------------------------------------

function rewriteInternalLinks(html) {
  return String(html || '')
    .replace(
      /href="https?:\/\/blogggsphere\.netlify\.app\/article(?:\.html)?\?id=([^"&\s]+)/gi,
      'href="https://blogsphere.info/$1/"'
    )
    .replace(
      /href="https?:\/\/blogsphere\.info\/article(?:\.html)?\?id=([^"&\s]+)/gi,
      'href="https://blogsphere.info/$1/"'
    )
    .replace(/href="\/?article(?:\.html)?\?id=([^"&\s]+)/gi, 'href="/$1/"')
    .replace(
      /href="https?:\/\/blogsphere\.info\/(Technology|Business|Home-Decor|Make-Money-Online|Health-Fitness|about|contact|privacy-policy|terms-and-conditions|disclaimer|editorial-policy)\.html(\?[^"]*)?"/gi,
      'href="https://blogsphere.info/$1"'
    )
    .replace(
      /href="\/(Technology|Business|Home-Decor|Make-Money-Online|Health-Fitness|about|contact|privacy-policy|terms-and-conditions|disclaimer|editorial-policy)\.html(\?[^"]*)?"/gi,
      'href="/$1"'
    )
    .replace(/href="\/?index\.html(\?[^"]*)?"/gi, (match, query) => `href="/${query || ''}"`);
}

// Perf (17 Nov 2026): decorate stored post-body images at render time.
// Mirrors script.js decorateArticleImages so the static HTML matches what
// hydration produces.
function decorateArticleImages(html) {
  let seen = 0;
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    seen += 1;
    let out = tag;
    if (seen > 1 && !/\bloading\s*=/.test(out)) {
      out = out.replace(/<img\b/i, '<img loading="lazy"');
    }
    if (!/\bwidth\s*=/.test(out) || !/\bheight\s*=/.test(out)) {
      const src = out.match(/\bsrc\s*=\s*"([^"]*)"/i);
      if (src) {
        const w = src[1].match(/[?&;]w=(\d+)/);
        const h = src[1].match(/[?&;]h=(\d+)/);
        if (w && h) {
          if (!/\bwidth\s*=/.test(out)) out = out.replace(/<img\b/i, `<img width="${w[1]}"`);
          if (!/\bheight\s*=/.test(out)) out = out.replace(/<img\b/i, `<img height="${h[1]}"`);
        }
      }
    }
    return out;
  });
}

function buildArticleContent(post) {
  if (!post || !post.content || !post.content.trim()) return '<p>This post is unavailable.</p>';
  let body = post.content;
  if (/<(?:h[1-6]|p|ul|ol|blockquote|img)\b/i.test(body)) {
    // The page template already shows the title as its H1; drop the body's
    // duplicate opening H1 so the page has a single top-level heading.
    body = body.replace(/^\s*<h1[^>]*>.*?<\/h1>/is, '');
  }
  // Phase 4 (23 Nov 2026), item 26: demote any H1 left in the body to H2,
  // so the generated page has exactly one H1 (the post title in the
  // template). Runs before the Phase 3 boxes are appended, so their
  // headings are unaffected.
  body = body.replace(/<h1(\s[^>]*)?>/gi, '<h2$1>').replace(/<\/h1>/gi, '</h2>');
  body = rewriteInternalLinks(decorateArticleImages(body));
  // Phase 4, item 29: descriptive alt text for images that had none.
  body = applyImageAltOverrides(post, body);
  // Phase 4, item 24: rewrite the shared paragraphs in the females post.
  body = applyPhase4Replacements(post, body);
  // Phase 4, item 25: "Related guides" box for posts whose stored content
  // has no internal links. Appended before the Phase 3 Sources sections,
  // so the order is: body, related guides, sources.
  body += relatedLinksBox(post);
  // Phase 3 (23 Nov 2026): build-time E-E-A-T enhancements (see below).
  return applyPhase3Enhancements(post, body);
}

// ---------------------------------------------------------------------------
// Phase 3 (23 Nov 2026) — E-E-A-T build-time enhancements (items 15, 16, 17).
//
// READ THIS BEFORE EDITING. Article body content lives in Supabase (the API)
// and this repo has NO Supabase write access, so every enhancement below is
// applied at BUILD time in this file, at static-page generation. The stored
// content is NEVER modified: it stays the source of truth, and every change
// here is reversible by removing this section. Slugs are listed explicitly
// so the behaviour is auditable, and every source URL below was verified
// reachable (HTTP 200 via curl, or confirmed loading via browser fetch) on
// 23 Nov 2026. Nothing here invents an author, credential, statistic,
// source, quote or date. Items 14, 18, 20 and 21 are NOT implemented here:
// they need the user's answers/approvals and are held.
//
// What this section does, by item:
//   15 — Sources sections for the 3 major posts (Huang, Anthropic, Riemann),
//        a build-time "Update" box on the Huang post (he resigned 12 Nov),
//        targeted build-time replacement of the Anthropic post's preliminary
//        IPO figures with the final verified terms, a $1.4tn -> $1.5tn fix
//        to the Anthropic link text inside the Riemann post, and a
//        dateModified override (2026-11-23) for all three in generateArticlePage.
//   16 — (a) is a template edit (index.html FAQ), not code. (b) Sources
//        sections for the priority posts (Christmas decor, the two accounting
//        software guides, the statistics roundup, and the 22 Business posts
//        dated 11 Nov 2026). Figures were verified against gov.uk / HMRC /
//        IRS / SBA / vendor pages; ONE wrong set was found and is NOT changed
//        here — see WRONG_FIGURES_FOUND below and the parent's report.
//   17 — Disclaimer blocks injected after the intro paragraph: a health
//        disclaimer on the 9 exercise/weight-loss Health & Fitness posts
//        (plus an NHS/CDC/WHO Sources box), and a financial disclaimer on
//        the 14 Make Money Online posts, the 19 Business tax/legal/credit/
//        incorporation/insurance posts, and — by topic, because they are
//        about insurance products — the 6 insurance posts that sit in
//        Health & Fitness pending item 18. No "Reviewed by" line anywhere
//        (needs the user's answer to question h).
//   19 — is a template edit (index.html + about.html), not code.
// ---------------------------------------------------------------------------

const PHASE3_DATE = '2026-11-23';

// Item 15: the three posts whose JSON-LD dateModified is overridden to
// PHASE3_DATE at build time (stored publish dates are never changed).
const PHASE3_DATE_MODIFIED_SLUGS = new Set([
  'jensen-huang-affair-nvidia-investigation',
  'anthropic-ipo-2026-valuation-explained',
  'riemann-hypothesis-solved-claude-ai-stanford'
]);

const ANTHROPIC_SLUG = 'anthropic-ipo-2026-valuation-explained';
const HUANG_SLUG = 'jensen-huang-affair-nvidia-investigation';
const RIEMANN_SLUG = 'riemann-hypothesis-solved-claude-ai-stanford';

// Item 15, Anthropic: final verified IPO terms (19 Nov 2026 — Reuters via
// CNA, Al Jazeera; evidence file anthropic-ipo-pricing-check-2026-11-19.md).
// The live article still carried the preliminary figures, so the title,
// meta title, meta description and summary are overridden at build time in
// buildPages() (see below) and the body figures are replaced here.
// NOTE: the meta description must stay within 120–155 characters, or
// articleDescription() falls back to the stored excerpt (which still has
// the preliminary figures).
const ANTHROPIC_TITLE_OVERRIDE = {
  title: 'Anthropic IPO 2026: What the $1.5 Trillion Valuation Means for AI and Investors',
  meta_title: 'Anthropic IPO 2026: $1.5 Trillion Valuation Explained',
  meta_description:
    'Anthropic priced its IPO at $83.00 a share, raising $81.31 billion at a $1.5 trillion fully diluted valuation. What it means for AI and investors.',
  summary:
    'Anthropic priced its IPO at $83.00 a share, raising $81.31 billion at a $1.5 trillion fully diluted valuation, and began trading on 19 November 2026 on Nasdaq under the ticker ANT. Here is what the listing means for AI, investors and rivals.'
};

// Item 15, Anthropic: targeted build-time replacements of the preliminary
// figures. Specific sentences first (they fix tense as well as figures),
// then global figure fallbacks for any remaining occurrences (table rows
// are covered by the specific <td> pairs). Every "from" string was verified
// present verbatim in the stored HTML on 23 Nov 2026; a missing string is
// logged, never fatal, so a future content edit cannot break the build.
const ANTHROPIC_REPLACEMENTS = [
  // Table rows (specific cells, so labels and "Up to" are fixed too).
  ['<th>Terms (as reported)</th>', '<th>Final terms</th>'],
  ['<td>Price range</td>', '<td>Final price</td>'],
  ['<td>825 million Class A shares</td>', '<td>980 million Class A shares</td>'],
  ['<td>$70 to $78 per share</td>', '<td>$83.00 per share</td>'],
  ['<td>Up to $64.4 billion</td>', '<td>$81.31 billion</td>'],
  ['<td>Up to $90.4 billion</td>', '<td>About $107.3 billion</td>'],
  ['<td>About $1 trillion at the top of the range</td>', '<td>About $1.1 trillion</td>'],
  ['<td>About $1.4 trillion at the top of the range</td>', '<td>About $1.5 trillion</td>'],
  [
    '<td>Pricing expected 18 November; trading expected to begin 19 November</td>',
    '<td>Priced 18 November 2026 at $83.00; trading began 19 November 2026</td>'
  ],
  // Intro.
  [
    'aim to raise up to $64.4 billion by selling 825 million shares at $70 to $78 each',
    'raised $81.31 billion by selling 980 million shares at $83.00 each'
  ],
  [
    'A separate $26 billion private placement would take the total to as much as $90.4 billion',
    'A separate $26 billion private placement took the total package to about $107.3 billion'
  ],
  [
    'At the top of the range, Anthropic would be worth about $1.4 trillion fully diluted, counting stock options and restricted shares as well as shares already issued.',
    'Anthropic was valued at about $1.5 trillion fully diluted, counting stock options and restricted shares as well as shares already issued.'
  ],
  [
    'On outstanding shares alone, the figure is closer to $1 trillion.',
    'On outstanding shares alone, the figure is about $1.1 trillion.'
  ],
  // Deal-table preamble.
  [
    'Figures are as reported by Reuters and other outlets; the final price and share count may still change.',
    'Figures are the final pricing terms, as reported by Reuters and other outlets.'
  ],
  // "Two points matter" paragraph.
  [
    'the $90.4 billion combines the public sale and the private placement',
    'the $107.3 billion combines the public sale and the private placement'
  ],
  [
    'the $1.4 trillion figure is fully diluted, including shares issuable under options and restricted stock; on shares actually outstanding, the value is about $1 trillion',
    'the $1.5 trillion figure is fully diluted, including shares issuable under options and restricted stock; on shares actually outstanding, the value is about $1.1 trillion'
  ],
  // Backers.
  [
    'will buy $26 billion of shares at the IPO price',
    'bought $26 billion of shares at the $83.00 IPO price'
  ],
  // "Can ordinary investors buy" section (stored HTML uses &quot;).
  [
    'Until the shares start trading, ordinary investors cannot buy Anthropic stock: before the IPO it is privately held by founders, employees and large investors such as Amazon and Google. Once trading begins — expected on 19 November on the Nasdaq under &quot;ANT&quot;, according to reports — anyone with a brokerage account offering US shares can buy them on the open market.',
    'Now that the shares are trading, ordinary investors can buy Anthropic stock: before the IPO it was privately held by founders, employees and large investors such as Amazon and Google. Trading began on 19 November on the Nasdaq under &quot;ANT&quot; — anyone with a brokerage account offering US shares can buy them on the open market.'
  ],
  // Risks.
  [
    'at roughly $1 trillion, Anthropic is priced for years of exceptional growth',
    'at roughly $1.5 trillion fully diluted (about $1.1 trillion on shares outstanding), Anthropic is priced for years of exceptional growth'
  ],
  // FAQs.
  [
    'At the top of its $70 to $78 range, about $1 trillion on shares outstanding and about $1.4 trillion fully diluted.',
    'At $83.00 a share, about $1.1 trillion on shares outstanding and about $1.5 trillion fully diluted.'
  ],
  [
    'it intends to price the offering on 18 November and start trading on the Nasdaq on 19 November under the ticker',
    'it priced the offering at $83.00 a share on 18 November and started trading on the Nasdaq on 19 November under the ticker'
  ],
  [
    'These dates are as reported and could change.',
    'The offering is now complete.'
  ],
  [
    'Not before the IPO. Once trading begins on the Nasdaq, expected 19 November 2026, shares can be bought through a broker offering US-listed shares.',
    'Yes. Trading began on the Nasdaq on 19 November 2026 under the ticker "ANT", and shares can be bought through a broker offering US-listed shares.'
  ],
  // Conclusion.
  [
    'A company founded in 2021 is asking to be valued at around $1 trillion, or $1.4 trillion fully diluted',
    'A company founded in 2021 is now valued at around $1.1 trillion on shares outstanding, or $1.5 trillion fully diluted'
  ],
  // Closing note.
  [
    'Figures in this article are as reported in the sources above as of 11 November 2026. IPO terms, dates and valuations are preliminary and may change before the offering is completed.',
    'IPO terms in this article were updated on 23 November 2026 to the final pricing terms (see Sources below). Other figures are as reported in the sources above as of 11 November 2026.'
  ]
];

// Global fallbacks for any preliminary figure the specific pairs missed.
const ANTHROPIC_GLOBAL_REPLACEMENTS = [
  ['$1.4 trillion', '$1.5 trillion'],
  ['$1 trillion', '$1.1 trillion'],
  ['$90.4 billion', '$107.3 billion'],
  ['$64.4 billion', '$81.31 billion'],
  ['825 million', '980 million'],
  ['$70 to $78', '$83.00']
];

// Item 15, Riemann: the intro links to the Anthropic article with its old
// "$1.4 trillion" title text; the Anthropic title is now $1.5tn, so the
// link text is fixed at build time to match.
const RIEMANN_REPLACEMENTS = [
  ['what its $1.4 trillion valuation means for AI', 'what its $1.5 trillion valuation means for AI']
];

// Item 15, Huang: the stored article (11 Nov 2026) says "Huang remains
// chief executive while the probe runs". On 12 Nov 2026 Nvidia announced
// he had resigned as President, CEO and board member, with CFO Colette
// Kress as interim CEO and Harvey C. Jones as the board's first-ever Chair
// (NVIDIA press release + CNN, both verified 23 Nov 2026). This dated
// update box is prepended at build time so the page is not misleading; the
// stored conclusion is left untouched.
const HUANG_UPDATE_HTML = `<aside class="article-update" aria-label="Update">
<p><strong>Update — 23 November 2026:</strong> On 12 November 2026, Nvidia announced that Jensen Huang had resigned as President, Chief Executive Officer and a member of the Board, effective immediately. Chief Financial Officer Colette Kress was appointed interim CEO, and Harvey C. Jones was appointed the Board&#x27;s first-ever Chair. The board is searching for a permanent CEO. The article below was written on 11 November 2026, before the resignation, and is kept as published. Sources: <a href="https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-CEO-Transition/default.aspx" target="_blank" rel="noopener">NVIDIA press release, 12 Nov 2026</a> and <a href="https://www.cnn.com/2026/11/12/tech/jensen-huang-nvidia-resigns" target="_blank" rel="noopener">CNN, 12 Nov 2026</a>.</p>
</aside>`;

// ---------------------------------------------------------------------------
// Sources sections (items 15 and 16b). Each entry: { label, url, note }.
// All URLs were verified reachable on 23 Nov 2026 (HTTP 200 via curl, or
// confirmed loading via browser fetch where the host blocks curl).
// ---------------------------------------------------------------------------

const SOURCES_BY_SLUG = {
  // Item 15 — Huang. Confirmed: the affair admission, the board probe, the
  // resignation. Alleged (not proven): the espionage/intelligence claims.
  'jensen-huang-affair-nvidia-investigation': {
    note: '<strong>What is confirmed, and what is not.</strong> <strong>Confirmed:</strong> Huang admitted infidelity on 8 November 2026; Nvidia&#x27;s board opened an independent investigation; Huang resigned as President, CEO and board member on 12 November 2026, with CFO Colette Kress appointed interim CEO and Harvey C. Jones appointed the board&#x27;s first-ever Chair. <strong>Alleged, not proven:</strong> that Alice Huang is a Chinese intelligence asset, that she passed information to Beijing, that Nvidia chips were diverted to China, and that any Nvidia or US secrets were compromised. Those claims are attributed to US officials and news reporting (notably The New York Times and The Wall Street Journal); they have not been independently verified, no charges have been publicly reported, and the FBI itself has not confirmed them — President Trump said the FBI was "looking into it". China&#x27;s Foreign Ministry calls the claims groundless; Megaspeed denies wrongdoing; Nvidia says it has found no evidence of chip smuggling.',
    links: [
      {
        label: 'NVIDIA — "NVIDIA Announces CEO Transition" (press release, 12 Nov 2026)',
        url: 'https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-CEO-Transition/default.aspx',
        note: 'Huang resigned as President, CEO and board member; Colette Kress appointed interim CEO; Harvey C. Jones appointed first-ever Chair of the Board.'
      },
      {
        label: 'CNN — "CFO Colette Kress to serve as interim leader after Nvidia CEO Jensen Huang resignation" (12 Nov 2026)',
        url: 'https://www.cnn.com/2026/11/12/tech/jensen-huang-nvidia-resigns',
        note: 'Resignation after 33 years; Kress interim CEO while the board considers internal and external candidates.'
      },
      {
        label: 'The Motley Fool — "Jensen Huang Is Out as Nvidia Names Colette Kress Interim CEO" (12 Nov 2026)',
        url: 'https://www.fool.com/investing/2026/11/12/jensen-huang-is-out-as-nvidia-names-collette-kress-interim-ceo/',
        note: 'Board accepted the resignation; Kress interim CEO; Harvey Jones the board&#x27;s first Chair.'
      }
    ]
  },
  // Item 15 — Anthropic. Final IPO terms, 19 Nov 2026.
  'anthropic-ipo-2026-valuation-explained': {
    note: '<strong>Final terms (19 November 2026).</strong> Anthropic priced at <strong>$83.00 a share</strong>, selling <strong>980 million shares</strong> to raise <strong>about $81.31 billion</strong>; with the $26 billion private placement the total package was <strong>about $107.3 billion</strong>. Valuation: <strong>about $1.5 trillion fully diluted</strong> and <strong>about $1.1 trillion on shares outstanding</strong>. Trading began on 19 November 2026 on Nasdaq under the ticker <strong>ANT</strong>. The figures in this article were updated to these final terms on 23 November 2026.',
    links: [
      {
        label: 'Reuters (via CNA) — "Anthropic clinches biggest IPO ever with US$81 billion offering" (19 Nov 2026)',
        url: 'https://www.channelnewsasia.com/business/anthropic-share-price-ipo-6563856',
        note: '980 million shares at $83.00; about $81.31 billion raised; largest IPO on record.'
      },
      {
        label: 'Al Jazeera — "Anthropic raises $81.3bn in biggest IPO of all time" (19 Nov 2026)',
        url: 'https://www.aljazeera.com/economy/2026/11/19/anthropic-raises-81-3bn-in-biggest-ipo-of-all-time',
        note: '$81.3 billion raised; about $1.5 trillion fully diluted valuation.'
      },
      {
        label: 'Al Jazeera — "Anthropic starts trading in the US after blockbuster IPO" (19 Nov 2026)',
        url: 'https://www.aljazeera.com/economy/2026/11/19/anthropic-starts-trading-in-the-us-after-blockbuster-ipo',
        note: 'Trading began 19 November 2026 on Nasdaq (ANT).'
      }
    ]
  },
  // Item 15 — Riemann. The claim is UNVERIFIED with competing claims.
  'riemann-hypothesis-solved-claude-ai-stanford': {
    note: '<strong>Status: not yet confirmed.</strong> Two claims were made on 20 November 2026 — Levent Alpöge with Claude AI (a Lean formalisation, about 17 million lines) and Stanford&#x27;s Alessandro Masullo (a human-written draft, about 940 pages). The Lean code compiles and passed independent machine checks, but no expert has yet verified the proof in the human sense, and Masullo&#x27;s draft already needs major revisions after problems were found. The Clay Mathematics Institute still lists the Riemann Hypothesis as <strong>unsolved</strong>, and the $1 million prize requires publication in a peer-reviewed journal plus a two-year wait.',
    links: [
      {
        label: 'Nature — "Mathematicians astounded by AI and human-written proofs of iconic Riemann hypothesis" (21 Nov 2026)',
        url: 'https://www.nature.com/articles/d41586-026-03812-7',
        note: 'Both claims reported; neither verified as a proof yet.'
      },
      {
        label: 'The Decoder — "Hours after Anthropic claims a Claude proof of the Riemann hypothesis, Stanford releases an all-human competing draft" (20 Nov 2026)',
        url: 'https://the-decoder.com/hours-after-anthropic-claims-a-claude-proof-of-the-riemann-hypothesis-stanford-releases-an-all-human-competing-draft/',
        note: 'Alpöge + Claude Lean proof and Masullo human draft on the same day.'
      },
      {
        label: 'DataCamp — "AI solved Riemann Hypothesis" (20 Nov 2026)',
        url: 'https://www.datacamp.com/blog/ai-solved-riemann-hypothesis',
        note: 'Summary of the Alpöge + Claude claim and the Lean verification.'
      },
      {
        label: 'Clay Mathematics Institute — Riemann Hypothesis (Millennium Prize Problems)',
        url: 'https://www.claymath.org/millennium/riemann-hypothesis/',
        note: 'Still listed as unsolved; prize needs peer-reviewed publication and a two-year wait.'
      }
    ]
  },
  // Item 16b — Christmas decor. Prices in the article are planning ranges
  // checked in autumn 2026, not live quotes (the article says so); these
  // are the authoritative safety/environmental sources it relies on.
  'christmas-decor-uk': {
    note: 'Prices in this article are planning ranges checked in autumn 2026, not live quotes — check the retailer before you buy. Safety and environmental claims are from the official sources below.',
    links: [
      {
        label: 'GOV.UK — "Find a new home for your Christmas tree" (Carbon Trust)',
        url: 'https://www.gov.uk/government/news/find-a-new-home-for-your-christmas-tree',
        note: 'An artificial tree may need up to ten uses before its environmental impact falls below that of a real tree bought each year.'
      },
      {
        label: 'London Fire Brigade — "Christmas trees: avoid a festive fire hazard"',
        url: 'https://www.london-fire.gov.uk/safety/christmas-fire-safety/christmas-trees/',
        note: 'Real trees can drink up to two pints of water a day; a real tree is only relatively safe for about two weeks indoors; never burn branches or needles in a fireplace.'
      }
    ]
  },
  // Item 16b — UK accounting software. Xero prices are the current
  // post-1-Sept-2026 prices. QuickBooks UK prices in the article are the
  // pre-2-Nov-2026 prices — see WRONG_FIGURES_FOUND in the Phase 3 report;
  // the official pricing page below shows the current figures.
  'best-accounting-software-small-business-uk': {
    note: 'Prices are monthly list prices before introductory offers, as checked on 8 November 2026 in the article. Vendor prices change — confirm the current price on the official pricing page before you buy.',
    links: [
      {
        label: 'Xero UK — Pricing plans',
        url: 'https://www.xero.com/uk/pricing-plans/',
        note: 'Simple £7, Ignite £18, Grow £39, Comprehensive £55, Ultimate £70 a month, excluding VAT (from 1 September 2026).'
      },
      {
        label: 'QuickBooks UK — Pricing & Costs (Intuit)',
        url: 'https://quickbooks.intuit.com/uk/pricing/',
        note: 'Official UK pricing page. Intuit raised four of the five UK prices on 2 November 2026 — check the current figures here.'
      },
      {
        label: 'GOV.UK — "Sole traders and landlords earning more than £30,000 urged to act now" (Making Tax Digital for Income Tax)',
        url: 'https://www.gov.uk/government/news/sole-traders-and-landlords-earning-more-than-30000-urged-to-act-now',
        note: 'MTD for Income Tax: over £50,000 from 6 April 2026, over £30,000 from 6 April 2027, over £20,000 from April 2028.'
      },
      {
        label: 'GOV.UK — VAT registration thresholds',
        url: 'https://www.gov.uk/vat-registration-thresholds',
        note: 'Registration threshold £90,000 of taxable turnover in a rolling 12 months; deregistration £88,000.'
      }
    ]
  },
  // Item 16b — US accounting software. QuickBooks US prices verified
  // against Intuit's own pricing page; SBA count from the Feb 2026 FAQ.
  'best-accounting-software-small-business-usa-2026': {
    note: 'QuickBooks US prices are the November 2026 list prices from Intuit&#x27;s own pricing page. Vendor prices change — confirm the current price before you buy.',
    links: [
      {
        label: 'QuickBooks (Intuit) — Online Pricing & Free Trial (US)',
        url: 'https://quickbooks.intuit.com/pricing/',
        note: 'Simple Start $38, Essentials $85, Plus $140, Advanced $340 a month.'
      },
      {
        label: 'SBA Office of Advocacy — "Frequently Asked Questions About Small Business" (February 2026)',
        url: 'https://advocacy.sba.gov/wp-content/uploads/2026/02/FINAL_FAQsAboutSmallBusiness_2026_012826.pdf',
        note: '36,207,130 small businesses in the US (2022 Census data), 99.9% of all US firms.'
      },
      {
        label: 'IRS — Small Business and Self-Employed Tax Center',
        url: 'https://www.irs.gov/businesses/small-businesses-self-employed',
        note: 'IRS guidance for small businesses and the self-employed.'
      }
    ]
  },
  // Item 16b — Statistics roundup. Figures are attributed in-text to the
  // named survey or agency; these are the primary sources for the headline
  // numbers (all other figures in the article name their source and year).
  'make-money-online-statistics-2026': {
    note: 'Every figure in this article names its source and year in the text. The links below are the primary sources for the headline numbers; surveys measure different things, so figures from different sources are not directly comparable.',
    links: [
      {
        label: 'US Census Bureau — Quarterly Retail E-Commerce Sales (Q4 2025, released 10 Mar 2026)',
        url: 'https://www2.census.gov/retail/releases/historical/ecomm/25q4.pdf',
        note: 'US retail e-commerce $1,233.7 billion in 2025, up 5.4% on 2024, 16.4% of all retail sales.'
      },
      {
        label: 'MBO Partners — "15 Years, One Movement: The Return on Independence" (State of Independence, 2025)',
        url: 'https://info.mbopartners.com/rs/mbo/images/MBO_2025_State_of_Independence_Research_Report.pdf',
        note: '72.9 million US independent workers in 2025 (27.6 million full time); a record 5.6 million earned over $100,000.'
      },
      {
        label: 'SBA Office of Advocacy — "Frequently Asked Questions About Small Business" (February 2026)',
        url: 'https://advocacy.sba.gov/wp-content/uploads/2026/02/FINAL_FAQsAboutSmallBusiness_2026_012826.pdf',
        note: '36,207,130 small businesses in the US, 99.9% of all US firms.'
      },
      {
        label: 'FTC — "Paying to get paid: gamified job scams drive record losses" (Data Spotlight, December 2024)',
        url: 'https://www.ftc.gov/system/files/ftc_gov/pdf/task-scams-spotlight-2024.pdf',
        note: 'Reported losses to job scams: $90 million (2020), $286 million (2023), $223 million in the first half of 2024 alone; about 20,000 task-scam reports in H1 2024 vs about 5,000 in all of 2023.'
      }
    ]
  }
};

// Item 16b — the 22 Business posts dated 11 Nov 2026. Each gets the
// official gov.uk / HMRC / IRS / SBA pages for the figures it uses. Posts
// that are general advice (marketing, pricing, CRM, tools) link to the
// relevant official business-startup guidance instead — there is no single
// official source for "how to get customers".
const BUSINESS_SOURCES = {
  'uk-budget-2026-small-business': [
    {
      label: 'HM Treasury — Budget 2026 (HC 726, 28 October 2026)',
      url: 'https://assets.publishing.service.gov.uk/media/6ae1ec57bdb574cf1c9b3f12/E03668986_HMT_Budget_2026_ELAY__2_.pdf',
      note: 'Official Budget 2026 document: trading allowance £1,000 to £3,000 from 6 April 2027; Small Business Rates Relief threshold £12,000 to £18,000 (tapered to £21,000) for retail, hospitality and leisure from April 2027.'
    },
    {
      label: 'GOV.UK — "Sole traders and landlords earning more than £30,000 urged to act now" (Making Tax Digital)',
      url: 'https://www.gov.uk/government/news/sole-traders-and-landlords-earning-more-than-30000-urged-to-act-now',
      note: 'MTD for Income Tax thresholds: £50,000 from 6 April 2026, £30,000 from 6 April 2027, £20,000 from April 2028.'
    },
    {
      label: 'GOV.UK — National Living Wage increases to £12.71 per hour',
      url: 'https://www.gov.uk/government/news/national-living-wage-increases-to-1271-per-hour',
      note: 'National Living Wage £12.71 (21+), £10.85 (18–20), £8.00 (under 18 / apprentice) from 1 April 2026.'
    },
    {
      label: 'GOV.UK — Corporation Tax',
      url: 'https://www.gov.uk/corporation-tax',
      note: 'Corporation Tax 19% on profits up to £50,000, 25% over £250,000, with marginal relief between.'
    }
  ],
  'how-to-hire-first-employee-uk': [
    {
      label: 'GOV.UK — Employing staff',
      url: 'https://www.gov.uk/employing-staff',
      note: 'Official guidance on taking on your first employee, PAYE and employer duties.'
    },
    {
      label: 'GOV.UK — National Living Wage increases to £12.71 per hour',
      url: 'https://www.gov.uk/government/news/national-living-wage-increases-to-1271-per-hour',
      note: 'National Living Wage £12.71 (21+), £10.85 (18–20), £8.00 (under 18 / apprentice) from 1 April 2026.'
    },
    {
      label: 'GOV.UK — Statutory Payments Manual (HMRC)',
      url: 'https://www.gov.uk/hmrc-internal-manuals/statutory-payments-manual/spm220400',
      note: 'Statutory Sick Pay £123.25 a week and Statutory Maternity Pay £194.32 a week for 2026/27.'
    },
    {
      label: 'GOV.UK — Self-employed and employed National Insurance rates',
      url: 'https://www.gov.uk/self-employed-national-insurance-rates',
      note: 'Class 4 National Insurance 6% on profits £12,570–£50,270 and 2% above; voluntary Class 2 £3.65 a week; small profits threshold £7,105 (2026/27).'
    }
  ],
  'how-to-get-first-customers-uk-small-business': [
    {
      label: 'GOV.UK — Set up as a sole trader',
      url: 'https://www.gov.uk/set-up-as-sole-trader',
      note: 'Official starting point for a UK sole trader: registering with HMRC and the rules that apply.'
    },
    {
      label: 'SBA — "10 steps to start your business"',
      url: 'https://www.sba.gov/business-guide/10-steps-start-your-business',
      note: 'The SBA&#x27;s step-by-step guide to starting a business, including market research and finding customers.'
    }
  ],
  'digital-marketing-strategies-small-business-uk': [
    {
      label: 'GOV.UK — Set up as a sole trader',
      url: 'https://www.gov.uk/set-up-as-sole-trader',
      note: 'Official starting point for a UK sole trader.'
    },
    {
      label: 'SBA — "10 steps to start your business"',
      url: 'https://www.sba.gov/business-guide/10-steps-start-your-business',
      note: 'The SBA&#x27;s step-by-step guide, including market research and marketing a new business.'
    }
  ],
  'vat-registration-threshold-uk-small-business': [
    {
      label: 'GOV.UK — VAT registration thresholds',
      url: 'https://www.gov.uk/vat-registration-thresholds',
      note: 'Registration threshold £90,000 of taxable turnover in a rolling 12 months; deregistration £88,000.'
    },
    {
      label: 'GOV.UK — "Sole traders and landlords earning more than £30,000 urged to act now" (Making Tax Digital)',
      url: 'https://www.gov.uk/government/news/sole-traders-and-landlords-earning-more-than-30000-urged-to-act-now',
      note: 'MTD for Income Tax thresholds and dates.'
    },
    {
      label: 'GOV.UK — Corporation Tax',
      url: 'https://www.gov.uk/corporation-tax',
      note: 'Corporation Tax rates and marginal relief.'
    }
  ],
  'how-to-register-as-sole-trader-uk': [
    {
      label: 'GOV.UK — Set up as a sole trader',
      url: 'https://www.gov.uk/set-up-as-sole-trader',
      note: 'Registering as a sole trader is free; you tell HMRC you are self-employed and get a Unique Taxpayer Reference.'
    },
    {
      label: 'GOV.UK — Register for Self Assessment (self-employed)',
      url: 'https://www.gov.uk/register-for-self-assessment/self-employed',
      note: 'How and when to register for Self Assessment as a self-employed person.'
    },
    {
      label: 'GOV.UK — Self-employed National Insurance rates',
      url: 'https://www.gov.uk/self-employed-national-insurance-rates',
      note: 'Class 4 6% on profits £12,570–£50,270 and 2% above; voluntary Class 2 £3.65 a week (2026/27).'
    },
    {
      label: 'GOV.UK — VAT registration thresholds',
      url: 'https://www.gov.uk/vat-registration-thresholds',
      note: 'VAT registration threshold £90,000 in a rolling 12 months.'
    }
  ],
  'sole-trader-vs-limited-company-uk': [
    {
      label: 'GOV.UK — Set up as a sole trader',
      url: 'https://www.gov.uk/set-up-as-sole-trader',
      note: 'Sole trader: you register with HMRC, there is no fee, and you keep the profit after tax.'
    },
    {
      label: 'GOV.UK — Set up a limited company',
      url: 'https://www.gov.uk/limited-company-formation',
      note: 'Registering a limited company with Companies House; incorporation costs £100 online.'
    },
    {
      label: 'GOV.UK — Companies House fees',
      url: 'https://www.gov.uk/government/publications/companies-house-fees/companies-house-fees',
      note: 'Incorporation £100 online or via software, £124 on paper, £156 same-day via software.'
    },
    {
      label: 'GOV.UK — Corporation Tax',
      url: 'https://www.gov.uk/corporation-tax',
      note: 'A limited company pays Corporation Tax on its profits; you pay tax on salary and dividends.'
    }
  ],
  'small-business-ideas-uk-under-1000': [
    {
      label: 'GOV.UK — Set up as a sole trader',
      url: 'https://www.gov.uk/set-up-as-sole-trader',
      note: 'Starting as a sole trader is free.'
    },
    {
      label: 'GOV.UK — Register for Self Assessment (self-employed)',
      url: 'https://www.gov.uk/register-for-self-assessment/self-employed',
      note: 'You must register for Self Assessment if you earn more than £1,000 from self-employment in a tax year (the trading allowance).'
    },
    {
      label: 'British Business Bank — Start Up Loans',
      url: 'https://www.british-business-bank.co.uk/business-guidance/guidance-articles/finance/start-up-loan',
      note: 'Borrow £500 to £25,000 over one to five years at a fixed 7.5% a year; unsecured, with 12 months of free mentoring.'
    }
  ],
  'small-business-ideas-uk-2026': [
    {
      label: 'GOV.UK — Set up as a sole trader',
      url: 'https://www.gov.uk/set-up-as-sole-trader',
      note: 'Starting as a sole trader is free.'
    },
    {
      label: 'GOV.UK — Register for Self Assessment (self-employed)',
      url: 'https://www.gov.uk/register-for-self-assessment/self-employed',
      note: 'Register for Self Assessment if you earn more than £1,000 from self-employment in a tax year.'
    },
    {
      label: 'British Business Bank — Start Up Loans',
      url: 'https://www.british-business-bank.co.uk/business-guidance/guidance-articles/finance/start-up-loan',
      note: 'Borrow £500 to £25,000 over one to five years at a fixed 7.5% a year.'
    }
  ],
  'how-to-start-a-small-business-uk': [
    {
      label: 'GOV.UK — Set up as a sole trader',
      url: 'https://www.gov.uk/set-up-as-sole-trader',
      note: 'Registering as a sole trader is free.'
    },
    {
      label: 'GOV.UK — Set up a limited company',
      url: 'https://www.gov.uk/limited-company-formation',
      note: 'Registering a limited company; incorporation costs £100 online.'
    },
    {
      label: 'GOV.UK — VAT registration thresholds',
      url: 'https://www.gov.uk/vat-registration-thresholds',
      note: 'You must register for VAT if taxable turnover goes over £90,000 in the last 12 months.'
    },
    {
      label: 'GOV.UK — Corporation Tax',
      url: 'https://www.gov.uk/corporation-tax',
      note: 'Corporation Tax 19% up to £50,000, 25% over £250,000, with marginal relief between.'
    }
  ],
  'how-to-price-product-service-small-business': [
    {
      label: 'SBA — "10 steps to start your business"',
      url: 'https://www.sba.gov/business-guide/10-steps-start-your-business',
      note: 'The SBA&#x27;s step-by-step guide, including pricing and financial planning.'
    },
    {
      label: 'GOV.UK — Set up as a sole trader',
      url: 'https://www.gov.uk/set-up-as-sole-trader',
      note: 'Official starting point for a UK sole trader.'
    }
  ],
  'how-to-fund-a-small-business': [
    {
      label: 'SBA — 7(a) Loans',
      url: 'https://www.sba.gov/funding-programs/loans/7a-loans',
      note: 'SBA 7(a) loans: up to $5 million; SBA guarantee 85% on loans up to $150,000 and 75% above.'
    },
    {
      label: 'British Business Bank — Start Up Loans',
      url: 'https://www.british-business-bank.co.uk/business-guidance/guidance-articles/finance/start-up-loan',
      note: 'Borrow £500 to £25,000 over one to five years at a fixed 7.5% a year; unsecured.'
    },
    {
      label: 'SBA Office of Advocacy — "Frequently Asked Questions About Small Business" (February 2026)',
      url: 'https://advocacy.sba.gov/wp-content/uploads/2026/02/FINAL_FAQsAboutSmallBusiness_2026_012826.pdf',
      note: '36,207,130 small businesses in the US, 99.9% of all US firms.'
    }
  ],
  'digital-marketing-strategies-small-business': [
    {
      label: 'SBA — "10 steps to start your business"',
      url: 'https://www.sba.gov/business-guide/10-steps-start-your-business',
      note: 'The SBA&#x27;s step-by-step guide, including market research and marketing.'
    },
    {
      label: 'IRS — Small Business and Self-Employed Tax Center',
      url: 'https://www.irs.gov/businesses/small-businesses-self-employed',
      note: 'IRS guidance for small businesses and the self-employed.'
    }
  ],
  'best-crm-software-small-business': [
    {
      label: 'SBA — "10 steps to start your business"',
      url: 'https://www.sba.gov/business-guide/10-steps-start-your-business',
      note: 'The SBA&#x27;s step-by-step guide to starting and running a small business.'
    },
    {
      label: 'IRS — Small Business and Self-Employed Tax Center',
      url: 'https://www.irs.gov/businesses/small-businesses-self-employed',
      note: 'IRS guidance for small businesses and the self-employed.'
    }
  ],
  'best-business-tools-small-business': [
    {
      label: 'SBA — "10 steps to start your business"',
      url: 'https://www.sba.gov/business-guide/10-steps-start-your-business',
      note: 'The SBA&#x27;s step-by-step guide to starting and running a small business.'
    },
    {
      label: 'IRS — Small Business and Self-Employed Tax Center',
      url: 'https://www.irs.gov/businesses/small-businesses-self-employed',
      note: 'IRS guidance for small businesses and the self-employed.'
    }
  ],
  'how-to-get-an-ein-small-business': [
    {
      label: 'IRS — Apply for an Employer Identification Number (EIN) Online',
      url: 'https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online',
      note: 'An EIN is free from the IRS — never pay a fee for one. Apply online and get it immediately.'
    },
    {
      label: 'IRS — Small Business and Self-Employed Tax Center',
      url: 'https://www.irs.gov/businesses/small-businesses-self-employed',
      note: 'IRS guidance for small businesses and the self-employed.'
    },
    {
      label: 'SBA — "10 steps to start your business"',
      url: 'https://www.sba.gov/business-guide/10-steps-start-your-business',
      note: 'The SBA&#x27;s step-by-step guide, including getting an EIN and registering the business.'
    }
  ],
  'llc-vs-sole-proprietorship-usa': [
    {
      label: 'SBA — Choose a business structure',
      url: 'https://www.sba.gov/business-guide/launch-your-business/choose-business-structure',
      note: 'Sole proprietorship: you are automatically one if you do business but do not register another structure. LLC: a separate legal entity.'
    },
    {
      label: 'IRS — Small Business and Self-Employed Tax Center',
      url: 'https://www.irs.gov/businesses/small-businesses-self-employed',
      note: 'IRS guidance on business structures and tax.'
    },
    {
      label: 'SBA — "10 steps to start your business"',
      url: 'https://www.sba.gov/business-guide/10-steps-start-your-business',
      note: 'The SBA&#x27;s step-by-step guide to starting a business.'
    }
  ],
  'how-to-write-a-business-plan-small-business': [
    {
      label: 'SBA — Write your business plan',
      url: 'https://www.sba.gov/business-guide/plan-your-business/write-your-business-plan',
      note: 'The SBA says there is no single right way to write a plan; what matters is that it meets your needs. Covers traditional and lean startup formats.'
    },
    {
      label: 'SBA — "10 steps to start your business"',
      url: 'https://www.sba.gov/business-guide/10-steps-start-your-business',
      note: 'The SBA&#x27;s step-by-step guide to starting a business.'
    }
  ],
  'small-business-ideas-2026-usa': [
    {
      label: 'SBA — "10 steps to start your business"',
      url: 'https://www.sba.gov/business-guide/10-steps-start-your-business',
      note: 'The SBA&#x27;s step-by-step guide to starting a business.'
    },
    {
      label: 'SBA Office of Advocacy — "Frequently Asked Questions About Small Business" (February 2026)',
      url: 'https://advocacy.sba.gov/wp-content/uploads/2026/02/FINAL_FAQsAboutSmallBusiness_2026_012826.pdf',
      note: '36,207,130 small businesses in the US, 99.9% of all US firms.'
    },
    {
      label: 'IRS — Small Business and Self-Employed Tax Center',
      url: 'https://www.irs.gov/businesses/small-businesses-self-employed',
      note: 'IRS guidance for small businesses and the self-employed.'
    }
  ],
  'how-to-start-a-small-business-usa': [
    {
      label: 'SBA — "10 steps to start your business"',
      url: 'https://www.sba.gov/business-guide/10-steps-start-your-business',
      note: 'Research, plan, fund, choose a structure, pick a name, register, get tax numbers and licences, then open for business.'
    },
    {
      label: 'SBA — Choose a business structure',
      url: 'https://www.sba.gov/business-guide/launch-your-business/choose-business-structure',
      note: 'Sole proprietorship, LLC, corporation and other structures compared.'
    },
    {
      label: 'IRS — Apply for an Employer Identification Number (EIN) Online',
      url: 'https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online',
      note: 'An EIN is free from the IRS.'
    },
    {
      label: 'IRS — Small Business and Self-Employed Tax Center',
      url: 'https://www.irs.gov/businesses/small-businesses-self-employed',
      note: 'IRS guidance for small businesses and the self-employed.'
    }
  ]
};

// Item 17 — Health & Fitness Sources boxes (NHS / CDC / WHO only).
// Two sets: exercise-focused and weight-loss-focused. All URLs verified
// reachable on 23 Nov 2026.
const HEALTH_SOURCE_SETS = {
  exercise: [
    {
      label: 'NHS — Physical activity guidelines for adults aged 19 to 64',
      url: 'https://www.nhs.uk/live-well/exercise/physical-activity-guidelines-for-adults-aged-19-to-64/',
      note: 'At least 150 minutes of moderate activity or 75 minutes of vigorous activity a week, plus muscle-strengthening on at least 2 days a week.'
    },
    {
      label: 'WHO — Physical activity (fact sheet)',
      url: 'https://www.who.int/news-room/fact-sheets/detail/physical-activity',
      note: 'WHO recommendations on physical activity for health.'
    },
    {
      label: 'CDC — Health Benefits of Physical Activity for Adults',
      url: 'https://www.cdc.gov/physical-activity-basics/health-benefits/adults.html',
      note: 'Immediate and long-term benefits of regular physical activity.'
    }
  ],
  weightLoss: [
    {
      label: 'NHS — 12 tips to help you lose weight',
      url: 'https://www.nhs.uk/live-well/healthy-weight/managing-your-weight/12-tips-to-help-you-lose-weight/',
      note: 'The NHS weight-loss plan: regular meals, more activity, plenty of fruit and veg, and planning meals.'
    },
    {
      label: 'NHS — Physical activity guidelines for adults aged 19 to 64',
      url: 'https://www.nhs.uk/live-well/exercise/physical-activity-guidelines-for-adults-aged-19-to-64/',
      note: 'At least 150 minutes of moderate activity or 75 minutes of vigorous activity a week, plus muscle-strengthening on at least 2 days a week.'
    },
    {
      label: 'WHO — Physical activity (fact sheet)',
      url: 'https://www.who.int/news-room/fact-sheets/detail/physical-activity',
      note: 'WHO recommendations on physical activity for health.'
    },
    {
      label: 'CDC — Health Benefits of Physical Activity for Adults',
      url: 'https://www.cdc.gov/physical-activity-basics/health-benefits/adults.html',
      note: 'Immediate and long-term benefits of regular physical activity.'
    }
  ]
};

// Item 17 — which Health & Fitness exercise/weight-loss post gets which set.
const HEALTH_SOURCES_BY_SLUG = {
  'strength-training-on-glp-1': 'weightLoss',
  'nuffield-health-gym-near-me': 'exercise',
  '30-30-30-rule': 'weightLoss',
  'hyrox-workout': 'exercise',
  'benefits-of-working-out-in-the-morning': 'exercise',
  'stomach-fat-workout': 'weightLoss',
  'workouts-to-lose-belly-fat': 'weightLoss',
  'best-cardio-for-weight-loss': 'weightLoss',
  'best-weight-loss-exercises-small-uk-flat': 'weightLoss'
};

// Item 17 — health disclaimer (9 exercise/weight-loss Health & Fitness posts).
const HEALTH_DISCLAIMER_SLUGS = new Set(Object.keys(HEALTH_SOURCES_BY_SLUG));

const HEALTH_DISCLAIMER_HTML = `<aside class="article-disclaimer" aria-label="Health disclaimer">
<p><strong>Health disclaimer:</strong> This article is for general information only and is not medical advice. It does not replace advice from a qualified health professional. If you have a medical condition, are pregnant, take medication, or are starting a new exercise or weight-loss programme, speak to your GP or another qualified health professional first. Stop exercising and seek medical help if you feel chest pain, severe breathlessness, dizziness or faintness.</p>
</aside>`;

// Item 17 — financial disclaimer. Applied to the 14 Make Money Online posts,
// the 19 Business posts about tax/legal/credit/incorporation/insurance, and
// — by topic, because they are about insurance products — the 6 insurance
// posts that sit in Health & Fitness pending item 18 (which would move them
// to Business). No "Reviewed by" line anywhere (needs the user's answer).
const FINANCIAL_DISCLAIMER_SLUGS = new Set([
  // Make Money Online (14).
  'how-to-make-money-on-youtube-uk',
  'real-ways-to-make-money-from-home-for-free',
  'ways-for-females-to-make-money-online',
  'how-to-make-passive-income-online',
  'how-to-earn-extra-money-at-home',
  'make-money-online-statistics-2026',
  'how-to-make-money-from-home',
  'make-money-from-your-phone-guia-espana',
  'make-money-from-your-phone-us-guide',
  'make-money-from-your-phone-uk-guide',
  'make-money-from-your-phone-guide-france',
  'make-money-online-fast-uk-guide',
  'remote-side-hustles-2026',
  'best-freelance-jobs-2026',
  // Business: tax / legal / credit / incorporation / insurance (19).
  'business-line-of-credit-ligne-credit-france',
  'business-line-of-credit-us-guide',
  'business-line-of-credit-uk-guide',
  'incorporation-guia-emprendedores-espana',
  'incorporation-guide-entrepreneurs-francais',
  'incorporation-register-a-company-us',
  'incorporation-uk-register-a-company',
  'llc-guia-emprendedores-espana',
  'llc-guide-entrepreneurs-francais',
  'llc-what-it-is-and-how-to-form-one',
  'business-line-of-credit-poliza-credito-espana',
  'llc-in-the-uk-equivalent',
  'uk-budget-2026-small-business',
  'vat-registration-threshold-uk-small-business',
  'how-to-register-as-sole-trader-uk',
  'sole-trader-vs-limited-company-uk',
  'how-to-fund-a-small-business',
  'how-to-get-an-ein-small-business',
  'llc-vs-sole-proprietorship-usa',
  // Health & Fitness insurance posts (about insurance products, so the
  // financial disclaimer fits their topic; item 18, held, would move them).
  'short-term-disability-insurance-us-guide',
  'medicare-supplement-plans-us-guide',
  'medicare-advantage-plans-us-guide',
  'private-medical-insurance-us-guide',
  'health-insurance-us-guide',
  'health-insurance-uk-guide'
]);

const FINANCIAL_DISCLAIMER_HTML = `<aside class="article-disclaimer" aria-label="Financial disclaimer">
<p><strong>Disclaimer:</strong> This article is for general information only and is not financial, tax or legal advice. Tax rules, rates, thresholds and product prices change, and what applies to you depends on your own circumstances. Check the current rules with the official source linked below, and speak to a qualified accountant, financial adviser or solicitor before you act on anything here.</p>
</aside>`;

// ---------------------------------------------------------------------------
// Phase 3 helpers
// ---------------------------------------------------------------------------

function buildSourcesSection(entry, heading) {
  const items = entry.links
    .map(
      (link) =>
        `<li><a href="${escapeAttr(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.label)}</a>${link.note ? ` — ${link.note}` : ''}</li>`
    )
    .join('');
  return `<section class="article-sources" aria-label="Sources">
<h2>${escapeHtml(heading || 'Sources')}</h2>
${entry.note ? `<p>${entry.note}</p>` : ''}
<ul>${items}</ul>
<p>Sources checked 23 November 2026. If a link has moved since then, search the publisher&#x27;s site for the title above.</p>
</section>`;
}

function applyReplacements(body, replacements, label) {
  let out = body;
  for (const [from, to] of replacements) {
    if (!out.includes(from)) {
      console.warn(`Phase 3 (${label}): replacement source not found, skipped: ${JSON.stringify(from.slice(0, 90))}`);
      continue;
    }
    out = out.split(from).join(to);
  }
  return out;
}

// Inject a block after the intro paragraph (the first </p>), so it sits
// before the first heading. Falls back to before the first heading, then
// to the top of the body.
function injectAfterIntro(body, html) {
  const closeP = body.indexOf('</p>');
  if (closeP !== -1) {
    const at = closeP + '</p>'.length;
    return body.slice(0, at) + '\n\n' + html + body.slice(at);
  }
  const heading = body.search(/<h[2-6]\b/i);
  if (heading !== -1) return body.slice(0, heading) + html + '\n\n' + body.slice(heading);
  return html + '\n\n' + body;
}

function applyPhase3Enhancements(post, body) {
  const slug = String(post.slug || '');
  let out = body;

  // Item 15 — Anthropic: replace preliminary IPO figures with final terms.
  if (slug === ANTHROPIC_SLUG) {
    out = applyReplacements(out, ANTHROPIC_REPLACEMENTS, 'anthropic');
    out = applyReplacements(out, ANTHROPIC_GLOBAL_REPLACEMENTS, 'anthropic-global');
  }
  // Item 15 — Riemann: fix the Anthropic link text ($1.4tn -> $1.5tn).
  if (slug === RIEMANN_SLUG) {
    out = applyReplacements(out, RIEMANN_REPLACEMENTS, 'riemann');
  }
  // Item 15 — Huang: prepend the dated resignation update box.
  if (slug === HUANG_SLUG) {
    out = `${HUANG_UPDATE_HTML}\n\n${out}`;
  }

  // Item 17 — disclaimer after the intro.
  if (HEALTH_DISCLAIMER_SLUGS.has(slug)) {
    out = injectAfterIntro(out, HEALTH_DISCLAIMER_HTML);
  } else if (FINANCIAL_DISCLAIMER_SLUGS.has(slug)) {
    out = injectAfterIntro(out, FINANCIAL_DISCLAIMER_HTML);
  }

  // Items 15 + 16b — Sources section(s) appended at the end of the body.
  const sources = [];
  if (SOURCES_BY_SLUG[slug]) sources.push(SOURCES_BY_SLUG[slug]);
  if (BUSINESS_SOURCES[slug]) sources.push({ links: BUSINESS_SOURCES[slug] });
  for (const entry of sources) {
    out += `\n\n${buildSourcesSection(entry, 'Sources')}`;
  }
  // Item 17 — Health & Fitness NHS/CDC/WHO Sources box.
  if (HEALTH_SOURCES_BY_SLUG[slug]) {
    out += `\n\n${buildSourcesSection(
      { links: HEALTH_SOURCE_SETS[HEALTH_SOURCES_BY_SLUG[slug]] },
      'Sources: health guidance'
    )}`;
  }

  return out;
}

// Item 15, Anthropic: build-time title/meta overrides (final IPO terms).
// Applied to the loaded posts in buildPages() so the homepage, category
// pages and article page all show the same title. Stored content is never
// changed.
function applyPhase3TitleOverrides(posts) {
  for (const post of posts) {
    if (String(post.slug) === ANTHROPIC_SLUG) {
      post.title = ANTHROPIC_TITLE_OVERRIDE.title;
      post.meta_title = ANTHROPIC_TITLE_OVERRIDE.meta_title;
      post.meta_description = ANTHROPIC_TITLE_OVERRIDE.meta_description;
      // The article page's standfirst (#article-summary) is built from
      // post.summary / post.excerpt, so override those too — the stored
      // summary still carries the preliminary figures.
      post.summary = ANTHROPIC_TITLE_OVERRIDE.summary;
      post.excerpt = ANTHROPIC_TITLE_OVERRIDE.summary;
    }
  }
  return posts;
}

// ---------------------------------------------------------------------------
// Phase 4 (23 Nov 2026) — content-quality build-time enhancements
// (items 24, 25, 26, 27, 28, 29).
//
// READ THIS BEFORE EDITING. Article body/meta content lives in Supabase
// (the API) and this repo has NO Supabase write access, so every
// enhancement below is applied at BUILD time in this file, at static-page
// generation. The stored content is NEVER modified: it stays the source of
// truth, and every change here is reversible by removing this section.
// Slugs are listed explicitly so the behaviour is auditable. Nothing here
// invents an author, credential, statistic, source, quote or date, and no
// post is merged, removed, unpublished or redirected (items 22 and 23 are
// proposal-only and live in phase4_duplicate_families.md /
// phase4_gta6_proposal.md in the backup folder — NOT in this file).
//
// What this section does, by item:
//   24 — Rewrites the 3 paragraphs that ways-for-females-to-make-money-
//        online shared verbatim with how-to-earn-extra-money-at-home
//        (two 30-day-plan steps + the HMRC FAQ answer). Only the females
//        post is rewritten, in its own voice; the facts are unchanged
//        (the £1,000 trading allowance, Self Assessment above it).
//   25 — A "Related guides" box appended to the 71 posts whose stored
//        content has no internal links (INTERNAL_LINKS_BY_SLUG below:
//        3 topically relevant clean /<slug>/ links each, same language
//        first). The 63 posts that already link internally are untouched.
//   26 — Any <h1> left inside an article body is demoted to <h2>, so
//        every generated page has exactly one H1 (the post title).
//   27 — Real rewrites (not truncation) of the 18 titles over 60 chars
//        and the 17 descriptions outside 120-155 chars. Applied to the
//        loaded posts in buildPages() (applyPhase4Overrides) so the
//        homepage, category pages and article page all agree. Stored
//        meta_title/meta_description are never changed.
//   28 — Reciprocal hreflang + x-default for the 14 translation groups
//        whose members are genuinely the same article in another language
//        (verified: same heading count and parallel headings, e.g. LLC
//        16 headings in EN/FR/ES). UK/US English variants use en-GB /
//        en-US; the generic English version uses plain en. Posts with no
//        true translation get correct lang + self-canonical only, no
//        hreflang. No redirect/removal is proposed (question f unanswered).
//   29 — Tags for the 6 tag-less posts (same lowercase-phrase style as
//        the rest of the site) and descriptive alt text for the 4 in-body
//        images that had none (2 in medicare-advantage, 2 empty alt=""
//        in the Spanish phone guide), verified against Pexels.
// ---------------------------------------------------------------------------

// Item 27: title rewrites — every value is 60 chars or fewer.
const TITLE_OVERRIDES = {
  "riemann-hypothesis-solved-claude-ai-stanford": "Riemann Hypothesis: Two Proof Claims Explained",
  "ai-in-finance": "AI in Finance: Banking, Trading and Wealth in 2026",
  "ai-tools-for-uk-small-business-book": "AI Tools for UK Small Business: The Book",
  "ways-for-females-to-make-money-online": "Ways for Females to Make Money Online in the UK",
  "real-ways-to-make-money-from-home-for-free": "Real Ways to Make Money From Home for Free in the UK",
  "how-to-make-money-on-youtube-uk": "How to Make Money on YouTube in the UK in 2026",
  "how-to-make-money-from-home": "How to Make Money From Home in 2026",
  "how-to-make-passive-income-online": "How to Make Passive Income Online in the UK in 2026",
  "ai-and-finance": "AI and Finance: Practical Tools for Professionals",
  "how-to-earn-extra-money-at-home": "How to Earn Extra Money at Home in the UK in 2026",
  "make-money-online-statistics-2026": "Make Money Online Statistics 2026: The Numbers",
  "ai-in-business": "AI in Business: How Companies Are Using AI in 2026",
  "health-insurance-uk-guide": "Health Insurance in the UK: What Private Cover Pays For",
  "make-money-from-your-phone-guia-espana": "Make Money From Your Phone: ganar dinero en España",
  "make-money-from-your-phone-guide-france": "Gagner de l'argent avec son mobile en France",
  "short-term-disability-insurance-us-guide": "Short Term Disability Insurance: Protect Your Paycheck",
  "private-medical-insurance-us-guide": "Private Medical Insurance in the US: Costs and Choices",
  "health-insurance-us-guide": "Health Insurance in the US: Plans, Networks and Costs"
};

// Item 27: description rewrites — every value is 120-155 chars.
const DESCRIPTION_OVERRIDES = {
  "riemann-hypothesis-solved-claude-ai-stanford": "Two claims say the Riemann Hypothesis is solved — Levent Alpöge with Claude AI, and Stanford’s Alessandro Masullo. What is verified, and what is not.",
  "how-to-make-money-on-youtube-uk": "How to make money on YouTube in the UK in 2026: real RPM figures by niche, Partner Programme rules, the 2027 threshold change, UK tax and a starter plan.",
  "ways-for-females-to-make-money-online": "Ways for females to make money online in the UK in 2026: flexible work that fits school hours and childcare, real hourly rates and a 30-day plan.",
  "how-to-make-passive-income-online": "How to make passive income online in the UK in 2026: affiliate marketing, digital products, courses, YouTube and print on demand, with honest timelines.",
  "how-to-earn-extra-money-at-home": "How to earn extra money at home in the UK in 2026: 12 evening and weekend ways, realistic hourly rates, UK tax rules and a 30-day plan.",
  "ai-tools-for-uk-small-business-book": "AI Tools for UK Small Business by Abdul Daim: the practical, no-jargon guide for UK owners — real £ prices, MTD, UK GDPR and a 90-day plan.",
  "how-to-make-money-from-home": "How to make money from home in 2026: real remote jobs, freelance gigs and free platforms that pay, with honest earnings and scam warnings.",
  "ai-in-business": "AI in business in 2026: 88% of firms use AI, but only 6% see big EBIT gains. Real adoption stats, ROI evidence and a roadmap for US and UK companies.",
  "sapin-noel-artificiel-france": "Acheter un sapin de Noël artificiel en France ? Comparez Nordmann, pré-éclairé, givré et slim, avec des prix en euros et des conseils d’achat.",
  "ai-agents-explained-small-business-2026": "AI agents can now book, code, research and run workflows on their own. What AI agents are, how they work, and how small businesses can use them.",
  "how-to-get-first-customers-uk-small-business": "How to get your first customers as a UK small business: free local tactics, referrals, launch offers and follow-up that turn strangers into customers.",
  "digital-marketing-strategies-small-business-uk": "Practical digital marketing for UK small business owners: local SEO, Google Business Profile, social media, email and reviews — no big budget needed.",
  "how-to-fund-a-small-business": "How to fund a small business in 2026: SBA 7(a) and microloans, grants, bootstrapping and lines of credit, with honest advice on what each option costs.",
  "best-business-tools-small-business": "The best business tools for small business in 2026: accounting, CRM, email and design tools with real prices, free plans and a simple way to choose.",
  "ncsc-cyber-security-advice-small-business": "NCSC cyber security advice for small business in plain English: the Cyber Action Toolkit, strong passwords, 2SV, backups and spotting scam emails.",
  "best-ai-productivity-tools-uk": "The best AI productivity tools UK freelancers and small teams use in 2026, compared in pounds with free tiers, USD-billing notes and honest limits.",
  "best-ai-tools-uk-small-business-2026": "The best AI tools for UK small businesses in 2026: GBP pricing, VAT, UK GDPR and Making Tax Digital, compared by the job you need done."
};

// Item 29: tags for the 6 posts stored without any.
const TAG_OVERRIDES = {
  "make-money-online-statistics-2026": [
    "make money online",
    "online income statistics",
    "online income",
    "2026",
    "freelance income"
  ],
  "how-to-make-money-from-home": [
    "make money online",
    "work from home",
    "remote work",
    "freelance",
    "online income"
  ],
  "ai-in-business": [
    "artificial intelligence",
    "AI",
    "business",
    "AI adoption",
    "technology"
  ],
  "ai-and-finance": [
    "artificial intelligence",
    "AI",
    "finance",
    "fintech",
    "AI tools"
  ],
  "ai-in-finance": [
    "artificial intelligence",
    "AI",
    "finance",
    "banking",
    "wealth management"
  ],
  "llc-in-the-uk-equivalent": [
    "LLC",
    "limited company",
    "business structure",
    "UK business",
    "sole trader"
  ]
};

// Item 29: descriptive alt text for in-body images that had none.
// "match" is a distinctive substring of the image src (Pexels id).
const IMAGE_ALT_OVERRIDES = {
  "medicare-advantage-plans-us-guide": [
    {
      "match": "7477698",
      "alt": "Senior couple reviewing documents and managing finances together at home"
    },
    {
      "match": "8441775",
      "alt": "Senior couple reviewing documents with a consultant at an office desk with a laptop"
    }
  ],
  "make-money-from-your-phone-guia-espana": [
    {
      "match": "7252206",
      "alt": "Hombre con café y teléfono móvil en un tren, con auriculares y gorro"
    },
    {
      "match": "5902810",
      "alt": "Mujer adulta usando el teléfono móvil para comprar en línea, rodeada de plantas en un ambiente acogedor"
    }
  ]
};

// Item 24: the 3 paragraphs ways-for-females-to-make-money-online shared
// verbatim with how-to-earn-extra-money-at-home, rewritten in the females
// post's own voice. Exact stored HTML on the left (verified present on
// 23 Nov 2026); a missing string is logged, never fatal.
const FEMALES_PARAGRAPH_REPLACEMENTS = [
  [
    '<p>2. Days 8 to 14: do the first paid job or make the first sale. Price slightly below the market rate for the first two clients, then raise it. The goal is proof, not profit.</p>',
    '<p>2. Days 8 to 14: land the first paid job or make the first sale. Offer a lower rate to your first two clients while you build proof, then raise your prices. What matters now is evidence, not profit.</p>',
  ],
  [
    '<p>3. Days 15 to 21: ask the first client for a review and a referral. Add a second client or a second sales channel. Track your hours and your real hourly rate after fees.</p>',
    '<p>3. Days 15 to 21: ask that first client for a review and a referral. Bring in a second client or a second way to sell. Keep track of your hours and work out your real hourly rate once fees are taken off.</p>',
  ],
  [
    '<p><strong>Do I need to tell HMRC about extra money?</strong><br>If your total trading income is under £1,000 in a tax year, the trading allowance covers it. Above that you must register for Self Assessment, even if the work is only a side income.</p>',
    '<p><strong>Do I need to tell HMRC about extra money I earn?</strong><br>It depends on how much you earn. Trading income up to £1,000 in a tax year is covered by the trading allowance, so there is nothing to declare. Earn more than that and you need to register for Self Assessment, even when the income is a side hustle.</p>',
  ],
];

// Item 25: 3 related clean-URL links for each of the 71 posts whose
// stored content has no internal links. Link text is the target post
// title (the Phase 4 rewrite where the target has one), so the box
// always agrees with the page it points to.
const INTERNAL_LINKS_BY_SLUG = {
  "bedroom-decorating-ideas": [{ slug: "minimalist-home-interior-design", text: "Minimalist Home Interior Design: A Calm, Clutter-Free Home" }, { slug: "budget-friendly-home-decor-ideas", text: "Budget-Friendly Home Decor Ideas That Look Expensive" }, { slug: "modern-home-decor-ideas", text: "Modern Home Decor Ideas for a Stylish, Liveable Home" }],
  "best-accounting-software-small-business-uk": [{ slug: "how-to-fund-a-small-business", text: "How to Fund a Small Business: SBA Loans, Grants and Bootstrapping" }, { slug: "best-business-tools-small-business", text: "Best Business Tools for Small Business" }, { slug: "vat-registration-threshold-uk-small-business", text: "VAT Registration Threshold UK Small Business" }],
  "best-ai-tools-uk-small-business-2026": [{ slug: "best-ai-tools-small-business-2026", text: "Best AI Tools for Small Business in 2026: Top Picks" }, { slug: "microsoft-copilot-vs-chatgpt-uk-small-business", text: "Microsoft Copilot vs ChatGPT for Small Business UK" }, { slug: "free-ai-tools-uk-small-business", text: "Free AI Tools for UK Small Business" }],
  "best-business-tools-small-business": [{ slug: "best-crm-software-small-business", text: "Best CRM Software for Small Business" }, { slug: "best-accounting-software-small-business-uk", text: "Best Accounting Software for Small Business UK" }, { slug: "best-ai-tools-uk-small-business-2026", text: "Best AI Tools for UK Small Businesses in 2026: Top Picks" }],
  "best-crm-software-small-business": [{ slug: "best-business-tools-small-business", text: "Best Business Tools for Small Business" }, { slug: "digital-marketing-strategies-small-business", text: "Digital Marketing Strategies for Small Business" }, { slug: "how-to-get-first-customers-uk-small-business", text: "How to Get Your First Customers (UK Small Business)" }],
  "budget-friendly-home-decor-ideas": [{ slug: "bedroom-decorating-ideas", text: "Bedroom Decorating Ideas for a Calm, Cosy Retreat" }, { slug: "small-living-room-decorating-ideas", text: "Small Living Room Decorating Ideas That Make a Big Difference" }, { slug: "modern-home-decor-ideas", text: "Modern Home Decor Ideas for a Stylish, Liveable Home" }],
  "business-bank-account-compte-pro-france": [{ slug: "business-bank-account-cuenta-empresa-espana", text: "Business bank account: abrir una cuenta de empresa en España" }, { slug: "incorporation-guide-entrepreneurs-francais", text: "Incorporation : ce qu’un entrepreneur français doit comprendre" }, { slug: "business-line-of-credit-ligne-credit-france", text: "Business line of credit : la ligne de crédit pro en France" }],
  "business-bank-account-cuenta-empresa-espana": [{ slug: "business-bank-account-compte-pro-france", text: "Business bank account : ouvrir un compte pro en France" }, { slug: "incorporation-guia-emprendedores-espana", text: "Incorporation: lo que un emprendedor en España debe entender" }, { slug: "business-line-of-credit-poliza-credito-espana", text: "Business line of credit: la póliza de crédito en España" }],
  "business-bank-account-uk-guide": [{ slug: "business-bank-account-us-guide", text: "Business Bank Account: How to Choose One for Your LLC" }, { slug: "business-line-of-credit-uk-guide", text: "Business Line of Credit: How Revolving Credit Works in the UK" }, { slug: "incorporation-uk-register-a-company", text: "Incorporation in the UK: How to Register a Company Properly" }],
  "business-bank-account-us-guide": [{ slug: "business-bank-account-uk-guide", text: "Business Bank Account: How to Choose One in the UK" }, { slug: "business-line-of-credit-us-guide", text: "Business Line of Credit: How It Works and What It Costs" }, { slug: "incorporation-register-a-company-us", text: "Incorporation: How to Register a Company in the US, Step by Step" }],
  "business-for-sale-comprar-negocio-espana": [{ slug: "business-for-sale-reprendre-entreprise-france", text: "Business for sale : reprendre une entreprise en France sans surpayer" }, { slug: "franchise-guia-emprendedores-espana", text: "Franchise: qué implica de verdad abrir una en España" }, { slug: "business-bank-account-cuenta-empresa-espana", text: "Business bank account: abrir una cuenta de empresa en España" }],
  "business-for-sale-reprendre-entreprise-france": [{ slug: "business-for-sale-comprar-negocio-espana", text: "Business for sale: comprar un negocio en España sin pagar de más" }, { slug: "franchise-guide-entrepreneurs-france", text: "Franchise : ce qu'ouvrir une enseigne implique vraiment" }, { slug: "business-bank-account-compte-pro-france", text: "Business bank account : ouvrir un compte pro en France" }],
  "business-for-sale-uk-buying-guide": [{ slug: "business-for-sale-us-buying-guide", text: "Business for Sale: How to Buy One in the US Without Overpaying" }, { slug: "franchise-buying-guide-uk", text: "Franchise: What Buying One Really Involves in the UK" }, { slug: "how-to-fund-a-small-business", text: "How to Fund a Small Business: SBA Loans, Grants and Bootstrapping" }],
  "business-for-sale-us-buying-guide": [{ slug: "business-for-sale-uk-buying-guide", text: "Business for Sale: How to Buy One in the UK Without Overpaying" }, { slug: "franchise-buying-guide-us", text: "Franchise: How Buying One Works in the US, FDD and All" }, { slug: "how-to-fund-a-small-business", text: "How to Fund a Small Business: SBA Loans, Grants and Bootstrapping" }],
  "business-line-of-credit-ligne-credit-france": [{ slug: "business-line-of-credit-poliza-credito-espana", text: "Business line of credit: la póliza de crédito en España" }, { slug: "business-bank-account-compte-pro-france", text: "Business bank account : ouvrir un compte pro en France" }, { slug: "how-to-fund-a-small-business", text: "How to Fund a Small Business: SBA Loans, Grants and Bootstrapping" }],
  "business-line-of-credit-poliza-credito-espana": [{ slug: "business-line-of-credit-ligne-credit-france", text: "Business line of credit : la ligne de crédit pro en France" }, { slug: "business-bank-account-cuenta-empresa-espana", text: "Business bank account: abrir una cuenta de empresa en España" }, { slug: "how-to-fund-a-small-business", text: "How to Fund a Small Business: SBA Loans, Grants and Bootstrapping" }],
  "business-line-of-credit-uk-guide": [{ slug: "business-line-of-credit-us-guide", text: "Business Line of Credit: How It Works and What It Costs" }, { slug: "how-to-fund-a-small-business", text: "How to Fund a Small Business: SBA Loans, Grants and Bootstrapping" }, { slug: "business-bank-account-uk-guide", text: "Business Bank Account: How to Choose One in the UK" }],
  "business-line-of-credit-us-guide": [{ slug: "business-line-of-credit-uk-guide", text: "Business Line of Credit: How Revolving Credit Works in the UK" }, { slug: "how-to-fund-a-small-business", text: "How to Fund a Small Business: SBA Loans, Grants and Bootstrapping" }, { slug: "business-bank-account-us-guide", text: "Business Bank Account: How to Choose One for Your LLC" }],
  "digital-marketing-strategies-small-business": [{ slug: "digital-marketing-strategies-small-business-uk", text: "Digital Marketing Strategies for Small Business UK" }, { slug: "best-crm-software-small-business", text: "Best CRM Software for Small Business" }, { slug: "how-to-get-first-customers-uk-small-business", text: "How to Get Your First Customers (UK Small Business)" }],
  "digital-marketing-strategies-small-business-uk": [{ slug: "digital-marketing-strategies-small-business", text: "Digital Marketing Strategies for Small Business" }, { slug: "how-to-get-first-customers-uk-small-business", text: "How to Get Your First Customers (UK Small Business)" }, { slug: "best-crm-software-small-business", text: "Best CRM Software for Small Business" }],
  "franchise-buying-guide-uk": [{ slug: "franchise-buying-guide-us", text: "Franchise: How Buying One Works in the US, FDD and All" }, { slug: "business-for-sale-uk-buying-guide", text: "Business for Sale: How to Buy One in the UK Without Overpaying" }, { slug: "how-to-start-a-small-business-uk", text: "How to Start a Small Business in the UK" }],
  "franchise-buying-guide-us": [{ slug: "franchise-buying-guide-uk", text: "Franchise: What Buying One Really Involves in the UK" }, { slug: "business-for-sale-us-buying-guide", text: "Business for Sale: How to Buy One in the US Without Overpaying" }, { slug: "how-to-start-a-small-business-usa", text: "How to Start a Small Business in the USA" }],
  "franchise-guia-emprendedores-espana": [{ slug: "franchise-guide-entrepreneurs-france", text: "Franchise : ce qu'ouvrir une enseigne implique vraiment" }, { slug: "business-for-sale-comprar-negocio-espana", text: "Business for sale: comprar un negocio en España sin pagar de más" }, { slug: "franchise-buying-guide-uk", text: "Franchise: What Buying One Really Involves in the UK" }],
  "franchise-guide-entrepreneurs-france": [{ slug: "franchise-guia-emprendedores-espana", text: "Franchise: qué implica de verdad abrir una en España" }, { slug: "business-for-sale-reprendre-entreprise-france", text: "Business for sale : reprendre une entreprise en France sans surpayer" }, { slug: "franchise-buying-guide-uk", text: "Franchise: What Buying One Really Involves in the UK" }],
  "gta-6-platforms-guia-espana": [{ slug: "gta-6-release-date-guia-espana", text: "GTA 6 release date: el 19 de noviembre de 2026, confirmado" }, { slug: "gta-6-ps5-frame-rate-guia-espana", text: "GTA 6 PS5 frame rate: 30 FPS confirmados, sin modo rendimiento" }, { slug: "gta-6-platforms-uk-guide", text: "GTA 6 Platforms: PS5 and Xbox Series X|S, and Nothing Else Yet" }],
  "gta-6-platforms-uk-guide": [{ slug: "gta-6-release-date-uk-guide", text: "GTA 6 Release Date: 19 November 2026, Confirmed at Last" }, { slug: "gta-6-ps5-frame-rate-guide", text: "GTA 6 PS5 Frame Rate: 30 FPS Confirmed, No Performance Mode" }, { slug: "gta-6-platforms-us-guide", text: "GTA 6 Platforms: PS5 and Xbox Series X|S Are the Whole List" }],
  "gta-6-platforms-us-guide": [{ slug: "gta-6-release-date-us-guide", text: "GTA 6 Release Date: November 19, 2026 Is the Day" }, { slug: "gta-6-ps5-frame-rate-us-guide", text: "GTA 6 PS5 Frame Rate: 30 FPS Is the Target, No 60 FPS Mode" }, { slug: "gta-6-platforms-uk-guide", text: "GTA 6 Platforms: PS5 and Xbox Series X|S, and Nothing Else Yet" }],
  "gta-6-ps5-frame-rate-guia-espana": [{ slug: "gta-6-release-date-guia-espana", text: "GTA 6 release date: el 19 de noviembre de 2026, confirmado" }, { slug: "gta-6-platforms-guia-espana", text: "GTA 6 platforms: PS5 y Xbox Series X|S, y nada más por ahora" }, { slug: "gta-6-ps5-frame-rate-guide-france", text: "GTA 6 PS5 frame rate : 30 FPS confirmés, aucun mode performance" }],
  "gta-6-ps5-frame-rate-guide": [{ slug: "gta-6-release-date-uk-guide", text: "GTA 6 Release Date: 19 November 2026, Confirmed at Last" }, { slug: "gta-6-platforms-uk-guide", text: "GTA 6 Platforms: PS5 and Xbox Series X|S, and Nothing Else Yet" }, { slug: "gta-6-ps5-frame-rate-us-guide", text: "GTA 6 PS5 Frame Rate: 30 FPS Is the Target, No 60 FPS Mode" }],
  "gta-6-ps5-frame-rate-guide-france": [{ slug: "gta-6-release-date-guide-france", text: "GTA 6 release date : le 19 novembre 2026, enfin confirmé" }, { slug: "gta-6-platforms-guia-espana", text: "GTA 6 platforms: PS5 y Xbox Series X|S, y nada más por ahora" }, { slug: "gta-6-ps5-frame-rate-guia-espana", text: "GTA 6 PS5 frame rate: 30 FPS confirmados, sin modo rendimiento" }],
  "gta-6-ps5-frame-rate-us-guide": [{ slug: "gta-6-release-date-us-guide", text: "GTA 6 Release Date: November 19, 2026 Is the Day" }, { slug: "gta-6-platforms-us-guide", text: "GTA 6 Platforms: PS5 and Xbox Series X|S Are the Whole List" }, { slug: "gta-6-ps5-frame-rate-guide", text: "GTA 6 PS5 Frame Rate: 30 FPS Confirmed, No Performance Mode" }],
  "gta-6-release-date-guia-espana": [{ slug: "gta-6-platforms-guia-espana", text: "GTA 6 platforms: PS5 y Xbox Series X|S, y nada más por ahora" }, { slug: "gta-6-ps5-frame-rate-guia-espana", text: "GTA 6 PS5 frame rate: 30 FPS confirmados, sin modo rendimiento" }, { slug: "gta-6-release-date-guide-france", text: "GTA 6 release date : le 19 novembre 2026, enfin confirmé" }],
  "gta-6-release-date-guide-france": [{ slug: "gta-6-platforms-guia-espana", text: "GTA 6 platforms: PS5 y Xbox Series X|S, y nada más por ahora" }, { slug: "gta-6-ps5-frame-rate-guide-france", text: "GTA 6 PS5 frame rate : 30 FPS confirmés, aucun mode performance" }, { slug: "gta-6-release-date-guia-espana", text: "GTA 6 release date: el 19 de noviembre de 2026, confirmado" }],
  "gta-6-release-date-uk-guide": [{ slug: "gta-6-platforms-uk-guide", text: "GTA 6 Platforms: PS5 and Xbox Series X|S, and Nothing Else Yet" }, { slug: "gta-6-ps5-frame-rate-guide", text: "GTA 6 PS5 Frame Rate: 30 FPS Confirmed, No Performance Mode" }, { slug: "gta-6-release-date-us-guide", text: "GTA 6 Release Date: November 19, 2026 Is the Day" }],
  "gta-6-release-date-us-guide": [{ slug: "gta-6-platforms-us-guide", text: "GTA 6 Platforms: PS5 and Xbox Series X|S Are the Whole List" }, { slug: "gta-6-ps5-frame-rate-us-guide", text: "GTA 6 PS5 Frame Rate: 30 FPS Is the Target, No 60 FPS Mode" }, { slug: "gta-6-release-date-uk-guide", text: "GTA 6 Release Date: 19 November 2026, Confirmed at Last" }],
  "health-insurance-uk-guide": [{ slug: "health-insurance-us-guide", text: "Health Insurance in the US: Plans, Networks and Costs" }, { slug: "private-medical-insurance-us-guide", text: "Private Medical Insurance in the US: Costs and Choices" }, { slug: "medicare-supplement-plans-us-guide", text: "Medicare Supplement Plans: How Medigap Fills the Gaps" }],
  "health-insurance-us-guide": [{ slug: "health-insurance-uk-guide", text: "Health Insurance in the UK: What Private Cover Pays For" }, { slug: "private-medical-insurance-us-guide", text: "Private Medical Insurance in the US: Costs and Choices" }, { slug: "medicare-advantage-plans-us-guide", text: "Medicare Advantage Plans: How Part C Works and What It Costs" }],
  "how-to-fund-a-small-business": [{ slug: "business-line-of-credit-uk-guide", text: "Business Line of Credit: How Revolving Credit Works in the UK" }, { slug: "how-to-get-an-ein-small-business", text: "How to Get an EIN for a Small Business" }, { slug: "best-accounting-software-small-business-uk", text: "Best Accounting Software for Small Business UK" }],
  "how-to-get-an-ein-small-business": [{ slug: "llc-what-it-is-and-how-to-form-one", text: "LLC: What a Limited Liability Company Is and How It Works" }, { slug: "incorporation-register-a-company-us", text: "Incorporation: How to Register a Company in the US, Step by Step" }, { slug: "how-to-start-a-small-business-usa", text: "How to Start a Small Business in the USA" }],
  "how-to-get-first-customers-uk-small-business": [{ slug: "digital-marketing-strategies-small-business-uk", text: "Digital Marketing Strategies for Small Business UK" }, { slug: "how-to-start-a-small-business-uk", text: "How to Start a Small Business in the UK" }, { slug: "best-business-tools-small-business", text: "Best Business Tools for Small Business" }],
  "how-to-hire-first-employee-uk": [{ slug: "how-to-get-first-customers-uk-small-business", text: "How to Get Your First Customers (UK Small Business)" }, { slug: "how-to-start-a-small-business-uk", text: "How to Start a Small Business in the UK" }, { slug: "how-to-register-as-sole-trader-uk", text: "How to Register as a Sole Trader UK (HMRC)" }],
  "how-to-price-product-service-small-business": [{ slug: "best-business-tools-small-business", text: "Best Business Tools for Small Business" }, { slug: "how-to-get-first-customers-uk-small-business", text: "How to Get Your First Customers (UK Small Business)" }, { slug: "how-to-fund-a-small-business", text: "How to Fund a Small Business: SBA Loans, Grants and Bootstrapping" }],
  "how-to-register-as-sole-trader-uk": [{ slug: "sole-trader-vs-limited-company-uk", text: "Sole Trader vs Limited Company UK" }, { slug: "how-to-start-a-small-business-uk", text: "How to Start a Small Business in the UK" }, { slug: "vat-registration-threshold-uk-small-business", text: "VAT Registration Threshold UK Small Business" }],
  "how-to-start-a-small-business-uk": [{ slug: "how-to-start-a-small-business-usa", text: "How to Start a Small Business in the USA" }, { slug: "how-to-write-a-business-plan-small-business", text: "How to Write a Business Plan for a Small Business" }, { slug: "how-to-fund-a-small-business", text: "How to Fund a Small Business: SBA Loans, Grants and Bootstrapping" }],
  "how-to-start-a-small-business-usa": [{ slug: "how-to-start-a-small-business-uk", text: "How to Start a Small Business in the UK" }, { slug: "how-to-write-a-business-plan-small-business", text: "How to Write a Business Plan for a Small Business" }, { slug: "how-to-get-an-ein-small-business", text: "How to Get an EIN for a Small Business" }],
  "how-to-write-a-business-plan-small-business": [{ slug: "how-to-start-a-small-business-uk", text: "How to Start a Small Business in the UK" }, { slug: "how-to-fund-a-small-business", text: "How to Fund a Small Business: SBA Loans, Grants and Bootstrapping" }, { slug: "how-to-start-a-small-business-usa", text: "How to Start a Small Business in the USA" }],
  "incorporation-guia-emprendedores-espana": [{ slug: "incorporation-guide-entrepreneurs-francais", text: "Incorporation : ce qu’un entrepreneur français doit comprendre" }, { slug: "llc-guia-emprendedores-espana", text: "LLC: lo que un emprendedor en España debe saber antes de crearla" }, { slug: "business-bank-account-cuenta-empresa-espana", text: "Business bank account: abrir una cuenta de empresa en España" }],
  "incorporation-guide-entrepreneurs-francais": [{ slug: "incorporation-guia-emprendedores-espana", text: "Incorporation: lo que un emprendedor en España debe entender" }, { slug: "llc-guide-entrepreneurs-francais", text: "LLC : ce que les entrepreneurs français doivent vraiment savoir" }, { slug: "business-bank-account-compte-pro-france", text: "Business bank account : ouvrir un compte pro en France" }],
  "incorporation-register-a-company-us": [{ slug: "incorporation-uk-register-a-company", text: "Incorporation in the UK: How to Register a Company Properly" }, { slug: "llc-what-it-is-and-how-to-form-one", text: "LLC: What a Limited Liability Company Is and How It Works" }, { slug: "business-bank-account-us-guide", text: "Business Bank Account: How to Choose One for Your LLC" }],
  "incorporation-uk-register-a-company": [{ slug: "incorporation-register-a-company-us", text: "Incorporation: How to Register a Company in the US, Step by Step" }, { slug: "llc-in-the-uk-equivalent", text: "LLC in the UK: What It Means and What to Set Up Instead" }, { slug: "business-bank-account-uk-guide", text: "Business Bank Account: How to Choose One in the UK" }],
  "jensen-huang-affair-nvidia-investigation": [{ slug: "anthropic-ipo-2026-valuation-explained", text: "Anthropic IPO 2026: What the $1.4 Trillion Valuation Means for AI and Investors" }, { slug: "ai-in-business", text: "AI in Business: How Companies Are Using AI in 2026" }, { slug: "best-ai-tools-uk-small-business-2026", text: "Best AI Tools for UK Small Businesses in 2026: Top Picks" }],
  "llc-guia-emprendedores-espana": [{ slug: "llc-guide-entrepreneurs-francais", text: "LLC : ce que les entrepreneurs français doivent vraiment savoir" }, { slug: "llc-what-it-is-and-how-to-form-one", text: "LLC: What a Limited Liability Company Is and How It Works" }, { slug: "incorporation-guia-emprendedores-espana", text: "Incorporation: lo que un emprendedor en España debe entender" }],
  "llc-guide-entrepreneurs-francais": [{ slug: "llc-guia-emprendedores-espana", text: "LLC: lo que un emprendedor en España debe saber antes de crearla" }, { slug: "llc-what-it-is-and-how-to-form-one", text: "LLC: What a Limited Liability Company Is and How It Works" }, { slug: "incorporation-guide-entrepreneurs-francais", text: "Incorporation : ce qu’un entrepreneur français doit comprendre" }],
  "llc-vs-sole-proprietorship-usa": [{ slug: "llc-what-it-is-and-how-to-form-one", text: "LLC: What a Limited Liability Company Is and How It Works" }, { slug: "sole-trader-vs-limited-company-uk", text: "Sole Trader vs Limited Company UK" }, { slug: "incorporation-register-a-company-us", text: "Incorporation: How to Register a Company in the US, Step by Step" }],
  "llc-what-it-is-and-how-to-form-one": [{ slug: "llc-guide-entrepreneurs-francais", text: "LLC : ce que les entrepreneurs français doivent vraiment savoir" }, { slug: "llc-guia-emprendedores-espana", text: "LLC: lo que un emprendedor en España debe saber antes de crearla" }, { slug: "llc-vs-sole-proprietorship-usa", text: "LLC vs Sole Proprietorship USA" }],
  "make-money-from-your-phone-guia-espana": [{ slug: "make-money-from-your-phone-guide-france", text: "Gagner de l'argent avec son mobile en France" }, { slug: "make-money-from-your-phone-uk-guide", text: "Make Money From Your Phone: What a UK Phone Can Really Earn" }, { slug: "how-to-make-money-from-home", text: "How to Make Money From Home in 2026" }],
  "make-money-from-your-phone-guide-france": [{ slug: "make-money-from-your-phone-guia-espana", text: "Make Money From Your Phone: ganar dinero en España" }, { slug: "make-money-from-your-phone-uk-guide", text: "Make Money From Your Phone: What a UK Phone Can Really Earn" }, { slug: "how-to-make-money-from-home", text: "How to Make Money From Home in 2026" }],
  "make-money-from-your-phone-uk-guide": [{ slug: "make-money-from-your-phone-us-guide", text: "Make Money From Your Phone: Honest US Apps and Methods" }, { slug: "how-to-make-money-from-home", text: "How to Make Money From Home in 2026" }, { slug: "make-money-online-fast-uk-guide", text: "Make Money Online Fast: What Actually Pays in the UK" }],
  "make-money-from-your-phone-us-guide": [{ slug: "make-money-from-your-phone-uk-guide", text: "Make Money From Your Phone: What a UK Phone Can Really Earn" }, { slug: "how-to-make-money-from-home", text: "How to Make Money From Home in 2026" }, { slug: "real-ways-to-make-money-from-home-for-free", text: "Real Ways to Make Money From Home for Free in the UK" }],
  "make-money-online-fast-uk-guide": [{ slug: "how-to-make-money-from-home", text: "How to Make Money From Home in 2026" }, { slug: "how-to-earn-extra-money-at-home", text: "How to Earn Extra Money at Home in the UK in 2026" }, { slug: "make-money-from-your-phone-uk-guide", text: "Make Money From Your Phone: What a UK Phone Can Really Earn" }],
  "microsoft-copilot-vs-chatgpt-uk-small-business": [{ slug: "best-ai-tools-uk-small-business-2026", text: "Best AI Tools for UK Small Businesses in 2026: Top Picks" }, { slug: "chatgpt-vs-claude-uk-small-business", text: "ChatGPT vs Claude for UK Small Business" }, { slug: "free-ai-tools-uk-small-business", text: "Free AI Tools for UK Small Business" }],
  "minimalist-home-interior-design": [{ slug: "small-living-room-decorating-ideas", text: "Small Living Room Decorating Ideas That Make a Big Difference" }, { slug: "modern-home-decor-ideas", text: "Modern Home Decor Ideas for a Stylish, Liveable Home" }, { slug: "bedroom-decorating-ideas", text: "Bedroom Decorating Ideas for a Calm, Cosy Retreat" }],
  "modern-home-decor-ideas": [{ slug: "minimalist-home-interior-design", text: "Minimalist Home Interior Design: A Calm, Clutter-Free Home" }, { slug: "bedroom-decorating-ideas", text: "Bedroom Decorating Ideas for a Calm, Cosy Retreat" }, { slug: "small-living-room-decorating-ideas", text: "Small Living Room Decorating Ideas That Make a Big Difference" }],
  "private-medical-insurance-us-guide": [{ slug: "health-insurance-us-guide", text: "Health Insurance in the US: Plans, Networks and Costs" }, { slug: "short-term-disability-insurance-us-guide", text: "Short Term Disability Insurance: Protect Your Paycheck" }, { slug: "medicare-advantage-plans-us-guide", text: "Medicare Advantage Plans: How Part C Works and What It Costs" }],
  "short-term-disability-insurance-us-guide": [{ slug: "health-insurance-us-guide", text: "Health Insurance in the US: Plans, Networks and Costs" }, { slug: "private-medical-insurance-us-guide", text: "Private Medical Insurance in the US: Costs and Choices" }, { slug: "medicare-advantage-plans-us-guide", text: "Medicare Advantage Plans: How Part C Works and What It Costs" }],
  "small-business-ideas-2026-usa": [{ slug: "small-business-ideas-uk-2026", text: "Small Business Ideas UK 2026" }, { slug: "how-to-start-a-small-business-usa", text: "How to Start a Small Business in the USA" }, { slug: "how-to-fund-a-small-business", text: "How to Fund a Small Business: SBA Loans, Grants and Bootstrapping" }],
  "small-business-ideas-uk-2026": [{ slug: "small-business-ideas-uk-under-1000", text: "Small Business Ideas UK with £1,000 or Less" }, { slug: "small-business-ideas-2026-usa", text: "Small Business Ideas 2026 USA" }, { slug: "how-to-start-a-small-business-uk", text: "How to Start a Small Business in the UK" }],
  "small-business-ideas-uk-under-1000": [{ slug: "small-business-ideas-uk-2026", text: "Small Business Ideas UK 2026" }, { slug: "how-to-start-a-small-business-uk", text: "How to Start a Small Business in the UK" }, { slug: "how-to-fund-a-small-business", text: "How to Fund a Small Business: SBA Loans, Grants and Bootstrapping" }],
  "small-living-room-decorating-ideas": [{ slug: "minimalist-home-interior-design", text: "Minimalist Home Interior Design: A Calm, Clutter-Free Home" }, { slug: "modern-home-decor-ideas", text: "Modern Home Decor Ideas for a Stylish, Liveable Home" }, { slug: "budget-friendly-home-decor-ideas", text: "Budget-Friendly Home Decor Ideas That Look Expensive" }],
  "sole-trader-vs-limited-company-uk": [{ slug: "llc-vs-sole-proprietorship-usa", text: "LLC vs Sole Proprietorship USA" }, { slug: "how-to-register-as-sole-trader-uk", text: "How to Register as a Sole Trader UK (HMRC)" }, { slug: "incorporation-uk-register-a-company", text: "Incorporation in the UK: How to Register a Company Properly" }],
  "vat-registration-threshold-uk-small-business": [{ slug: "how-to-register-as-sole-trader-uk", text: "How to Register as a Sole Trader UK (HMRC)" }, { slug: "sole-trader-vs-limited-company-uk", text: "Sole Trader vs Limited Company UK" }, { slug: "best-accounting-software-small-business-uk", text: "Best Accounting Software for Small Business UK" }],
};

// Item 28: translation groups. Each group maps hreflang -> slug.
// "xDefault" is the page shown when no language matches (the UK English
// version where one exists, else the generic English version, else French).
// Groups were verified as true translations: same heading count and
// parallel headings across languages (see phase4_duplicate_families.md).
// The UK LLC-equivalent post is NOT in the LLC group: it is a different,
// UK-specific article, not a translation of the US LLC post.
const TRANSLATION_GROUPS = [
  { langs: { en: 'llc-what-it-is-and-how-to-form-one', fr: 'llc-guide-entrepreneurs-francais', es: 'llc-guia-emprendedores-espana' }, xDefault: 'llc-what-it-is-and-how-to-form-one' },
  { langs: { 'en-GB': 'incorporation-uk-register-a-company', 'en-US': 'incorporation-register-a-company-us', fr: 'incorporation-guide-entrepreneurs-francais', es: 'incorporation-guia-emprendedores-espana' }, xDefault: 'incorporation-uk-register-a-company' },
  { langs: { 'en-GB': 'business-bank-account-uk-guide', 'en-US': 'business-bank-account-us-guide', fr: 'business-bank-account-compte-pro-france', es: 'business-bank-account-cuenta-empresa-espana' }, xDefault: 'business-bank-account-uk-guide' },
  { langs: { 'en-GB': 'business-line-of-credit-uk-guide', 'en-US': 'business-line-of-credit-us-guide', fr: 'business-line-of-credit-ligne-credit-france', es: 'business-line-of-credit-poliza-credito-espana' }, xDefault: 'business-line-of-credit-uk-guide' },
  { langs: { 'en-GB': 'business-for-sale-uk-buying-guide', 'en-US': 'business-for-sale-us-buying-guide', fr: 'business-for-sale-reprendre-entreprise-france', es: 'business-for-sale-comprar-negocio-espana' }, xDefault: 'business-for-sale-uk-buying-guide' },
  { langs: { 'en-GB': 'franchise-buying-guide-uk', 'en-US': 'franchise-buying-guide-us', fr: 'franchise-guide-entrepreneurs-france', es: 'franchise-guia-emprendedores-espana' }, xDefault: 'franchise-buying-guide-uk' },
  { langs: { 'en-GB': 'gta-6-release-date-uk-guide', 'en-US': 'gta-6-release-date-us-guide', fr: 'gta-6-release-date-guide-france', es: 'gta-6-release-date-guia-espana' }, xDefault: 'gta-6-release-date-uk-guide' },
  { langs: { 'en-GB': 'gta-6-platforms-uk-guide', 'en-US': 'gta-6-platforms-us-guide', es: 'gta-6-platforms-guia-espana' }, xDefault: 'gta-6-platforms-uk-guide' },
  { langs: { en: 'gta-6-ps5-frame-rate-guide', 'en-US': 'gta-6-ps5-frame-rate-us-guide', fr: 'gta-6-ps5-frame-rate-guide-france', es: 'gta-6-ps5-frame-rate-guia-espana' }, xDefault: 'gta-6-ps5-frame-rate-guide' },
  { langs: { 'en-GB': 'make-money-from-your-phone-uk-guide', 'en-US': 'make-money-from-your-phone-us-guide', fr: 'make-money-from-your-phone-guide-france', es: 'make-money-from-your-phone-guia-espana' }, xDefault: 'make-money-from-your-phone-uk-guide' },
  { langs: { 'en-GB': 'christmas-decor-uk', fr: 'decoration-de-noel' }, xDefault: 'christmas-decor-uk' },
  { langs: { fr: 'sapin-noel-artificiel-france', es: 'arbol-navidad-artificial-espana' }, xDefault: 'sapin-noel-artificiel-france' },
  { langs: { fr: 'sapin-noel-pre-eclaire-france', es: 'arbol-navidad-preiluminado-espana' }, xDefault: 'sapin-noel-pre-eclaire-france' },
  { langs: { fr: 'decorations-noel-france', es: 'adornos-navidad-espana' }, xDefault: 'decorations-noel-france' },
];

const TRANSLATION_GROUP_BY_SLUG = {};
for (const group of TRANSLATION_GROUPS) {
  for (const slug of Object.values(group.langs)) {
    TRANSLATION_GROUP_BY_SLUG[slug] = group;
  }
}

// Item 27 + 29: title/description/tag overrides, applied to the loaded
// posts in buildPages() so homepage, category pages and article page agree.
// Stored content is never changed.
function applyPhase4Overrides(posts) {
  for (const post of posts) {
    const slug = String(post.slug || '');
    if (TITLE_OVERRIDES[slug]) {
      post.title = TITLE_OVERRIDES[slug];
      post.meta_title = TITLE_OVERRIDES[slug];
    }
    if (DESCRIPTION_OVERRIDES[slug]) {
      post.meta_description = DESCRIPTION_OVERRIDES[slug];
    }
    if (TAG_OVERRIDES[slug]) {
      post.tags = TAG_OVERRIDES[slug];
    }
  }
  return posts;
}

// Item 29: set descriptive alt text on the in-body images that had none
// (missing alt, or empty alt=""). Matches on a distinctive src substring.
function applyImageAltOverrides(post, html) {
  const overrides = IMAGE_ALT_OVERRIDES[String(post.slug || '')];
  if (!overrides || !overrides.length) return html;
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = tag.match(/\bsrc\s*=\s*"([^"]*)"/i);
    if (!src) return tag;
    const hit = overrides.find((o) => src[1].includes(o.match));
    if (!hit) return tag;
    if (/\balt\s*=\s*"[^"]*"/i.test(tag)) {
      return tag.replace(/\balt\s*=\s*"[^"]*"/i, `alt="${escapeAttr(hit.alt)}"`);
    }
    return tag.replace(/<img\b/i, `<img alt="${escapeAttr(hit.alt)}"`);
  });
}

// Item 24: rewrite the shared paragraphs in the females post only.
function applyPhase4Replacements(post, body) {
  if (String(post.slug || '') !== 'ways-for-females-to-make-money-online') return body;
  return applyReplacements(body, FEMALES_PARAGRAPH_REPLACEMENTS, 'females-paragraphs');
}

// Item 25: the "Related guides" box. Heading in the post's own language.
function relatedLinksBox(post) {
  const links = INTERNAL_LINKS_BY_SLUG[String(post.slug || '')];
  if (!links || !links.length) return '';
  const lang = detectLanguage(post);
  const heading = lang === 'fr' ? 'Guides connexes' : lang === 'es' ? 'Guías relacionadas' : 'Related guides';
  const items = links
    .map((link) => `      <li><a href="/${escapeAttr(link.slug)}/">${escapeHtml(link.text)}</a></li>`)
    .join('\n');
  return `\n\n<aside class="article-related" aria-label="${escapeAttr(heading)}">\n  <h3>${escapeHtml(heading)}</h3>\n  <ul>\n${items}\n  </ul>\n</aside>`;
}

// Item 28: reciprocal hreflang + x-default links for a post that belongs
// to a translation group; empty string otherwise.
function hreflangLinksFor(post) {
  const group = TRANSLATION_GROUP_BY_SLUG[String(post.slug || '')];
  if (!group) return '';
  const links = Object.entries(group.langs).map(
    ([lang, slug]) => `<link rel="alternate" hreflang="${lang}" href="${SITE_ORIGIN}/${slug}/" />`
  );
  links.push(`<link rel="alternate" hreflang="x-default" href="${SITE_ORIGIN}/${group.xDefault}/" />`);
  return links.join('\n    ');
}

// ---------------------------------------------------------------------------
// Card builders (mirror script.js buildStoryCard / buildMiniFeature /
// buildTechArticleCard / buildPopularCard, including their markup and
// classes, so the static HTML matches what hydration renders). Dates are
// rendered as absolute dates with a data-ts so the client swaps in the
// relative time on load.
// ---------------------------------------------------------------------------

function getArticleHref(post) {
  return `/${String(post.slug || post.id)}/`;
}

function cardThumbUrl(url) {
  if (typeof url !== 'string' || !url.includes('images.pexels.com')) return url;
  return url.replace(/^([^?]+)\?.*$/, '$1?auto=compress&cs=tinysrgb&w=800');
}

function pillClass(category) {
  return category === 'Business'
    ? 'business-pill'
    : category === 'Home Decor'
      ? 'decor-pill'
      : category === 'Make Money Online'
        ? 'money-pill'
        : category === 'Health & Fitness'
          ? 'health-pill'
          : '';
}

function relTimeSpan(post) {
  const ts = post.published_at || post.created_at || post.date || '';
  return `<span class="rel-time" data-ts="${escapeAttr(ts)}">${escapeHtml(formatDisplayDate(ts))}</span>`;
}

function buildStoryCard(post) {
  return `
    <article class="story-card" data-post-id="${post.id}" data-post-url="${getArticleHref(post)}" role="link" tabindex="0">
      <div class="story-image lazy-bg" data-bg="${escapeAttr(cardThumbUrl(post.thumb))}"></div>
      <div class="story-body">
        <span class="pill ${pillClass(post.category)}">${escapeHtml(post.category)}</span>
        <h3><a href="${getArticleHref(post)}">${escapeHtml(post.title)}</a></h3>
        <div class="meta-row compact">
          ${relTimeSpan(post)}
          <span class="meta-divider">•</span>
          <span>${escapeHtml(post.readTime || '5 min read')}</span>
        </div>
      </div>
    </article>
  `;
}

function buildMiniFeature(post) {
  return `
    <article class="mini-feature" data-post-id="${post.id}" data-post-url="${getArticleHref(post)}" role="link" tabindex="0">
      <div class="mini-image lazy-bg" data-bg="${escapeAttr(cardThumbUrl(post.thumb))}"></div>
      <div class="mini-copy">
        <span class="pill ${pillClass(post.category)}">${escapeHtml(post.category)}</span>
        <h3><a href="${getArticleHref(post)}">${escapeHtml(post.title)}</a></h3>
        <div class="meta-row compact">
          ${relTimeSpan(post)}
          <span class="meta-divider">•</span>
          <span>${escapeHtml(post.readTime || '5 min read')}</span>
        </div>
      </div>
    </article>
  `;
}

function buildTechArticleCard(post) {
  return `
  <a class="tech-article" href="${getArticleHref(post)}" data-post-id="${post.id}" data-post-url="${getArticleHref(post)}">
    <div class="article-thumb lazy-bg" data-bg="${escapeAttr(cardThumbUrl(post.thumb))}"></div>
    <div class="article-copy">
      <span class="article-label">${escapeHtml(post.category)}</span>
      <h3>${escapeHtml(post.title)}</h3>
      <p>${escapeHtml(post.summary || post.excerpt || '')}</p>
      <div class="article-meta">
        <span class="calendar" aria-hidden="true"></span>
        ${relTimeSpan(post)}
        <span class="meta-dot" aria-hidden="true"></span>
        <span>${escapeHtml(post.readTime || '5 min read')}</span>
      </div>
    </div>
  </a>
`;
}

function buildPopularCard(post) {
  return `
  <li>
    <a href="${getArticleHref(post)}">
      <span class="mini-thumb lazy-bg" data-bg="${escapeAttr(cardThumbUrl(post.thumb))}"></span>
      <span class="popular-copy">
        <strong>${escapeHtml(post.title)}</strong>
        <small class="rel-time" data-ts="${escapeAttr(post.published_at || post.created_at || post.date || '')}">${escapeHtml(formatDisplayDate(post.published_at || post.created_at || post.date || ''))}</small>
      </span>
    </a>
  </li>
`;
}

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------

// Replace a fragment, throwing loudly when the template no longer contains
// it (a silent no-op would ship a page with "Loading…" still in it).
// Replacements go through a function so a "$" in a title or description is
// never reinterpreted as a $-substitution by String.replace.
function mustReplace(html, oldText, newText, label) {
  if (!html.includes(oldText)) {
    throw new Error(`Template fragment not found (${label}): ${JSON.stringify(oldText.slice(0, 80))}`);
  }
  return html.replace(oldText, () => newText);
}

function mustReplacePattern(html, pattern, replacement, label) {
  if (!pattern.test(html)) {
    throw new Error(`Template pattern not found (${label}): ${pattern}`);
  }
  return html.replace(pattern, () => replacement);
}

// Fill the sidebar category counts. The homepage uses <span class="count">,
// the category/article pages use <span class="category-count">. Both lists
// are in CATEGORY_ORDER.
function fillCategoryCounts(html, counts) {
  let index = 0;
  const fill = () => {
    const category = CATEGORY_ORDER[index];
    index += 1;
    return String(counts[category] || 0);
  };
  html = html.replace(/<span class="count"><\/span>/g, () => fill());
  index = 0;
  html = html.replace(/<span class="category-count"><\/span>/g, () => fill());
  return html;
}

function categoryCounts(posts) {
  const counts = {};
  for (const category of CATEGORY_ORDER) counts[category] = 0;
  for (const post of posts) {
    if (counts[post.category] !== undefined) counts[post.category] += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Page generators
// ---------------------------------------------------------------------------

function generateArticlePage(template, post, posts, counts) {
  const lang = detectLanguage(post);
  const title = articleTitle(post);
  const description = articleDescription(post);
  const cleanUrl = `${SITE_ORIGIN}/${post.slug}/`;
  const image = post.image || post.thumb || '';
  const dateVal = post.published_at || post.created_at || post.date || '';
  // Phase 3 (23 Nov 2026), item 15: the three major posts were updated at
  // build time (Huang resignation update, Anthropic final IPO terms, Riemann
  // status note), so their dateModified is the build date. The stored
  // publish dates are never changed.
  const dateModified = PHASE3_DATE_MODIFIED_SLUGS.has(String(post.slug))
    ? `${PHASE3_DATE}T00:00:00.000Z`
    : (post.updated_at || post.published_at || post.created_at || post.date || '');
  const author = post.author || 'Admin';
  const category = post.category || 'BlogSphere';
  const categoryPage = CATEGORY_PAGES[category] || '/';
  const tags = Array.isArray(post.tags) ? post.tags : [];
  const sameCategory = posts.filter((p) => p.category === category);
  const indexInCategory = sameCategory.findIndex((p) => String(p.id) === String(post.id));
  const previous = indexInCategory >= 0 ? sameCategory[indexInCategory + 1] : null;
  const related = sameCategory.filter((p) => p.id !== post.id).slice(0, 4);
  const popular = sameCategory.filter((p) => p.id !== post.id).slice(0, 5);

  const encodedUrl = encodeURIComponent(cleanUrl);
  const encodedTitle = encodeURIComponent(post.title);
  const encodedImage = encodeURIComponent(image);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    image: image || undefined,
    datePublished: dateVal || undefined,
    dateModified: dateModified || undefined,
    author: { '@type': 'Person', name: author },
    publisher: {
      '@type': 'Organization',
      name: 'BlogSphere',
      url: `${SITE_ORIGIN}/`,
      logo: { '@type': 'ImageObject', url: `${SITE_ORIGIN}/Logo.webp` }
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': cleanUrl }
  };

  let html = template;
  html = mustReplace(html, '<html lang="en">', `<html lang="${lang}">`, 'article html lang');
  html = mustReplace(
    html,
    '<meta name="description" content="BlogSphere article" />',
    `<meta name="description" content="${escapeAttr(description)}" />`,
    'article meta description'
  );
  html = mustReplace(
    html,
    '<meta property="og:title" content="Article | BlogSphere" />',
    `<meta property="og:title" content="${escapeAttr(title)}" />`,
    'article og:title'
  );
  html = mustReplace(
    html,
    '<meta property="og:description" content="BlogSphere article" />',
    `<meta property="og:description" content="${escapeAttr(description)}" />`,
    'article og:description'
  );
  html = mustReplace(
    html,
    '<meta property="og:url" content="https://blogsphere.info/" />',
    `<meta property="og:url" content="${cleanUrl}" />`,
    'article og:url'
  );
  html = mustReplace(
    html,
    '<meta property="og:image" content="https://blogsphere.info/Logo.webp" />',
    `<meta property="og:image" content="${escapeAttr(image)}" />`,
    'article og:image'
  );
  html = mustReplace(
    html,
    '<meta name="twitter:title" content="Article | BlogSphere" />',
    `<meta name="twitter:title" content="${escapeAttr(title)}" />`,
    'article twitter:title'
  );
  html = mustReplace(
    html,
    '<meta name="twitter:description" content="BlogSphere article" />',
    `<meta name="twitter:description" content="${escapeAttr(description)}" />`,
    'article twitter:description'
  );
  html = mustReplace(
    html,
    '<meta name="twitter:image" content="https://blogsphere.info/Logo.webp" />',
    `<meta name="twitter:image" content="${escapeAttr(image)}" />`,
    'article twitter:image'
  );
  html = mustReplace(
    html,
    '<link rel="canonical" href="https://blogsphere.info/" />',
    `<link rel="canonical" href="${cleanUrl}" />`,
    'article canonical'
  );
  // Phase 4 (23 Nov 2026), item 28: reciprocal hreflang + x-default,
  // only where a true translation exists.
  const hreflang = hreflangLinksFor(post);
  if (hreflang) {
    html = mustReplace(
      html,
      `<link rel="canonical" href="${cleanUrl}" />`,
      `<link rel="canonical" href="${cleanUrl}" />
    ${hreflang}`,
      'article hreflang'
    );
  }
  html = mustReplace(html, '<title>Article | BlogSphere</title>', `<title>${escapeHtml(title)}</title>`, 'article title');
  html = mustReplace(
    html,
    '  </head>',
    `    <script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 2)}\n    </script>\n  </head>`,
    'article JSON-LD'
  );

  html = mustReplacePattern(
    html,
    /<img class="article-feature-image"[^>]*\/>/,
    `<img class="article-feature-image" id="article-feature-image" src="${escapeAttr(image)}" alt="${escapeAttr(post.title)}" fetchpriority="high" width="1200" height="800" />`,
    'article feature image'
  );
  html = mustReplacePattern(
    html,
    /<span id="article-category" class="article-tag">[^<]*<\/span>/,
    `<span id="article-category" class="article-tag">${escapeHtml(category)}</span>`,
    'article category tag'
  );
  html = mustReplacePattern(
    html,
    /<h1 id="article-title">[^<]*<\/h1>/,
    `<h1 id="article-title">${escapeHtml(post.title)}</h1>`,
    'article H1'
  );
  html = mustReplacePattern(
    html,
    /<p id="article-summary" class="article-summary">[\s\S]*?<\/p>/,
    `<p id="article-summary" class="article-summary">${escapeHtml(post.summary || post.excerpt || '')}</p>`,
    'article summary'
  );
  html = mustReplacePattern(
    html,
    /<span id="article-date" class="meta-item date-item"><\/span>/,
    `<span id="article-date" class="meta-item date-item rel-time" data-ts="${escapeAttr(dateVal)}">${escapeHtml(formatDisplayDate(dateVal))}</span>`,
    'article date'
  );
  html = mustReplacePattern(
    html,
    /<span id="article-readtime" class="meta-item">[^<]*<\/span>/,
    `<span id="article-readtime" class="meta-item">${escapeHtml(post.readTime || '5 min read')}</span>`,
    'article read time'
  );
  html = mustReplacePattern(
    html,
    /<span class="meta-item">By [^<]*<\/span>/,
    `<span class="meta-item">By ${escapeHtml(author)}</span>`,
    'article byline'
  );

  // Share links (same URLs script.js binds on hydration).
  html = mustReplace(
    html,
    '<a id="share-facebook" href="https://www.facebook.com" aria-label="Share on Facebook">f</a>',
    `<a id="share-facebook" href="https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}" target="_blank" rel="noopener" aria-label="Share on Facebook">f</a>`,
    'share facebook'
  );
  html = mustReplace(
    html,
    '<a id="share-x" href="https://x.com" aria-label="Share on X">x</a>',
    `<a id="share-x" href="https://twitter.com/intent/tweet?url=${encodedUrl}&amp;text=${encodedTitle}" target="_blank" rel="noopener" aria-label="Share on X">x</a>`,
    'share x'
  );
  html = mustReplace(
    html,
    '<a id="share-linkedin" href="https://www.linkedin.com" aria-label="Share on LinkedIn">in</a>',
    `<a id="share-linkedin" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}" target="_blank" rel="noopener" aria-label="Share on LinkedIn">in</a>`,
    'share linkedin'
  );
  html = mustReplace(
    html,
    '<a id="share-pinterest" href="https://www.pinterest.com" aria-label="Share on Pinterest">P</a>',
    `<a id="share-pinterest" href="https://pinterest.com/pin/create/button/?url=${encodedUrl}&amp;media=${encodedImage}&amp;description=${encodedTitle}" target="_blank" rel="noopener" aria-label="Share on Pinterest">P</a>`,
    'share pinterest'
  );

  html = mustReplace(
    html,
    '<div id="article-content" class="article-content"></div>',
    `<div id="article-content" class="article-content">${buildArticleContent(post)}</div>`,
    'article content'
  );

  html = mustReplacePattern(
    html,
    /<div class="article-breadcrumbs">[\s\S]*?<\/div>/,
    `<div class="article-breadcrumbs">
        <a href="/">Home</a>
        <span>›</span>
        <a href="${categoryPage}">${escapeHtml(category)}</a>
        <span>›</span>
        <span>${escapeHtml(post.title)}</span>
      </div>`,
    'article breadcrumbs'
  );

  const relatedHtml = related
    .map(
      (item) => `
      <li>
        <span class="related-thumb lazy-bg" data-bg="${escapeAttr(cardThumbUrl(item.thumb))}"></span>
        <a href="${getArticleHref(item)}">${escapeHtml(item.title)}</a>
        <span class="related-arrow">›</span>
      </li>
    `
    )
    .join('');
  html = mustReplace(html, '<ul class="related-list"></ul>', `<ul class="related-list">${relatedHtml}</ul>`, 'related list');

  const tagsHtml =
    '<span>Tags:</span> ' +
    tags.map((tag) => `<a href="/?q=${encodeURIComponent(tag)}">${escapeHtml(tag)}</a>`).join(' ');
  html = mustReplace(html, '<div class="article-tags"></div>', `<div class="article-tags">${tagsHtml}</div>`, 'article tags');

  html = mustReplacePattern(
    html,
    /<h4>By [^<]*<\/h4>/,
    `<h4>By ${escapeHtml(author)}</h4>`,
    'author box name'
  );

  const prevHtml = previous
    ? `<a href="${getArticleHref(previous)}" class="prev-post">← ${escapeHtml(previous.title)}</a>`
    : `<a href="${categoryPage}" class="prev-post">← All ${escapeHtml(category)} Articles</a>`;
  html = mustReplacePattern(
    html,
    /<a href="[^"]*" class="prev-post">[^<]*<\/a>/,
    prevHtml,
    'previous post link'
  );

  const popularHtml = popular.length ? popular.map(buildPopularCard).join('') : '';
  html = mustReplace(html, '<ul class="popular-list"></ul>', `<ul class="popular-list">${popularHtml}</ul>`, 'article popular list');

  if (tags.length) {
    const sidebarTags = tags
      .map((tag) => `<a class="tag" href="/?q=${encodeURIComponent(tag)}">${escapeHtml(tag)}</a>`)
      .join('');
    html = mustReplacePattern(
      html,
      /<div class="tag-list">[\s\S]*?<\/div>/,
      `<div class="tag-list">${sidebarTags}</div>`,
      'article sidebar tags'
    );
  }

  return fillCategoryCounts(html, counts);
}

function generateHomePage(template, posts, counts) {
  const featured = posts.slice(0, 4);
  const hero = featured[0];
  let html = template;

  html = mustReplace(
    html,
    '<strong id="hero-stat-articles">45</strong>',
    `<strong id="hero-stat-articles">${posts.length}</strong>`,
    'hero article count'
  );

  if (hero) {
    html = mustReplace(
      html,
      '<article class="feature-card feature-large skeleton">',
      `<article class="feature-card feature-large" data-post-id="${hero.id}" data-post-url="${getArticleHref(hero)}" aria-label="${escapeAttr(hero.title)}">`,
      'hero feature card'
    );
    html = mustReplace(
      html,
      '<img class="feature-card-image" alt="" fetchpriority="high" width="1200" height="750" />',
      `<img class="feature-card-image" src="${escapeAttr(hero.image || hero.thumb || '')}" alt="${escapeAttr(hero.title)}" fetchpriority="high" width="1200" height="750" />`,
      'hero feature image'
    );
    html = mustReplacePattern(
      html,
      /<div class="feature-content">[\s\S]*?<h2><\/h2>/,
      `<div class="feature-content">
              <span class="pill small-pill">${escapeHtml(hero.category)}</span>
              <h2><a href="${getArticleHref(hero)}">${escapeHtml(hero.title)}</a></h2>`,
      'hero title'
    );
    html = mustReplacePattern(
      html,
      /(<h2><a href="[^"]+">[^<]+<\/a><\/h2>\s*)<p><\/p>/,
      `$1<p>${escapeHtml(hero.summary || hero.excerpt || '')}</p>`,
      'hero summary'
    );
    html = mustReplacePattern(
      html,
      /<div class="meta-row">\s*<span class="meta-icon" aria-hidden="true">◔<\/span>\s*<span><\/span>\s*<span class="meta-divider">•<\/span>\s*<span><\/span>\s*<\/div>/,
      `<div class="meta-row">
                <span class="meta-icon" aria-hidden="true">◔</span>
                ${relTimeSpan(hero)}
                <span class="meta-divider">•</span>
                <span>${escapeHtml(hero.readTime || '5 min read')}</span>
              </div>`,
      'hero meta'
    );
    const miniHtml = featured.slice(1).map(buildMiniFeature).join('');
    html = mustReplacePattern(
      html,
      /<aside class="stacked-feature-list"[^>]*>[\s\S]*?<\/aside>/,
      `<aside class="stacked-feature-list" aria-label="Trending articles">${miniHtml}</aside>`,
      'hero mini features'
    );
  }

  const latestHtml = posts.slice(0, 6).map(buildStoryCard).join('');
  html = mustReplace(html, '<div class="latest-grid"></div>', `<div class="latest-grid">${latestHtml}</div>`, 'latest grid');

  // The five .article-row sections are in CATEGORY_ORDER; each takes the
  // newest 3 posts of that category.
  let rowIndex = 0;
  html = html.replace(/<div class="article-row"><\/div>/g, () => {
    const category = CATEGORY_ORDER[rowIndex];
    rowIndex += 1;
    const rows = posts.filter((p) => p.category === category).slice(0, 3);
    return `<div class="article-row">${rows.map(buildStoryCard).join('')}</div>`;
  });
  if (rowIndex !== CATEGORY_ORDER.length) {
    throw new Error(`Expected ${CATEGORY_ORDER.length} .article-row sections, found ${rowIndex}`);
  }

  const popularHtml = posts.slice(0, 5).map(buildPopularCard).join('');
  html = mustReplace(html, '<ul class="popular-list"></ul>', `<ul class="popular-list">${popularHtml}</ul>`, 'home popular list');

  return fillCategoryCounts(html, counts);
}

function generateCategoryPage(template, category, posts, counts) {
  const catPosts = posts.filter((p) => p.category === category);
  let html = template;
  const listHtml = catPosts.map(buildTechArticleCard).join('');
  // The .article-list is a single line of three skeleton divs; match the
  // whole line (greedy .* stays on that line) and swap in the real cards.
  html = mustReplacePattern(
    html,
    /<div class="article-list">.*<\/div>/,
    `<div class="article-list">${listHtml}</div>`,
    'category article list'
  );
  const popularHtml = catPosts.slice(0, 5).map(buildPopularCard).join('');
  html = mustReplace(html, '<ul class="popular-list"></ul>', `<ul class="popular-list">${popularHtml}</ul>`, 'category popular list');
  return fillCategoryCounts(html, counts);
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function buildPages() {
  if (path.dirname(output) !== root || path.basename(output) !== 'dist') {
    throw new Error('Refusing to build outside the repository dist directory.');
  }

  const posts = await loadPosts();
  if (posts.length === 0) throw new Error('No published posts loaded; refusing to build an empty site.');
  // Phase 3 (23 Nov 2026), item 15: Anthropic title/meta overrides (final
  // IPO terms) so homepage, category pages and article page all agree.
  applyPhase3TitleOverrides(posts);
  // Phase 4 (23 Nov 2026), items 27 + 29: title/description/tag overrides
  // so homepage, category pages and article page all agree.
  applyPhase4Overrides(posts);
  const counts = categoryCounts(posts);
  const langCounts = { fr: 0, es: 0, en: 0 };
  for (const post of posts) langCounts[detectLanguage(post)] += 1;

  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });

  for (const file of publicFiles) {
    const source = path.join(root, file);
    if (!fs.statSync(source).isFile()) throw new Error(`Public asset is not a file: ${file}`);
    // Minified CSS is emitted into dist/ only; the source stays readable.
    if (file === 'style.css') {
      fs.writeFileSync(path.join(output, file), minifyCss(fs.readFileSync(source, 'utf8')));
    } else {
      fs.copyFileSync(source, path.join(output, file));
    }
  }

  const articleTemplate = fs.readFileSync(path.join(root, 'article.html'), 'utf8');
  const homeTemplate = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  // One static page per published post: dist/<slug>/index.html.
  for (const post of posts) {
    const dir = path.join(output, post.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      generateArticlePage(articleTemplate, post, posts, counts)
    );
  }

  // Homepage with rendered cards.
  fs.writeFileSync(path.join(output, 'index.html'), generateHomePage(homeTemplate, posts, counts));

  // One page per category: dist/<Category>/index.html.
  for (const category of CATEGORY_ORDER) {
    const template = fs.readFileSync(path.join(root, CATEGORY_FILES[category]), 'utf8');
    const dir = path.join(output, CATEGORY_PAGES[category].slice(1));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      generateCategoryPage(template, category, posts, counts)
    );
  }

  // Static pages in directory form: dist/<dir>/index.html.
  for (const page of STATIC_PAGES) {
    const template = fs.readFileSync(path.join(root, page.file), 'utf8');
    const dir = path.join(output, page.dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), template);
  }

  // Slug list for functions/[[path]].js (validates /article?id= redirects).
  const slugs = [...posts.map((p) => p.slug)].sort();
  fs.writeFileSync(path.join(output, 'slugs.json'), `${JSON.stringify(slugs, null, 2)}\n`);

  const previewBuild = isCloudflarePreviewBuild();
  if (previewBuild) {
    fs.writeFileSync(path.join(output, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  }

  fs.writeFileSync(path.join(output, 'deployment-config.js'), "window.BLOGSPHERE_API_PLATFORM = 'cloudflare';\n");
  fs.writeFileSync(path.join(output, '_redirects'), redirects);
  fs.writeFileSync(path.join(output, '_headers'), [
    ...(previewBuild ? ['/*', '  X-Robots-Tag: noindex, nofollow', ''] : []),
    baseHeaders
  ].join('\n'));
  // SEO fix (16 Nov 2026): include '/*' so the root catch-all Function
  // (functions/[[path]].js, www -> apex redirect) runs on every route.
  // '/api/*' is covered by '/*'. Before this, only '/api/*' was included,
  // so the www redirect Function never ran.
  fs.writeFileSync(path.join(output, '_routes.json'), JSON.stringify({
    version: 1,
    include: ['/*'],
    exclude: []
  }, null, 2) + '\n');

  return { posts: posts.length, langCounts, counts };
}

if (require.main === module) {
  buildPages()
    .then(({ posts, langCounts, counts }) => {
      console.log(
        `Built ${posts} static article pages (${langCounts.fr} fr, ${langCounts.es} es, ${langCounts.en} en), ` +
          `homepage, ${CATEGORY_ORDER.length} category pages and ${STATIC_PAGES.length} static pages in dist.`
      );
      console.log(`Category counts: ${JSON.stringify(counts)}`);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}

module.exports = {
  buildPages,
  publicFiles,
  minifyCss,
  detectLanguage,
  truncateAtWord,
  articleTitle,
  articleDescription,
  rewriteInternalLinks,
  buildArticleContent
};
