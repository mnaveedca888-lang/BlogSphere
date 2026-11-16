// SEO redirects (16 Nov 2026).
//
// Cloudflare Pages did not apply the matching rules in _redirects for this
// project (the www rule uses an absolute-URL source, which Pages skips, and
// the relative clean-URL rules did not take effect either), so the redirects
// live here instead. This is a catch-all: it runs for every request that is
// not handled by a more specific route (functions/api/* keeps serving the
// API). Anything that is not a redirect falls through to the static site
// with context.next(), so normal pages, assets and API calls are untouched.
const CLEAN_REDIRECTS = {
  '/best-cardio-for-weight-loss': '/article?id=best-cardio-for-weight-loss',
  '/best-weight-loss-exercises-small-uk-flat': '/article?id=best-weight-loss-exercises-small-uk-flat',
  '/technology': '/Technology',
  '/business': '/Business',
  '/home-decor': '/Home-Decor',
  '/make-money-online': '/Make-Money-Online',
  '/health-fitness': '/Health-Fitness',
};

export async function onRequest(context) {
  const url = new URL(context.request.url);

  // www.blogsphere.info -> blogsphere.info (keep path and query).
  if (url.hostname === 'www.blogsphere.info') {
    url.hostname = 'blogsphere.info';
    return Response.redirect(url.toString(), 301);
  }

  // Clean slug / lowercase-category URLs -> working forms.
  const target = CLEAN_REDIRECTS[url.pathname];
  if (target) {
    return Response.redirect(new URL(target, url.origin).toString(), 301);
  }

  return context.next();
}
