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
  'contact.html',
  'deployment-config.js',
  'index.html',
  'privacy-policy.html',
  'robots.txt',
  'script.js',
  'sitemap.xml',
  'style.css',
  'terms-and-conditions.html'
];

const redirects = [
  '/admin /admin-full.html 301',
  '/admin.html /admin-full.html 301'
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

function buildPages() {
  if (path.dirname(output) !== root || path.basename(output) !== 'dist') {
    throw new Error('Refusing to build outside the repository dist directory.');
  }

  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });

  for (const file of publicFiles) {
    const source = path.join(root, file);
    if (!fs.statSync(source).isFile()) throw new Error(`Public asset is not a file: ${file}`);
    fs.copyFileSync(source, path.join(output, file));
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
  fs.writeFileSync(path.join(output, '_routes.json'), JSON.stringify({
    version: 1,
    include: ['/api/*'],
    exclude: []
  }, null, 2) + '\n');
}

if (require.main === module) {
  buildPages();
  console.log(`Built ${publicFiles.length} allowlisted Pages assets in dist.`);
}

module.exports = { buildPages, publicFiles };
