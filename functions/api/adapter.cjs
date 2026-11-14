const handlers = {
  '/api/admin/categories': require('../../netlify/functions/api-admin-categories').handler,
  '/api/admin/comments': require('../../netlify/functions/api-admin-comments').handler,
  '/api/admin/login': require('../../netlify/functions/api-admin-login').handler,
  '/api/admin/logout': require('../../netlify/functions/api-admin-logout').handler,
  '/api/admin/password-change': require('../../netlify/functions/api-admin-password-change').handler,
  '/api/admin/password-recovery': require('../../netlify/functions/api-admin-password-recovery').handler,
  '/api/admin/password-recovery-request': require('../../netlify/functions/api-admin-password-recovery-request').handler,
  '/api/admin/password-recovery-update': require('../../netlify/functions/api-admin-password-recovery-update').handler,
  '/api/admin/posts': require('../../netlify/functions/api-admin-posts').handler,
  '/api/admin/session': require('../../netlify/functions/api-admin-session').handler,
  '/api/admin/upload': require('../../netlify/functions/api-admin-upload').handler,
  '/api/admin/users': require('../../netlify/functions/api-admin-users').handler,
  '/api/categories': require('../../netlify/functions/api-categories').handler,
  '/api/comments': require('../../netlify/functions/api-comments').handler,
  '/api/contact': require('../../netlify/functions/api-contact').handler,
  '/api/health': require('../../netlify/functions/api-health').handler,
  '/api/posts': require('../../netlify/functions/api-posts').handler,
  '/api/public-data': require('../../netlify/functions/api-public-data').handler,
  '/api/session': require('../../netlify/functions/api-session').handler
};

const routesWithoutSupabaseConfig = new Set([
  '/api/admin/logout',
  '/api/contact',
  '/api/health',
  '/api/session'
]);

const publicReadRoutes = new Set([
  '/api/categories',
  '/api/comments',
  '/api/posts',
  '/api/public-data'
]);

const safeDiagnosticErrorNames = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError']);

function hasPublicSupabaseConfig(env) {
  return ['SUPABASE_URL', 'SUPABASE_ANON_KEY']
    .every(name => typeof env[name] === 'string' && env[name].trim());
}

function hasSupabaseConfig(env) {
  return ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
    .every(name => typeof env[name] === 'string' && env[name].trim());
}

async function toNetlifyEvent(request) {
  const url = new URL(request.url);
  const body = ['GET', 'HEAD'].includes(request.method) ? null : await request.text();
  const headers = Object.fromEntries(request.headers.entries());
  const cloudflareClientIp = request.headers.get('cf-connecting-ip');
  delete headers['x-nf-client-connection-ip'];
  if (cloudflareClientIp) headers['x-nf-client-connection-ip'] = cloudflareClientIp;
  return {
    httpMethod: request.method,
    path: url.pathname,
    headers,
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    body,
    isBase64Encoded: false
  };
}

function toResponse(result) {
  let operation = 'response validation';
  try {
    if (!result || !Number.isInteger(result.statusCode) || result.statusCode < 100 || result.statusCode > 599) {
      throw new TypeError('Netlify handler returned an invalid response.');
    }

    operation = 'response header construction';
    const headers = new Headers(result.headers || {});
    const body = [204, 205, 304].includes(result.statusCode) ? null : result.body ?? null;
    operation = 'Response construction';
    return new Response(body, { status: result.statusCode, headers });
  } catch (error) {
    const errorName = error instanceof Error && safeDiagnosticErrorNames.has(error.name)
      ? error.name
      : 'Error';
    const message = error instanceof Error ? error.message : '';
    const safeMessages = new Set([
      'Netlify handler returned an invalid response.',
      'Invalid header name'
    ]);
    const safeMessage = safeMessages.has(message) || /^The status provided \(\d+\) is outside the range \[200, 599\]\.$/.test(message)
      ? message
      : 'Error message suppressed';
    console.error('Pages response conversion diagnostic:', {
      operation,
      errorName,
      errorMessage: safeMessage
    });
    throw error;
  }
}

async function dispatch(request, env = {}) {
  const pathname = new URL(request.url).pathname;
  if ((pathname === '/api' || pathname.startsWith('/api/'))
    && env.BLOGSPHERE_READ_ONLY !== 'false'
    && request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'This Cloudflare deployment is read-only.' }), {
      status: 403,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json'
      }
    });
  }
  const handler = handlers[pathname];
  if (!handler) return new Response('Not Found', { status: 404 });
  const canCheckAdminSessionWithoutSupabase = pathname === '/api/admin/session'
    && !request.headers.has('cookie');
  const isPublicRead = request.method === 'GET' && publicReadRoutes.has(pathname);
  const hasRequiredConfig = isPublicRead ? hasPublicSupabaseConfig(env) : hasSupabaseConfig(env);
  if (!routesWithoutSupabaseConfig.has(pathname) && !canCheckAdminSessionWithoutSupabase && !hasRequiredConfig) {
    return new Response(JSON.stringify({ error: 'API is unavailable in this static-only preview.' }), {
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json'
      }
    });
  }
  return toResponse(await handler(await toNetlifyEvent(request)));
}

module.exports = { dispatch, handlers, toNetlifyEvent, toResponse };
