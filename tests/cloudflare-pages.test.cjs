const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildPages, publicFiles } = require('../scripts/build-pages');
const adapter = require('../functions/api/adapter.cjs');

test('build publishes only the allowlisted site and Pages metadata', () => {
  buildPages();
  const output = path.resolve(__dirname, '..', 'dist');
  const files = fs.readdirSync(output).sort();
  const expected = [...publicFiles, '_headers', '_redirects', '_routes.json'].sort();
  assert.deepEqual(files, expected);

  for (const blocked of ['server.js', 'netlify', 'functions', 'package.json', 'package-lock.json', '.env.example', '.dev.vars.example', 'phase1-supabase']) {
    assert.equal(fs.existsSync(path.join(output, blocked)), false, `${blocked} must not be published`);
  }
  assert.equal(
    fs.readFileSync(path.join(output, 'deployment-config.js'), 'utf8'),
    "window.BLOGSPHERE_API_PLATFORM = 'cloudflare';\n"
  );
});

test('preview builds prevent indexing while the master build keeps production SEO files', () => {
  const output = path.resolve(__dirname, '..', 'dist');
  const sourceRobots = fs.readFileSync(path.resolve(__dirname, '..', 'robots.txt'), 'utf8').replace(/\r\n/g, '\n');
  const sourceSitemap = fs.readFileSync(path.resolve(__dirname, '..', 'sitemap.xml'), 'utf8');
  const originalPages = process.env.CF_PAGES;
  const originalBranch = process.env.CF_PAGES_BRANCH;

  try {
    process.env.CF_PAGES = '1';
    process.env.CF_PAGES_BRANCH = 'master';
    buildPages();
    assert.equal(fs.readFileSync(path.join(output, 'robots.txt'), 'utf8').replace(/\r\n/g, '\n'), sourceRobots);
    assert.equal(fs.readFileSync(path.join(output, '_headers'), 'utf8').includes('X-Robots-Tag: noindex'), false);

    process.env.CF_PAGES_BRANCH = 'cloudflare-migration';
    buildPages();
    assert.equal(fs.readFileSync(path.join(output, 'robots.txt'), 'utf8'), 'User-agent: *\nDisallow: /\n');
    assert.equal(fs.readFileSync(path.join(output, 'sitemap.xml'), 'utf8'), sourceSitemap);
    assert.equal(fs.readFileSync(path.join(output, '_headers'), 'utf8').includes('X-Robots-Tag: noindex, nofollow'), true);
  } finally {
    if (originalPages === undefined) delete process.env.CF_PAGES;
    else process.env.CF_PAGES = originalPages;
    if (originalBranch === undefined) delete process.env.CF_PAGES_BRANCH;
    else process.env.CF_PAGES_BRANCH = originalBranch;
    buildPages();
  }
});

test('all Netlify handlers are mapped to Pages API paths', () => {
  assert.deepEqual(Object.keys(adapter.handlers).sort(), [
    '/api/admin/categories',
    '/api/admin/comments',
    '/api/admin/login',
    '/api/admin/logout',
    '/api/admin/password-change',
    '/api/admin/password-recovery',
    '/api/admin/password-recovery-request',
    '/api/admin/password-recovery-update',
    '/api/admin/posts',
    '/api/admin/session',
    '/api/admin/upload',
    '/api/admin/users',
    '/api/categories',
    '/api/comments',
    '/api/contact',
    '/api/health',
    '/api/posts',
    '/api/public-data',
    '/api/session'
  ]);
});

test('Pages requests are translated into the Netlify event shape', async () => {
  const request = new Request('https://blogsphere.pages.dev/api/comments?post_id=12', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'sample=value',
      'CF-Connecting-IP': '198.51.100.10',
      'X-Nf-Client-Connection-Ip': '203.0.113.99'
    },
    body: '{"body":"hello"}'
  });
  const event = await adapter.toNetlifyEvent(request);
  assert.equal(event.httpMethod, 'POST');
  assert.equal(event.path, '/api/comments');
  assert.equal(event.queryStringParameters.post_id, '12');
  assert.equal(event.headers.cookie, 'sample=value');
  assert.equal(event.headers['x-nf-client-connection-ip'], '198.51.100.10');
  assert.equal(event.body, '{"body":"hello"}');
  assert.equal(event.isBase64Encoded, false);
});

test('Pages adapter removes spoofable Netlify IP headers when Cloudflare IP is absent', async () => {
  const event = await adapter.toNetlifyEvent(new Request('https://blogsphere.pages.dev/api/comments', {
    headers: {
      'X-Nf-Client-Connection-Ip': '203.0.113.99',
      'X-Forwarded-For': '203.0.113.99'
    }
  }));
  assert.equal(event.headers['x-nf-client-connection-ip'], undefined);
  assert.equal(event.headers['x-forwarded-for'], '203.0.113.99');
});

test('comment rate limiting ignores X-Forwarded-For and uses only trusted normalized IPs', () => {
  const comments = require('../netlify/functions/api-comments');
  assert.equal(comments.requestIp({
    headers: {
      'x-nf-client-connection-ip': '198.51.100.10',
      'x-forwarded-for': '203.0.113.99'
    }
  }), '198.51.100.10');
  assert.equal(comments.requestIp({ headers: { 'x-forwarded-for': '203.0.113.99' } }), '');
});

test('Pages response adapter preserves status and cookie headers', () => {
  const response = adapter.toResponse({
    statusCode: 201,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'session=opaque; HttpOnly; Secure' },
    body: '{"ok":true}'
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.equal(response.headers.get('set-cookie'), 'session=opaque; HttpOnly; Secure');
});

test('health and unknown API routes return the expected response', async () => {
  const health = await adapter.dispatch(new Request('https://blogsphere.pages.dev/api/health'));
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  const unknown = await adapter.dispatch(new Request('https://blogsphere.pages.dev/api/not-a-route'));
  assert.equal(unknown.status, 404);
});

test('JSON request bodies reach existing handlers when read-only mode is explicitly disabled', async () => {
  const response = await adapter.dispatch(new Request('https://blogsphere.pages.dev/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  }), { BLOGSPHERE_READ_ONLY: 'false' });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    message: 'Name, email, subject, and message are required.'
  });
});

test('Cloudflare defaults to blocking every non-GET API method on all registered routes', async () => {
  for (const route of Object.keys(adapter.handlers)) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await adapter.dispatch(new Request(`https://blogsphere.pages.dev${route}`, { method }));
      assert.equal(response.status, 403, `${method} ${route} should be blocked by default`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  }

  const unknownPost = await adapter.dispatch(new Request('https://blogsphere.pages.dev/api/not-a-route', { method: 'POST' }));
  assert.equal(unknownPost.status, 403);
});

test('Cloudflare read-only mode leaves public and logged-out session GETs available', async () => {
  const session = await adapter.dispatch(new Request('https://blogsphere.pages.dev/api/session'));
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { user: null });

  const adminSession = await adapter.dispatch(new Request('https://blogsphere.pages.dev/api/admin/session'));
  assert.equal(adminSession.status, 200);
  assert.deepEqual(await adminSession.json(), { user: null });
});

test('Supabase-backed GET APIs fail with a non-cacheable 503 when credentials are absent', async () => {
  for (const route of [
    '/api/categories',
    '/api/posts',
    '/api/public-data',
    '/api/comments?post_id=1',
    '/api/admin/categories',
    '/api/admin/comments',
    '/api/admin/posts',
    '/api/admin/users'
  ]) {
    const response = await adapter.dispatch(new Request(`https://blogsphere.pages.dev${route}`));
    assert.equal(response.status, 503, `${route} should fail closed without Supabase credentials`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      error: 'API is unavailable in this static-only preview.'
    });
  }
});

test('public category reads use the anon key without requiring the service-role key', async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalAnonKey = process.env.SUPABASE_ANON_KEY;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const calls = [];

  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers });
    return new Response(JSON.stringify([{
      id: 1,
      name: 'Technology',
      slug: 'technology',
      description: null,
      created_at: '2026-01-01T00:00:00Z'
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const response = await adapter.dispatch(
      new Request('https://blogsphere.pages.dev/api/categories'),
      {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
      }
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json())[0].name, 'Technology');
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/rest\/v1\/categories\?select=\*&order=name.asc/);
    assert.equal(calls[0].headers.apikey, 'test-anon-key');
    assert.equal(calls[0].headers.Authorization, 'Bearer test-anon-key');
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = originalAnonKey;
    if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  }
});

test('public post APIs use only the anon key', async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalAnonKey = process.env.SUPABASE_ANON_KEY;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const calls = [];

  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers });
    const body = String(url).includes('/rest/v1/categories')
      ? [{ id: 2, name: 'Technology', slug: 'technology', description: null, created_at: '2026-01-01T00:00:00Z' }]
      : [{
        id: 1,
        title: 'Public article',
        slug: 'public-article',
        category_id: 2,
        status: 'published',
        published_at: '2026-01-01T00:00:00Z',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z'
      }];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    for (const route of ['/api/posts', '/api/public-data']) {
      const response = await adapter.dispatch(
        new Request(`https://blogsphere.pages.dev${route}`),
        {
          SUPABASE_URL: process.env.SUPABASE_URL,
          SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
        }
      );
      assert.equal(response.status, 200, route);
      assert.ok(calls.every(call => call.headers.apikey === 'test-anon-key'));
      assert.ok(calls.every(call => call.headers.Authorization === 'Bearer test-anon-key'));
    }
    assert.equal(calls.length, 4);
    assert.equal(
      calls.filter(call => call.url.includes('/rest/v1/posts?')).length,
      2
    );
    assert.ok(calls.filter(call => call.url.includes('/rest/v1/posts?')).every(call =>
      call.url.includes('/rest/v1/posts?select=*&status=eq.published&deleted_at=is.null&order=published_at.desc.nullslast,created_at.desc.nullslast,id.desc')
    ));
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = originalAnonKey;
    if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  }
});

test('admin database APIs still require the service-role binding', async () => {
  const response = await adapter.dispatch(
    new Request('https://blogsphere.pages.dev/api/admin/users'),
    {
      BLOGSPHERE_READ_ONLY: 'false',
      SUPABASE_URL: 'https://supabase.example',
      SUPABASE_ANON_KEY: 'test-anon-key'
    }
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'API is unavailable in this static-only preview.'
  });
});

test('public comment reads use anon for post validation and service role for approved comments only', async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalAnonKey = process.env.SUPABASE_ANON_KEY;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const calls = [];

  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers });
    const body = String(url).includes('/rest/v1/posts') ? [{ id: 1 }] : [
      {
        id: 1,
        post_id: 1,
        status: 'approved',
        name: 'Approved visitor',
        body: 'Public comment',
        reply: null,
        reply_at: null,
        created_at: '2026-11-14T10:00:00.000Z',
        email: 'private@example.com',
        rate_limit_hash: 'private-rate-limit-value'
      },
      {
        id: 2,
        post_id: 1,
        status: 'pending',
        name: 'Pending visitor',
        body: 'Pending comment',
        reply: null,
        reply_at: null,
        created_at: '2026-11-14T10:01:00.000Z'
      },
      {
        id: 3,
        post_id: 1,
        status: 'rejected',
        name: 'Rejected visitor',
        body: 'Rejected comment',
        reply: null,
        reply_at: null,
        created_at: '2026-11-14T10:02:00.000Z'
      },
      {
        id: 4,
        post_id: 99,
        status: 'approved',
        name: 'Other-post visitor',
        body: 'Comment for another post',
        reply: null,
        reply_at: null,
        created_at: '2026-11-14T10:03:00.000Z'
      }
    ];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const response = await adapter.dispatch(
      new Request('https://blogsphere.pages.dev/api/comments?post_id=1'),
      {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
      }
    );
    assert.equal(response.status, 200);
    const comments = await response.json();
    assert.deepEqual(comments, [{
      id: 1,
      name: 'Approved visitor',
      body: 'Public comment',
      reply: null,
      reply_at: null,
      created_at: '2026-11-14T10:00:00.000Z'
    }]);
    assert.equal(JSON.stringify(comments).includes('private@example.com'), false);
    assert.equal(JSON.stringify(comments).includes('private-rate-limit-value'), false);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].headers.apikey, 'test-anon-key');
    assert.equal(calls[0].headers.Authorization, 'Bearer test-anon-key');
    assert.match(calls[0].url, /\/rest\/v1\/posts\?/);
    assert.match(calls[0].url, /status=eq\.published&deleted_at=is\.null&limit=1/);
    assert.equal(calls[1].headers.apikey, 'test-service-role-key');
    assert.equal(calls[1].headers.Authorization, 'Bearer test-service-role-key');
    assert.match(calls[1].url, /\/rest\/v1\/comments\?/);
    assert.match(calls[1].url, /post_id=eq\.1/);
    assert.match(calls[1].url, /status=eq\.approved&order=created_at\.asc/);
    const commentsUrl = new URL(calls[1].url);
    assert.equal(commentsUrl.searchParams.get('select'), 'id,post_id,status,name,body,reply,reply_at,created_at');
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = originalAnonKey;
    if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  }
});

test('handlers reject unsupported methods when read-only mode is explicitly disabled', async () => {
  const testBindings = {
    BLOGSPHERE_READ_ONLY: 'false',
    SUPABASE_URL: 'https://unused.invalid',
    SUPABASE_ANON_KEY: 'test-anon-placeholder',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-placeholder'
  };
  for (const route of Object.keys(adapter.handlers)) {
    const response = await adapter.dispatch(
      new Request(`https://blogsphere.pages.dev${route}`, { method: 'OPTIONS' }),
      testBindings
    );
    assert.equal(response.status, 405, `${route} should reject OPTIONS`);
  }
});
