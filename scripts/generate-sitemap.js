// Regenerate all three sitemaps from the live public API (full
// regeneration, 23 Nov 2026, Phase 1). Since Phase 5 (23 Nov 2026) the
// page build (scripts/build-pages.js) calls main() automatically before
// copying the sitemaps into dist/, so category lastmods always match the
// newest post date in each category — do not hand-edit sitemap dates.
//
// Usage: node scripts/generate-sitemap.js
//   BLOGSPHERE_API_URL=https://blogsphere.info/api/public-data?lite=1
//   BLOGSPHERE_CONTENT_JSON=/path/to/public-data.json  (local testing)
//
// Behaviour (replaces the old append-only /article?id= behaviour):
// - sitemap.xml: the 13 static pages (homepage, 5 categories,
//   Health-Tools, about, contact, privacy-policy, terms-and-conditions,
//   disclaimer, editorial-policy)
//   plus every published article at its clean URL
//   https://blogsphere.info/<slug>/ (lastmod = the article's updated /
//   published date, monthly, priority 0.7).
// - sitemap-articles.xml: the 134 articles only, same entries.
// - sitemap-pages.xml: the 13 static pages only. Category lastmod is the
//   newest post date in that category; the homepage lastmod is the newest
//   post date overall; the other static pages keep their existing lastmod
//   (read from the current sitemap-pages.xml).
// - No network write happens on failure: each file is only replaced after
//   the API fetch and the XML build succeed. robots.txt is unchanged (it
//   already references all three sitemaps).
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sitemapPath = path.join(root, 'sitemap.xml');
const articlesSitemapPath = path.join(root, 'sitemap-articles.xml');
const pagesSitemapPath = path.join(root, 'sitemap-pages.xml');
const apiUrl =
  process.env.BLOGSPHERE_API_URL || 'https://blogsphere.info/api/public-data?lite=1';
const siteOrigin = 'https://blogsphere.info';

const CATEGORIES = [
  { name: 'Technology', path: '/Technology' },
  { name: 'Business', path: '/Business' },
  { name: 'Home Decor', path: '/Home-Decor' },
  { name: 'Make Money Online', path: '/Make-Money-Online' },
  { name: 'Health & Fitness', path: '/Health-Fitness' }
];

// Static pages in sitemap-pages.xml order, with the changefreq/priority the
// file already uses. lastmod is filled in by main(): categories and the
// homepage from the newest post dates, the rest from the existing file.
const STATIC_PAGES = [
  { loc: '/', changefreq: 'daily', priority: '1.0' },
  { loc: '/Technology', changefreq: 'daily', priority: '0.9' },
  { loc: '/Business', changefreq: 'daily', priority: '0.9' },
  { loc: '/Home-Decor', changefreq: 'daily', priority: '0.9' },
  { loc: '/Make-Money-Online', changefreq: 'daily', priority: '0.9' },
  { loc: '/Health-Fitness', changefreq: 'daily', priority: '0.9' },
  { loc: '/Health-Tools', changefreq: 'weekly', priority: '0.8' },
  { loc: '/about', changefreq: 'yearly', priority: '0.5' },
  { loc: '/contact', changefreq: 'yearly', priority: '0.5' },
  { loc: '/privacy-policy', changefreq: 'yearly', priority: '0.5' },
  { loc: '/terms-and-conditions', changefreq: 'yearly', priority: '0.5' },
  { loc: '/disclaimer', changefreq: 'yearly', priority: '0.5' },
  { loc: '/editorial-policy', changefreq: 'yearly', priority: '0.5' }
];

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function loadPosts() {
  const contentJson = process.env.BLOGSPHERE_CONTENT_JSON || '';
  if (contentJson) {
    const raw = fs.readFileSync(path.resolve(contentJson), 'utf8');
    const data = JSON.parse(raw);
    return normalizePosts(data);
  }
  const res = await fetch(apiUrl);
  if (!res.ok) throw new Error(`API request failed: ${res.status} ${apiUrl}`);
  return normalizePosts(await res.json());
}

function normalizePosts(data) {
  const posts = Array.isArray(data) ? data : data.posts || data.data || [];
  return posts
    // GTA 6 merge (23 Nov 2026, items 22/23, APPROVED): the 8 merged slugs
    // have no generated page (301 in functions/[[path]].js), so they stay
    // out of the sitemaps; the 3 survivors stay in. The stored Supabase
    // content still lists all 11 posts; a permanent admin cleanup
    // (deleting the 8 in the admin) is a follow-up.
    .filter((p) => p && p.slug && p.status === 'published' && !p.deleted_at && !GTA6_MERGED_SLUGS.has(p.slug))
    .sort((a, b) => {
      const da = a.published_at || a.created_at || '';
      const db = b.published_at || b.created_at || '';
      if (da !== db) return db.localeCompare(da);
      return String(b.id || '').localeCompare(String(a.id || ''));
    });
}

// GTA 6 merge (23 Nov 2026, items 22/23): slugs with no generated page.
const GTA6_MERGED_SLUGS = new Set([
  'gta-6-release-date-us-guide',
  'gta-6-platforms-uk-guide',
  'gta-6-platforms-us-guide',
  'gta-6-ps5-frame-rate-guide',
  'gta-6-ps5-frame-rate-us-guide',
  'gta-6-ps5-frame-rate-guide-france',
  'gta-6-platforms-guia-espana',
  'gta-6-ps5-frame-rate-guia-espana'
]);

function urlEntry(loc, lastmod, changefreq, priority) {
  return [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>'
  ].join('\n');
}

function buildSitemap(entries) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries.join('\n') +
    '\n</urlset>\n'
  );
}

async function main() {
  const posts = await loadPosts();
  if (posts.length === 0) throw new Error('No published posts loaded; refusing to write empty sitemaps.');

  // Newest post date per category (for the category lastmods) and overall
  // (for the homepage lastmod).
  const newestByCategory = {};
  for (const category of CATEGORIES) {
    const inCategory = posts.filter((p) => p.category === category.name);
    newestByCategory[category.path] =
      dateOnly(inCategory[0] && (inCategory[0].published_at || inCategory[0].created_at || inCategory[0].date)) || null;
  }
  const newestOverall = dateOnly(posts[0].published_at || posts[0].created_at || posts[0].date);

  // Keep the existing lastmod for the static pages whose content did not
  // change (Health-Tools, about, contact, privacy-policy,
  // terms-and-conditions).
  const existingPages = fs.existsSync(pagesSitemapPath)
    ? fs.readFileSync(pagesSitemapPath, 'utf8')
    : '';
  const existingLastmod = {};
  for (const m of existingPages.matchAll(
    /<loc>(https:\/\/blogsphere\.info[^<]*)<\/loc>\s*<lastmod>([^<]*)<\/lastmod>/g
  )) {
    existingLastmod[m[1].replace(siteOrigin, '') || '/'] = m[2];
  }

  const pageEntries = STATIC_PAGES.map((page) => {
    let lastmod;
    if (page.loc === '/') lastmod = newestOverall;
    else if (newestByCategory[page.loc]) lastmod = newestByCategory[page.loc];
    else lastmod = existingLastmod[page.loc] || dateOnly(new Date());
    return urlEntry(`${siteOrigin}${page.loc}`, lastmod, page.changefreq, page.priority);
  });

  const articleEntries = posts.map((post) => {
    const lastmod =
      dateOnly(post.updated_at || post.published_at || post.created_at || post.date) ||
      dateOnly(new Date());
    return urlEntry(`${siteOrigin}/${post.slug}/`, lastmod, 'monthly', '0.7');
  });

  fs.writeFileSync(sitemapPath, buildSitemap([...pageEntries, ...articleEntries]));
  console.log(`sitemap.xml: ${pageEntries.length} pages + ${articleEntries.length} articles (${pageEntries.length + articleEntries.length} URLs).`);

  fs.writeFileSync(articlesSitemapPath, buildSitemap(articleEntries));
  console.log(`sitemap-articles.xml: ${articleEntries.length} articles.`);

  fs.writeFileSync(pagesSitemapPath, buildSitemap(pageEntries));
  console.log(`sitemap-pages.xml: ${pageEntries.length} pages.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { main };
