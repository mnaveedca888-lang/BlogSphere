// Build-time static generation for Cloudflare Pages (23 Nov 2026, Phase 1).
//
// The build fetches the published posts from the live public API and
// renders real static HTML, so crawlers see full article text, meta tags
// and links without JavaScript:
//
// - dist/<slug>/index.html        one static page per published post
// - dist/index.html               homepage with rendered article cards
// - dist/<Category>/index.html    one page per category with its posts
// - dist/<page>/index.html        about, contact, privacy, terms, Health-Tools
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
  '/terms-and-conditions.html /terms-and-conditions 301'
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
      /href="https?:\/\/blogsphere\.info\/(Technology|Business|Home-Decor|Make-Money-Online|Health-Fitness|about|contact|privacy-policy|terms-and-conditions)\.html(\?[^"]*)?"/gi,
      'href="https://blogsphere.info/$1"'
    )
    .replace(
      /href="\/(Technology|Business|Home-Decor|Make-Money-Online|Health-Fitness|about|contact|privacy-policy|terms-and-conditions)\.html(\?[^"]*)?"/gi,
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
  return rewriteInternalLinks(decorateArticleImages(body));
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
  const dateModified = post.updated_at || post.published_at || post.created_at || post.date || '';
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
