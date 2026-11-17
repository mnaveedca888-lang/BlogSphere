// Regenerate sitemap.xml from the live public API.
//
// Usage: node scripts/generate-sitemap.js
//   BLOGSPHERE_API_URL=https://blogsphere.info/api/public-data?lite=1
//
// Behaviour (deliberately conservative so the diff stays reviewable):
// - Static pages and already-listed articles are kept byte-for-byte
//   (same order, same <lastmod>), parsed out of the existing sitemap.xml.
// - Published articles missing from the sitemap are APPENDED, newest
//   first, as <loc>https://blogsphere.info/article?id=<slug></loc> with
//   <lastmod> = the article's published date, monthly, priority 0.7 —
//   the same format the sitemap already uses for articles.
// - The same missing articles are appended to sitemap-articles.xml too:
//   the split files are the ones Search Console actually reads, and
//   they went stale twice (17 Nov) because only sitemap.xml was updated.
// - No network write happens on failure: the file is only replaced
//   after the API fetch and parse succeed.
// - Sitemap structure, robots.txt and canonicals are unchanged.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sitemapPath = path.join(root, 'sitemap.xml');
const articlesSitemapPath = path.join(root, 'sitemap-articles.xml');
const apiUrl =
  process.env.BLOGSPHERE_API_URL || 'https://blogsphere.info/api/public-data?lite=1';
const siteOrigin = 'https://blogsphere.info';

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

async function main() {
  const existing = fs.readFileSync(sitemapPath, 'utf8');
  const listed = new Set();
  for (const m of existing.matchAll(/article\?id=([\w-]+)/g)) listed.add(m[1]);

  const res = await fetch(apiUrl);
  if (!res.ok) throw new Error(`API request failed: ${res.status} ${apiUrl}`);
  const data = await res.json();
  const posts = Array.isArray(data) ? data : data.posts || data.data || [];
  const published = posts
    .filter((p) => p && p.slug && p.status === 'published' && !p.deleted_at)
    .sort((a, b) => {
      const da = a.published_at || a.created_at || '';
      const db = b.published_at || b.created_at || '';
      if (da !== db) return db.localeCompare(da);
      return String(b.id || '').localeCompare(String(a.id || ''));
    });

  const missing = published.filter((p) => !listed.has(p.slug));
  if (missing.length === 0) {
    console.log(`Sitemap already complete: ${published.length} published articles listed.`);
  } else {
    const additions = missing
      .map((p) => {
        const lastmod = dateOnly(p.published_at || p.created_at || p.date) || dateOnly(new Date());
        return [
          '  <url>',
          `    <loc>${siteOrigin}/article?id=${escapeXml(p.slug)}</loc>`,
          `    <lastmod>${lastmod}</lastmod>`,
          '    <changefreq>monthly</changefreq>',
          '    <priority>0.7</priority>',
          '  </url>',
        ].join('\n');
      })
      .join('\n');

    const updated = existing.replace(/<\/urlset>\s*$/, (match) => `${additions}\n${match}`);
    if (updated === existing) throw new Error('Could not locate </urlset> in sitemap.xml');
    fs.writeFileSync(sitemapPath, updated);
    console.log(
      `Added ${missing.length} article(s) to sitemap.xml ` +
        `(${published.length} published total): ${missing.map((p) => p.slug).join(', ')}`
    );
  }

  // Keep the split articles sitemap in step with sitemap.xml (same entries,
  // same order). Checked independently of sitemap.xml so a stale split file
  // is fixed even when the main sitemap is already complete.
  // sitemap-pages.xml needs no update here: it lists static pages only,
  // and no page was added or removed.
  const articlesExisting = fs.readFileSync(articlesSitemapPath, 'utf8');
  const articlesListed = new Set();
  for (const m of articlesExisting.matchAll(/article\?id=([\w-]+)/g)) articlesListed.add(m[1]);
  const articlesMissing = published.filter((p) => !articlesListed.has(p.slug));
  if (articlesMissing.length > 0) {
    const articlesAdditions = articlesMissing
      .map((p) => {
        const lastmod = dateOnly(p.published_at || p.created_at || p.date) || dateOnly(new Date());
        return [
          '  <url>',
          `    <loc>${siteOrigin}/article?id=${escapeXml(p.slug)}</loc>`,
          `    <lastmod>${lastmod}</lastmod>`,
          '    <changefreq>monthly</changefreq>',
          '    <priority>0.7</priority>',
          '  </url>',
        ].join('\n');
      })
      .join('\n');
    const articlesUpdated = articlesExisting.replace(
      /<\/urlset>\s*$/,
      (match) => `${articlesAdditions}\n${match}`
    );
    if (articlesUpdated === articlesExisting)
      throw new Error('Could not locate </urlset> in sitemap-articles.xml');
    fs.writeFileSync(articlesSitemapPath, articlesUpdated);
    console.log(
      `Added ${articlesMissing.length} article(s) to sitemap-articles.xml: ${articlesMissing
        .map((p) => p.slug)
        .join(', ')}`
    );
  } else {
    console.log('sitemap-articles.xml already complete.');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { main };
