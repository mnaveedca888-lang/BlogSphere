const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const test = require('node:test');

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const SESSION_COOKIE_NAME = 'blogsphere_admin_session';
const START_TIME = 1800000000000;
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

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function cookiePair(setCookie) {
  return setCookie.split(';', 1)[0];
}

function cookieValue(cookie) {
  return decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
}

async function legacyCookiePair(session) {
  const iv = nodeCrypto.randomBytes(12);
  const key = nodeCrypto.createHash('sha256').update(TEST_ENV.SESSION_SECRET).digest();
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    new Uint8Array(key),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const encryptedWithTag = new Uint8Array(await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv), tagLength: 128 },
    cryptoKey,
    new TextEncoder().encode(JSON.stringify(session))
  ));
  const splitAt = encryptedWithTag.length - 16;
  const token = [
    iv.toString('base64url'),
    Buffer.from(encryptedWithTag.subarray(splitAt)).toString('base64url'),
    Buffer.from(encryptedWithTag.subarray(0, splitAt)).toString('base64url')
  ].join('.');
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

async function withSessionRuntime(fetchMock, run, startTime = START_TIME) {
  const originalFetch = global.fetch;
  const originalNow = Date.now;
  const originalEnv = Object.fromEntries(
    Object.keys(TEST_ENV).map(name => [name, process.env[name]])
  );
  let now = startTime;
  Object.assign(process.env, TEST_ENV);
  global.fetch = fetchMock;
  Date.now = () => now;

  try {
    await run({ setNow: value => { now = value; } });
  } finally {
    global.fetch = originalFetch;
    Date.now = originalNow;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('successful login cookie remains accepted after a page refresh', async () => {
  const { handler: login } = require('../netlify/functions/api-admin-login');
  const { handler: checkSession } = require('../netlify/functions/api-admin-session');
  const requests = [];

  await withSessionRuntime(async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('/auth/v1/token?grant_type=password')) {
      return jsonResponse(200, {
        access_token: 'login-access-token',
        refresh_token: 'login-refresh-token',
        user: authUser
      });
    }
    if (String(url).includes('/rest/v1/users?')) {
      return jsonResponse(200, [adminProfile]);
    }
    if (String(url).endsWith('/auth/v1/user')) {
      return jsonResponse(200, authUser);
    }
    throw new Error('Unexpected mocked Supabase request.');
  }, async () => {
    const loginResult = await login({
      httpMethod: 'POST',
      body: JSON.stringify({ email: adminProfile.email, password: 'not-stored' })
    });
    assert.equal(loginResult.statusCode, 200);
    const setCookie = loginResult.headers['Set-Cookie'];
    assert.match(setCookie, /; Path=\//);
    assert.match(setCookie, /; HttpOnly/);
    assert.match(setCookie, /; Secure/);
    assert.match(setCookie, /; SameSite=Lax/);
    assert.match(setCookie, new RegExp(`; Max-Age=${SESSION_MAX_AGE_SECONDS}$`));

    const cookie = cookiePair(setCookie);
    assert.equal(cookie.split('=')[0], SESSION_COOKIE_NAME);
    assert.equal(cookieValue(cookie).split('.').length, 3);

    const refreshedPage = await checkSession({
      httpMethod: 'GET',
      headers: { cookie }
    });
    assert.equal(refreshedPage.statusCode, 200);
    assert.deepEqual(JSON.parse(refreshedPage.body), {
      user: {
        id: adminProfile.id,
        name: adminProfile.name,
        email: adminProfile.email,
        role: adminProfile.role,
        is_active: true,
        must_change_password: false,
        is_main_admin: false
      }
    });
    assert.equal(requests.filter(item => item.url.endsWith('/auth/v1/user')).length, 1);
  });
});

test('session refresh preserves the original 30-day expiration', async () => {
  const { handler: checkSession } = require('../netlify/functions/api-admin-session');
  const { sessionCookie } = require('../netlify/functions/_supabase');
  let currentAccessToken = 'expired-access-token';
  let fetchCalls = 0;
  const fetchMock = async (url, options = {}) => {
    fetchCalls += 1;
    const requestUrl = String(url);
    if (requestUrl.endsWith('/auth/v1/user')) {
      const accessToken = new Headers(options.headers).get('Authorization');
      if (accessToken === `Bearer ${currentAccessToken}` && currentAccessToken === 'expired-access-token') {
        return jsonResponse(401, { message: 'Expired token.' });
      }
      return jsonResponse(200, authUser);
    }
    if (requestUrl.includes('/auth/v1/token?grant_type=refresh_token')) {
      currentAccessToken = 'refreshed-access-token';
      return jsonResponse(200, {
        access_token: currentAccessToken,
        refresh_token: 'rotated-refresh-token'
      });
    }
    if (requestUrl.includes('/rest/v1/users?')) return jsonResponse(200, [adminProfile]);
    throw new Error('Unexpected mocked Supabase request.');
  };

  await withSessionRuntime(fetchMock, async ({ setNow }) => {
    const { sessionCookie } = require('../netlify/functions/_supabase');
    const initialCookie = cookiePair(await sessionCookie({
      accessToken: 'expired-access-token',
      refreshToken: 'initial-refresh-token'
    }));

    setNow(START_TIME + 10 * 24 * 60 * 60 * 1000);
    const refreshResult = await checkSession({
      httpMethod: 'GET',
      headers: { cookie: initialCookie }
    });
    assert.equal(refreshResult.statusCode, 200);
    const refreshedSetCookie = refreshResult.headers['Set-Cookie'];
    assert.match(refreshedSetCookie, /; Max-Age=1728000$/);

    const refreshedCookie = cookiePair(refreshedSetCookie);
    setNow(START_TIME + SESSION_MAX_AGE_SECONDS * 1000 + 1000);
    const expiredResult = await checkSession({
      httpMethod: 'GET',
      headers: { cookie: refreshedCookie }
    });
    assert.equal(expiredResult.statusCode, 200);
    assert.deepEqual(JSON.parse(expiredResult.body), { user: null });
    assert.match(expiredResult.headers['Set-Cookie'], /; Max-Age=0$/);
    assert.equal(fetchCalls, 4);
  });
});

test('legacy AES-GCM cookies remain readable and are upgraded with a 30-day expiry', async () => {
  const { handler: checkSession } = require('../netlify/functions/api-admin-session');
  const fetchMock = async url => {
    if (String(url).endsWith('/auth/v1/user')) return jsonResponse(200, authUser);
    if (String(url).includes('/rest/v1/users?')) return jsonResponse(200, [adminProfile]);
    throw new Error('Unexpected mocked Supabase request.');
  };

  await withSessionRuntime(fetchMock, async () => {
    const cookie = await legacyCookiePair({
      accessToken: 'legacy-access-token',
      refreshToken: 'legacy-refresh-token'
    });
    const result = await checkSession({
      httpMethod: 'GET',
      headers: { cookie }
    });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body).user.email, adminProfile.email);
    assert.match(result.headers['Set-Cookie'], new RegExp(`; Max-Age=${SESSION_MAX_AGE_SECONDS}$`));
    assert.equal(cookieValue(cookiePair(result.headers['Set-Cookie'])).split('.').length, 3);
  });
});

test('expired and tampered sessions require login and clear the unusable cookie', async () => {
  const { handler: checkSession } = require('../netlify/functions/api-admin-session');
  const { sessionCookie } = require('../netlify/functions/_supabase');
  let fetchCalls = 0;

  await withSessionRuntime(async () => {
    fetchCalls += 1;
    throw new Error('Supabase must not be called for invalid sessions.');
  }, async ({ setNow }) => {
    const validCookie = cookiePair(await sessionCookie({
      accessToken: 'valid-format-access-token',
      refreshToken: 'valid-format-refresh-token'
    }));

    setNow(START_TIME + SESSION_MAX_AGE_SECONDS * 1000 + 1000);
    const expired = await checkSession({
      httpMethod: 'GET',
      headers: { cookie: validCookie }
    });
    assert.equal(expired.statusCode, 200);
    assert.deepEqual(JSON.parse(expired.body), { user: null });
    assert.match(expired.headers['Set-Cookie'], /; Max-Age=0$/);

    const unexpiredCookie = cookiePair(await sessionCookie({
      accessToken: 'valid-format-access-token',
      refreshToken: 'valid-format-refresh-token'
    }));
    const [name, encodedValue] = unexpiredCookie.split('=');
    const token = decodeURIComponent(encodedValue);
    const last = token.at(-1) === 'A' ? 'B' : 'A';
    const invalidCookie = `${name}=${encodeURIComponent(`${token.slice(0, -1)}${last}`)}`;
    const invalid = await checkSession({
      httpMethod: 'GET',
      headers: { cookie: invalidCookie }
    });
    assert.equal(invalid.statusCode, 200);
    assert.deepEqual(JSON.parse(invalid.body), { user: null });
    assert.match(invalid.headers['Set-Cookie'], /; Max-Age=0$/);
    assert.equal(fetchCalls, 0);
  });
});

test('logout explicitly clears the admin session cookie', async () => {
  const { handler: logout } = require('../netlify/functions/api-admin-logout');
  const result = await logout({ httpMethod: 'POST' });
  assert.equal(result.statusCode, 200);
  assert.match(result.headers['Set-Cookie'], new RegExp(`^${SESSION_COOKIE_NAME}=`));
  assert.match(result.headers['Set-Cookie'], /; Path=\//);
  assert.match(result.headers['Set-Cookie'], /; HttpOnly/);
  assert.match(result.headers['Set-Cookie'], /; Secure/);
  assert.match(result.headers['Set-Cookie'], /; SameSite=Lax/);
  assert.match(result.headers['Set-Cookie'], /; Max-Age=0$/);
});

test('operational session-check failures return 503 without clearing the cookie', async () => {
  const { handler: checkSession } = require('../netlify/functions/api-admin-session');
  const { sessionCookie } = require('../netlify/functions/_supabase');
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await withSessionRuntime(async url => {
      if (String(url).endsWith('/auth/v1/user')) throw new Error('Temporary Supabase outage.');
      throw new Error('Unexpected mocked Supabase request.');
    }, async () => {
      const cookie = cookiePair(await sessionCookie({
        accessToken: 'valid-access-token',
        refreshToken: 'valid-refresh-token'
      }));
      const result = await checkSession({
        httpMethod: 'GET',
        headers: { cookie }
      });
      assert.equal(result.statusCode, 503);
      assert.deepEqual(JSON.parse(result.body), {
        error: 'Unable to check administrator session.'
      });
      assert.equal(result.headers['Set-Cookie'], undefined);
    });
  } finally {
    console.error = originalConsoleError;
  }
});
