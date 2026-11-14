const assert = require('node:assert/strict');
const test = require('node:test');

const { handler: adminPosts } = require('../netlify/functions/api-admin-posts');
const { sessionCookie } = require('../netlify/functions/_supabase');

const TEST_ENV = {
  SUPABASE_URL: 'https://supabase.example',
  SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  SESSION_SECRET: 'test-session-secret-with-at-least-32-characters'
};
const authUser = { id: 'auth-user-1' };
const adminProfile = {
  id: 7,
  name: 'Test Admin',
  email: 'admin@example.com',
  role: 'administrator',
  auth_user_id: authUser.id,
  is_active: true,
  must_change_password: false
};
const post = { id: 42, title: 'Target post', author_user_id: authUser.id };

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function cookiePair(setCookie) {
  return setCookie.split(';', 1)[0];
}

async function withSupabase(fetchMock, run) {
  const originalFetch = global.fetch;
  const originalEnv = Object.fromEntries(
    Object.keys(TEST_ENV).map(name => [name, process.env[name]])
  );
  Object.assign(process.env, TEST_ENV);
  global.fetch = fetchMock;

  try {
    const cookie = cookiePair(await sessionCookie({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token'
    }));
    await run(cookie);
  } finally {
    global.fetch = originalFetch;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function createSupabaseMock({ posts = [post], deleteResponse = new Response(null, { status: 204 }), profile = adminProfile } = {}) {
  const calls = [];
  const fetchMock = async (input, options = {}) => {
    const url = new URL(String(input));
    const method = options.method || 'GET';
    const headers = new Headers(options.headers);
    calls.push({ url, method, headers });

    if (url.pathname === '/auth/v1/user') {
      assert.equal(headers.get('Authorization'), 'Bearer test-access-token');
      return jsonResponse(200, authUser);
    }
    if (url.pathname === '/rest/v1/users') {
      assert.equal(headers.get('Authorization'), `Bearer ${TEST_ENV.SUPABASE_SERVICE_ROLE_KEY}`);
      return jsonResponse(200, [profile]);
    }
    if (url.pathname === '/rest/v1/posts' && method === 'GET') {
      assert.equal(headers.get('Authorization'), `Bearer ${TEST_ENV.SUPABASE_SERVICE_ROLE_KEY}`);
      return jsonResponse(200, posts);
    }
    if (url.pathname === '/rest/v1/posts' && method === 'DELETE') {
      assert.equal(headers.get('Authorization'), `Bearer ${TEST_ENV.SUPABASE_SERVICE_ROLE_KEY}`);
      return deleteResponse;
    }
    throw new Error(`Unexpected mocked request: ${method} ${url.pathname}`);
  };
  return { calls, fetchMock };
}

function deleteEvent(cookie, id = '42') {
  return {
    httpMethod: 'DELETE',
    headers: cookie ? { cookie } : {},
    queryStringParameters: id === undefined ? {} : { id }
  };
}

test('permanent deletion issues a hard delete for only the requested post ID', async () => {
  const { calls, fetchMock } = createSupabaseMock();

  await withSupabase(fetchMock, async cookie => {
    const result = await adminPosts(deleteEvent(cookie, '42'));
    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body), { ok: true });

    const deletes = calls.filter(call => call.method === 'DELETE');
    assert.equal(deletes.length, 1);
    assert.equal(deletes[0].url.pathname, '/rest/v1/posts');
    assert.equal(deletes[0].url.searchParams.get('id'), 'eq.42');
    assert.equal(deletes[0].headers.get('Prefer'), 'return=minimal');
    assert.equal(calls.some(call => call.url.pathname.startsWith('/storage/v1/object/')), false);
  });
});

test('unauthenticated deletion is rejected before any database request', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    assert.fail('Supabase must not be called for an unauthenticated request.');
  };

  try {
    const result = await adminPosts(deleteEvent(null, '42'));
    assert.equal(result.statusCode, 401);
    assert.deepEqual(JSON.parse(result.body), { error: 'Unauthorized' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('authenticated users without post-write permission cannot delete posts', async () => {
  const viewerProfile = { ...adminProfile, role: 'viewer' };
  const { calls, fetchMock } = createSupabaseMock({ profile: viewerProfile });

  await withSupabase(fetchMock, async cookie => {
    const result = await adminPosts(deleteEvent(cookie, '42'));
    assert.equal(result.statusCode, 403);
    assert.deepEqual(JSON.parse(result.body), {
      error: 'Your role does not allow post changes.'
    });
    assert.equal(calls.some(call => call.url.pathname === '/rest/v1/posts'), false);
  });
});

test('nonexistent post IDs return 404 without issuing a delete', async () => {
  const { calls, fetchMock } = createSupabaseMock({ posts: [] });

  await withSupabase(fetchMock, async cookie => {
    const result = await adminPosts(deleteEvent(cookie, '404'));
    assert.equal(result.statusCode, 404);
    assert.deepEqual(JSON.parse(result.body), { error: 'Post not found.' });
    assert.equal(calls.some(call => call.method === 'DELETE'), false);
  });
});

test('database deletion failures return a clear server error', async () => {
  const { fetchMock } = createSupabaseMock({
    deleteResponse: jsonResponse(500, { message: 'Database unavailable.' })
  });
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await withSupabase(fetchMock, async cookie => {
      const result = await adminPosts(deleteEvent(cookie, '42'));
      assert.equal(result.statusCode, 500);
      assert.equal(JSON.parse(result.body).error, 'Unable to complete post operation.');
    });
  } finally {
    console.error = originalConsoleError;
  }
});
