// Cloudflare Pages Function: proxy /api/* to the Netlify Functions backend.
//
// The live Pages deployment is static-only, so /api/* currently returns
// 503 "API is unavailable in this static-only preview" for the public
// routes and no articles load and the contact form cannot send. This
// function forwards every /api call to the working Netlify Functions
// backend (blogggsphere.netlify.app) and returns its response.
// Same-origin for the browser, so no CORS is involved.
//
// A repo Functions file replaces the stub functions from the earlier
// manual upload, so this works even if _redirects rules are not applied
// to /api.
//
// IMPORTANT: the admin routes (/api/admin/*) are live and working on the
// current deployment, so they must be proxied too — otherwise this
// function would replace them with 404s and break admin sign-in.
// The mapping below mirrors admin-api-routing.js (Cloudflare branch).
export async function onRequest(context) {
  const rawRoute = context.params.route;
  // [[route]] is a catch-all: it may arrive as an array of segments.
  const route = Array.isArray(rawRoute) ? rawRoute.join('/') : rawRoute;

  const map = {
    'health': 'api-health',
    'public-data': 'api-public-data',
    'comments': 'api-comments',
    'contact': 'api-contact',
    'admin/login': 'api-admin-login',
    'admin/session': 'api-admin-session',
    'admin/logout': 'api-admin-logout',
    'admin/posts': 'api-admin-posts',
    'admin/categories': 'api-admin-categories',
    'admin/upload': 'api-admin-upload',
    'admin/comments': 'api-admin-comments',
    'admin/users': 'api-admin-users',
    'admin/password-change': 'api-admin-password-change',
    'admin/password-recovery-request': 'api-admin-password-recovery-request',
    'admin/password-recovery-update': 'api-admin-password-recovery-update',
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
