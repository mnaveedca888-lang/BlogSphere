// Cloudflare Pages Function: proxy /api/* to the Netlify Functions backend.
//
// The live Pages deployment is static-only, so /api/* currently returns
// 503 "API is unavailable in this static-only preview" and no articles load
// and the contact form cannot send. This function forwards every /api call
// to the working Netlify Functions backend (blogggsphere.netlify.app) and
// returns its response. Same-origin for the browser, so no CORS is involved.
//
// A repo Functions file replaces the stub functions from the earlier manual
// upload, so this works even if _redirects rules are not applied to /api.
export async function onRequest(context) {
  const route = context.params.route;

  const map = {
    'health': 'api-health',
    'public-data': 'api-public-data',
    'comments': 'api-comments',
    'contact': 'api-contact',
  };

  const target = map[route];
  if (!target) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(context.request.url);
  const upstream =
    'https://blogggsphere.netlify.app/.netlify/functions/' +
    target +
    url.search;

  const response = await fetch(upstream, context.request);
  return new Response(response.body, response);
}
