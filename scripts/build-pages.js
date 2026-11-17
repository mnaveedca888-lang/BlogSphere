const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const publicFiles = [
  '404.html',
  'Business.html',
  'Business.jpeg',
  'Favicon_11zon.webp',
  'Health-Fitness.html',
  'Health-Fitness.jpeg',
  'Health-Tools.html',
  'Home-Decor.html',
  'Home-Decor.webp',
  'Logo.webp',
  'Make-Money-Online.html',
  'Make-Money-Online.webp',
  'Technology.html',
  'Technology.jpeg',
  'about.html',
  'admin-api-routing.js',
  'admin-full.html',
  'admin-full.js',
  'article.html',
  'blogsphere-smartfit-health-fitness-tool-v3.html',
  'contact.html',
  'deployment-config.js',
  'index.html',
  'llms.txt',
  'privacy-policy.html',
  'robots.txt',
  'script.js',
  'sitemap.xml',
  'style.css',
  'terms-and-conditions.html'
];

const redirects = [
  '/admin /admin-full.html 301',
  '/admin.html /admin-full.html 301',
  // SEO fix (16 Nov 2026): clean slug / lowercase-category URLs that Google
  // already found and reports as 404. Absolute destinations so a www request
  // lands on the apex in one hop instead of chaining.
  '/best-cardio-for-weight-loss https://blogsphere.info/article?id=best-cardio-for-weight-loss 301',
  '/best-weight-loss-exercises-small-uk-flat https://blogsphere.info/article?id=best-weight-loss-exercises-small-uk-flat 301',
  '/technology https://blogsphere.info/Technology 301',
  '/business https://blogsphere.info/Business 301',
  '/home-decor https://blogsphere.info/Home-Decor 301',
  '/make-money-online https://blogsphere.info/Make-Money-Online 301',
  '/health-fitness https://blogsphere.info/Health-Fitness 301',
  // Health Tools subpage (16 Nov 2026).
  '/health-tools https://blogsphere.info/Health-Tools 301'
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

function buildPages() {
  if (path.dirname(output) !== root || path.basename(output) !== 'dist') {
    throw new Error('Refusing to build outside the repository dist directory.');
  }

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
}

if (require.main === module) {
  buildPages();
  console.log(`Built ${publicFiles.length} allowlisted Pages assets in dist.`);
}

module.exports = { buildPages, publicFiles, minifyCss };
