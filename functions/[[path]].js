// SEO redirects (16 Nov 2026, extended 23 Nov 2026).
//
// Cloudflare Pages did not apply the matching rules in _redirects for this
// project (the www rule uses an absolute-URL source, which Pages skips, and
// the relative clean-URL rules did not take effect either), so the redirects
// live here instead. This is a catch-all: it runs for every request that is
// not handled by a more specific route (functions/api/* keeps serving the
// API). Anything that is not a redirect falls through to the static site
// with context.next(), so normal pages, assets and API calls are untouched.
//
// 23 Nov 2026 (Phase 1 static generation): the site now serves clean
// static URLs — /<slug>/ for articles, /<Category> for categories and
// /<page> for static pages. The old forms redirect here:
//   /article?id=<slug> and /article.html?id=<slug>  ->  /<slug>/ (301)
//   /<Category>.html and /<page>.html               ->  clean URL (301)
// A slug that is not a published post returns the 404 page with HTTP 404.
// Slugs are validated against dist/slugs.json (written by the build),
// fetched once and cached in a module-level variable; if that fetch fails,
// the redirect is unconditional and the static 404 handles a bad slug.
const CLEAN_REDIRECTS = {
  '/best-cardio-for-weight-loss': '/best-cardio-for-weight-loss/',
  '/best-weight-loss-exercises-small-uk-flat': '/best-weight-loss-exercises-small-uk-flat/',
  '/technology': '/Technology',
  '/business': '/Business',
  '/home-decor': '/Home-Decor',
  '/make-money-online': '/Make-Money-Online',
  '/health-fitness': '/Health-Fitness',
  '/health-tools': '/Health-Tools',
  '/Technology.html': '/Technology',
  '/Business.html': '/Business',
  '/Home-Decor.html': '/Home-Decor',
  '/Make-Money-Online.html': '/Make-Money-Online',
  '/Health-Fitness.html': '/Health-Fitness',
  '/Health-Tools.html': '/Health-Tools',
  '/about.html': '/about',
  '/contact.html': '/contact',
  '/privacy-policy.html': '/privacy-policy',
  '/terms-and-conditions.html': '/terms-and-conditions'
};

let slugSetPromise = null;

async function loadSlugSet(context, origin) {
  if (slugSetPromise) return slugSetPromise;
  slugSetPromise = (async () => {
    try {
      const slugsUrl = new URL('/slugs.json', origin);
      let res = null;
      if (context.env && context.env.ASSETS) {
        res = await context.env.ASSETS.fetch(new Request(slugsUrl));
      } else {
        res = await fetch(slugsUrl);
      }
      if (!res || !res.ok) return null;
      const slugs = await res.json();
      return new Set(Array.isArray(slugs) ? slugs : []);
    } catch {
      return null;
    }
  })();
  return slugSetPromise;
}

async function notFoundResponse(context, origin) {
  try {
    const notFoundUrl = new URL('/404.html', origin);
    let res = null;
    if (context.env && context.env.ASSETS) {
      res = await context.env.ASSETS.fetch(new Request(notFoundUrl));
    } else {
      res = await fetch(notFoundUrl);
    }
    if (res && res.ok) {
      const body = await res.text();
      return new Response(body, {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
  } catch {
    // Fall through to the plain-text 404 below.
  }
  return new Response('Page not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

export async function onRequest(context) {
  const url = new URL(context.request.url);

  // www.blogsphere.info -> blogsphere.info (keep path and query).
  if (url.hostname === 'www.blogsphere.info') {
    url.hostname = 'blogsphere.info';
    return Response.redirect(url.toString(), 301);
  }

  // Old article URLs: /article?id=<slug> and /article.html?id=<slug>
  // (also ?slug=) -> the clean static URL /<slug>/.
  if (url.pathname === '/article' || url.pathname === '/article.html') {
    const slug = (url.searchParams.get('id') || url.searchParams.get('slug') || '').trim();
    if (slug) {
      const slugs = await loadSlugSet(context, url.origin);
      if (slugs && !slugs.has(slug)) return notFoundResponse(context, url.origin);
      return Response.redirect(new URL(`/${encodeURIComponent(slug)}/`, url.origin).toString(), 301);
    }
    return Response.redirect(new URL('/', url.origin).toString(), 301);
  }

  // Clean slug / lowercase-category URLs and old .html forms.
  const target = CLEAN_REDIRECTS[url.pathname];
  if (target) {
    return Response.redirect(new URL(target, url.origin).toString(), 301);
  }

  return context.next();
}
