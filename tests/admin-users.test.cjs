const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { handler: adminUsers } = require('../netlify/functions/api-admin-users');
const { adminEmail, sessionCookie } = require('../netlify/functions/_supabase');

const TEST_ENV = {
  SUPABASE_URL: 'https://supabase.example',
  SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  SESSION_SECRET: 'test-session-secret-with-at-least-32-characters'
};
const actorAuthUser = { id: '11111111-1111-4111-8111-111111111111' };
const actorProfile = {
  id: 7,
  name: 'Test Admin',
  email: 'admin@example.com',
  role: 'administrator',
  auth_user_id: actorAuthUser.id,
  is_active: true,
  must_change_password: false
};
const targetProfile = {
  id: 42,
  name: 'Target User',
  email: 'target@example.com',
  role: 'editor',
  auth_user_id: '22222222-2222-4222-8222-222222222222',
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

async function withSupabase(fetchMock, run) {
  const originalFetch = global.fetch;
  const originalEnv = Object.fromEntries(
    Object.keys(TEST_ENV).map(name => [name, process.env[name]])
  );
  Object.assign(process.env, TEST_ENV);
  global.fetch = fetchMock;

  try {
    const cookie = cookiePair(await sessionCookie({
      accessToken: 'test-admin-access-token',
      refreshToken: 'test-admin-refresh-token'
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

function createSupabaseMock({
  actor = actorProfile,
  target = targetProfile,
  targetRows,
  authDeleteResponse = new Response(null, { status: 204 }),
  authDeleteError,
  authUpdateResponse = jsonResponse(200, {}),
  authUpdateError,
  profileDeleteResponse,
  profileUpdateResponse,
  profileUpdateError
} = {}) {
  const calls = [];
  const deletedProfile = target
    ? [{ id: target.id, auth_user_id: target.auth_user_id }]
    : [];
  const profileDeleteResult = profileDeleteResponse || jsonResponse(200, deletedProfile);
  const matchingTargetRows = targetRows === undefined ? (target ? [target] : []) : targetRows;

  const fetchMock = async (input, options = {}) => {
    const url = new URL(String(input));
    const method = options.method || 'GET';
    const headers = new Headers(options.headers);
    calls.push({ url, method, headers, body: options.body });

    if (url.pathname === '/auth/v1/user') {
      assert.equal(headers.get('Authorization'), 'Bearer test-admin-access-token');
      return jsonResponse(200, actorAuthUser);
    }
    if (url.pathname === '/rest/v1/users' && method === 'GET') {
      assert.equal(headers.get('Authorization'), `Bearer ${TEST_ENV.SUPABASE_SERVICE_ROLE_KEY}`);
      if (url.searchParams.has('auth_user_id')) return jsonResponse(200, actor ? [actor] : []);
      if (url.searchParams.has('id')) return jsonResponse(200, matchingTargetRows);
    }
    if (url.pathname.startsWith('/auth/v1/admin/users/') && method === 'DELETE') {
      assert.equal(headers.get('Authorization'), `Bearer ${TEST_ENV.SUPABASE_SERVICE_ROLE_KEY}`);
      if (authDeleteError) throw authDeleteError;
      return authDeleteResponse;
    }
    if (url.pathname.startsWith('/auth/v1/admin/users/') && method === 'PUT') {
      assert.equal(headers.get('Authorization'), `Bearer ${TEST_ENV.SUPABASE_SERVICE_ROLE_KEY}`);
      if (authUpdateError) throw authUpdateError;
      return authUpdateResponse;
    }
    if (url.pathname === '/rest/v1/users' && method === 'DELETE') {
      assert.equal(headers.get('Authorization'), `Bearer ${TEST_ENV.SUPABASE_SERVICE_ROLE_KEY}`);
      return profileDeleteResult;
    }
    if (url.pathname === '/rest/v1/users' && method === 'PATCH') {
      assert.equal(headers.get('Authorization'), `Bearer ${TEST_ENV.SUPABASE_SERVICE_ROLE_KEY}`);
      if (profileUpdateError) throw profileUpdateError;
      if (profileUpdateResponse) return profileUpdateResponse;
      return jsonResponse(200, [{
        ...target,
        ...JSON.parse(options.body)
      }]);
    }
    throw new Error(`Unexpected mocked request: ${method} ${url.pathname}`);
  };
  return { calls, fetchMock };
}

function deleteEvent(cookie, id = '42') {
  return {
    httpMethod: 'DELETE',
    headers: cookie ? { cookie } : {},
    queryStringParameters: { id }
  };
}

function updateEvent(cookie, id, updates, cfRay = 'a5a65f51ff3ee8c7') {
  return {
    httpMethod: 'PATCH',
    headers: cookie ? { cookie, 'cf-ray': cfRay } : {},
    queryStringParameters: { id },
    body: JSON.stringify(updates)
  };
}

async function captureConsoleError(run) {
  const entries = [];
  const originalConsoleError = console.error;
  console.error = (...args) => entries.push(args);
  try {
    return { result: await run(), entries };
  } finally {
    console.error = originalConsoleError;
  }
}

function suppressConsoleError(run) {
  return captureConsoleError(run);
}

test('the local schema cascades profile deletion after linked Auth deletion', () => {
  const schema = fs.readFileSync(
    path.resolve(__dirname, '..', 'phase1-supabase', 'schema.sql'),
    'utf8'
  );
  assert.match(schema, /auth_user_id UUID REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
});

test('deleting a linked profile uses its exact profile ID and linked Auth ID', async () => {
  const { calls, fetchMock } = createSupabaseMock();

  await withSupabase(fetchMock, async cookie => {
    const result = await adminUsers(deleteEvent(cookie, String(targetProfile.id)));
    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body), { ok: true });

    const profileLookup = calls.find(call =>
      call.method === 'GET'
      && call.url.pathname === '/rest/v1/users'
      && call.url.searchParams.has('id')
    );
    assert.equal(profileLookup.url.searchParams.get('id'), `eq.${targetProfile.id}`);

    const authDelete = calls.find(call =>
      call.method === 'DELETE' && call.url.pathname.startsWith('/auth/v1/admin/users/')
    );
    assert.equal(authDelete.url.pathname, `/auth/v1/admin/users/${targetProfile.auth_user_id}`);
    assert.equal(calls.some(call => call.method === 'DELETE' && call.url.pathname === '/rest/v1/users'), false);
  });
});

test('deactivation updates the linked Auth user before the matching profile field', async () => {
  const { calls, fetchMock } = createSupabaseMock();

  await withSupabase(fetchMock, async cookie => {
    const result = await adminUsers(updateEvent(cookie, '42', { is_active: false }));
    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body).user.is_active, false);

    const authUpdateIndex = calls.findIndex(call =>
      call.method === 'PUT' && call.url.pathname === `/auth/v1/admin/users/${targetProfile.auth_user_id}`
    );
    const profileUpdateIndex = calls.findIndex(call =>
      call.method === 'PATCH' && call.url.pathname === '/rest/v1/users'
    );
    assert.ok(authUpdateIndex >= 0);
    assert.ok(profileUpdateIndex > authUpdateIndex);
    assert.equal(calls[authUpdateIndex].method, 'PUT');
    assert.deepEqual(JSON.parse(calls[authUpdateIndex].body), { ban_duration: '876000h' });
    assert.equal(calls[authUpdateIndex].headers.get('Content-Type'), 'application/json');
    assert.equal(calls[authUpdateIndex].headers.get('apikey'), TEST_ENV.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal(calls[profileUpdateIndex].url.searchParams.get('id'), 'eq.42');
    assert.deepEqual(JSON.parse(calls[profileUpdateIndex].body), { is_active: false });
  });
});

test('reactivation removes the Auth ban before marking the profile active', async () => {
  const inactiveProfile = { ...targetProfile, is_active: false };
  const { calls, fetchMock } = createSupabaseMock({ target: inactiveProfile });

  await withSupabase(fetchMock, async cookie => {
    const result = await adminUsers(updateEvent(cookie, '42', { is_active: true }));
    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body).user.is_active, true);

    const authUpdate = calls.find(call => call.method === 'PUT');
    const profileUpdate = calls.find(call => call.method === 'PATCH');
    assert.deepEqual(JSON.parse(authUpdate.body), { ban_duration: 'none' });
    assert.deepEqual(JSON.parse(profileUpdate.body), { is_active: true });
  });
});

for (const isActive of [false, true]) {
  test(`profile without a linked Auth account can be marked ${isActive ? 'active' : 'inactive'}`, async () => {
    const orphanProfile = {
      ...targetProfile,
      auth_user_id: null,
      is_active: !isActive
    };
    const { calls, fetchMock } = createSupabaseMock({ target: orphanProfile });

    await withSupabase(fetchMock, async cookie => {
      const result = await adminUsers(updateEvent(cookie, '42', { is_active: isActive }));
      assert.equal(result.statusCode, 200);
      assert.equal(JSON.parse(result.body).user.is_active, isActive);
      assert.equal(calls.some(call =>
        call.method === 'PUT' && call.url.pathname.startsWith('/auth/v1/admin/users/')
      ), false);
      const profileUpdate = calls.find(call =>
        call.method === 'PATCH' && call.url.pathname === '/rest/v1/users'
      );
      assert.equal(profileUpdate.url.searchParams.get('id'), 'eq.42');
      assert.deepEqual(JSON.parse(profileUpdate.body), { is_active: isActive });
    });
  });
}

for (const [status, code, message] of [
  [400, 'validation_failed', 'Invalid request.'],
  [401, 'unauthorized', 'Unauthorized'],
  [403, 'permission_denied', 'Forbidden'],
  [404, 'user_not_found', 'User not found.'],
  [429, 'rate_limited', 'Too many requests'],
  [500, 'internal_error', 'Internal server error'],
  [502, 'upstream_failure', 'Unexpected failure']
]) {
  test(`Auth update HTTP ${status} is logged safely and does not change profile status`, async () => {
    const upstreamRequestId = 'c0ffee00-0000-4000-8000-000000000001';
    const authUpdateResponse = new Response(JSON.stringify({ code, message }), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'sb-request-id': upstreamRequestId
      }
    });
    const { calls, fetchMock } = createSupabaseMock({ authUpdateResponse });

    await withSupabase(fetchMock, async cookie => {
      const { result, entries } = await captureConsoleError(() =>
        adminUsers(updateEvent(cookie, '42', { is_active: false }))
      );
      assert.equal(result.statusCode, 502);
      const body = JSON.parse(result.body);
      assert.equal(body.error, 'Unable to update the authentication account. Request ID: a5a65f51ff3ee8c7');
      assert.equal(body.request_id, 'a5a65f51ff3ee8c7');
      assert.deepEqual(body.diagnostic, {
        stage: 'auth_response',
        upstream_status: status,
        upstream_request_id: upstreamRequestId,
        error_code: code,
        error_message: message.toLowerCase().replace(/[.!]$/, '')
      });
      assert.equal(calls.some(call => call.method === 'PATCH'), false);

      const log = entries.find(([label]) => label === 'Supabase Auth user update failed:')?.[1];
      assert.deepEqual(log, {
        requestId: 'a5a65f51ff3ee8c7',
        upstreamRequestId,
        upstreamStatus: status,
        errorCode: code,
        errorMessage: message.toLowerCase().replace(/[.!]$/, '')
      });
    });
  });
}

test('unrecognized Auth error messages are redacted from diagnostics', async () => {
  const authUpdateResponse = jsonResponse(400, {
    code: 'targetuser123',
    message: 'Failure for target@example.com, user 22222222-2222-4222-8222-222222222222, token eyJhbGciOi.test'
  });
  const { calls, fetchMock } = createSupabaseMock({ authUpdateResponse });

  await withSupabase(fetchMock, async cookie => {
    const { result, entries } = await captureConsoleError(() =>
      adminUsers(updateEvent(cookie, '42', { is_active: false }))
    );
    assert.equal(result.statusCode, 502);
    assert.equal(calls.some(call => call.method === 'PATCH'), false);
    const logText = JSON.stringify(entries);
    assert.doesNotMatch(logText, /targetuser123|target@example\.com|22222222-2222-4222-8222-222222222222|eyJhbGciOi/);
    assert.match(logText, /Upstream error message redacted\./);
    const body = JSON.parse(result.body);
    assert.equal(body.diagnostic.error_code, 'unknown');
    assert.doesNotMatch(JSON.stringify(body), /targetuser123|target@example\.com|22222222-2222-4222-8222-222222222222|eyJhbGciOi/);
  });
});

test('non-JSON Auth errors are redacted and do not change profile status', async () => {
  const { calls, fetchMock } = createSupabaseMock({
    authUpdateResponse: new Response('<html>failure target@example.com</html>', { status: 502 })
  });

  await withSupabase(fetchMock, async cookie => {
    const { result, entries } = await captureConsoleError(() =>
      adminUsers(updateEvent(cookie, '42', { is_active: false }))
    );
    assert.equal(result.statusCode, 502);
    assert.equal(calls.some(call => call.method === 'PATCH'), false);
    const body = JSON.parse(result.body);
    assert.equal(body.request_id, 'a5a65f51ff3ee8c7');
    assert.equal(body.diagnostic.stage, 'auth_response');
    assert.equal(body.diagnostic.upstream_status, 502);
    const logText = JSON.stringify(entries);
    assert.doesNotMatch(logText, /target@example\.com|<html>|failure/);
    assert.match(logText, /"upstreamStatus":502/);
  });
});

test('an Auth network failure returns a correlated gateway error without changing profile status', async () => {
  const { calls, fetchMock } = createSupabaseMock({
    authUpdateError: new TypeError('fetch failed for target@example.com')
  });

  await withSupabase(fetchMock, async cookie => {
    const { result, entries } = await captureConsoleError(() =>
      adminUsers(updateEvent(cookie, '42', { is_active: false }))
    );
    assert.equal(result.statusCode, 502);
    const body = JSON.parse(result.body);
    assert.equal(body.request_id, 'a5a65f51ff3ee8c7');
    assert.deepEqual(body.diagnostic, {
      stage: 'request',
      failure_type: 'transport_error',
      upstream_status: null
    });
    assert.equal(calls.some(call => call.method === 'PATCH'), false);
    const logText = JSON.stringify(entries);
    assert.match(logText, /a5a65f51ff3ee8c7/);
    assert.doesNotMatch(logText, /target@example\.com|fetch failed/);
  });
});

test('an Auth timeout returns a correlated gateway error without changing profile status', async () => {
  const { calls, fetchMock } = createSupabaseMock({
    authUpdateError: Object.assign(new Error('Request timed out for target@example.com'), {
      name: 'AbortError'
    })
  });

  await withSupabase(fetchMock, async cookie => {
    const { result, entries } = await captureConsoleError(() =>
      adminUsers(updateEvent(cookie, '42', { is_active: false }))
    );
    assert.equal(result.statusCode, 502);
    const body = JSON.parse(result.body);
    assert.equal(body.request_id, 'a5a65f51ff3ee8c7');
    assert.deepEqual(body.diagnostic, {
      stage: 'request',
      failure_type: 'timeout',
      upstream_status: null
    });
    assert.equal(calls.some(call => call.method === 'PATCH'), false);
    const logText = JSON.stringify(entries);
    assert.match(logText, /a5a65f51ff3ee8c7/);
    assert.doesNotMatch(logText, /target@example\.com|Request timed out/);
  });
});

test('an unreadable Auth response body is reported safely and does not change profile status', async () => {
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.error(new Error('body read failed for target@example.com'));
    }
  }), { status: 502 });
  const { calls, fetchMock } = createSupabaseMock({ authUpdateResponse: response });

  await withSupabase(fetchMock, async cookie => {
    const { result, entries } = await captureConsoleError(() =>
      adminUsers(updateEvent(cookie, '42', { is_active: false }))
    );
    assert.equal(result.statusCode, 502);
    assert.equal(calls.some(call => call.method === 'PATCH'), false);
    assert.deepEqual(JSON.parse(result.body).diagnostic, {
      stage: 'response_body',
      failure_type: 'response_read_error',
      upstream_status: 502
    });
    const logText = JSON.stringify(entries);
    assert.doesNotMatch(logText, /target@example\.com|body read failed/);
    assert.match(logText, /response_body/);
  });
});

test('a profile update failure after Auth success is not reported as success', async () => {
  const { calls, fetchMock } = createSupabaseMock({
    profileUpdateError: new Error('Supabase request failed with status 500.')
  });

  await withSupabase(fetchMock, async cookie => {
    const { result } = await captureConsoleError(() =>
      adminUsers(updateEvent(cookie, '42', { is_active: false }))
    );
    assert.equal(result.statusCode, 500);
    assert.deepEqual(JSON.parse(result.body), {
      error: 'Unable to complete user-management operation.'
    });
    assert.equal(calls.some(call => call.method === 'PUT'), true);
    assert.equal(calls.some(call => call.method === 'PATCH'), true);
  });
});

test('a mismatched profile ID is rejected before Auth deletion', async () => {
  const mismatchedProfile = { ...targetProfile, id: 43 };
  const { calls, fetchMock } = createSupabaseMock({
    target: mismatchedProfile,
    targetRows: [mismatchedProfile]
  });

  await withSupabase(fetchMock, async cookie => {
    const result = await adminUsers(deleteEvent(cookie, '42'));
    assert.equal(result.statusCode, 404);
    assert.deepEqual(JSON.parse(result.body), { error: 'User not found.' });
    assert.equal(calls.some(call => call.method === 'DELETE'), false);
  });
});

test('unauthenticated requests cannot delete users', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    assert.fail('Supabase must not be called for an unauthenticated request.');
  };

  try {
    const result = await adminUsers(deleteEvent(null, '42'));
    assert.equal(result.statusCode, 401);
    assert.deepEqual(JSON.parse(result.body), { error: 'Unauthorized' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('non-administrators cannot delete users', async () => {
  const editor = { ...actorProfile, role: 'editor' };
  const { calls, fetchMock } = createSupabaseMock({ actor: editor });

  await withSupabase(fetchMock, async cookie => {
    const result = await adminUsers(deleteEvent(cookie, '42'));
    assert.equal(result.statusCode, 403);
    assert.deepEqual(JSON.parse(result.body), {
      error: 'Administrator access is required to manage users.'
    });
    assert.equal(calls.some(call => call.method === 'DELETE'), false);
  });
});

test('the current administrator cannot delete their own account', async () => {
  const { calls, fetchMock } = createSupabaseMock({ target: actorProfile });

  await withSupabase(fetchMock, async cookie => {
    const result = await adminUsers(deleteEvent(cookie, String(actorProfile.id)));
    assert.equal(result.statusCode, 400);
    assert.deepEqual(JSON.parse(result.body), { error: 'You cannot delete your own account.' });
    assert.equal(calls.some(call => call.method === 'DELETE'), false);
  });
});

test('administrator account restrictions remain in effect', async () => {
  const targetAdmin = { ...targetProfile, role: 'administrator' };
  const mainAdmin = { ...targetProfile, email: adminEmail };

  for (const target of [targetAdmin, mainAdmin]) {
    const { calls, fetchMock } = createSupabaseMock({ target });
    await withSupabase(fetchMock, async cookie => {
      const result = await adminUsers(deleteEvent(cookie, String(target.id)));
      assert.equal(result.statusCode, 403);
      assert.equal(calls.some(call => call.method === 'DELETE'), false);
    });
  }
});

test('a missing profile returns 404 without attempting Auth deletion', async () => {
  const { calls, fetchMock } = createSupabaseMock({ target: null });

  await withSupabase(fetchMock, async cookie => {
    const result = await adminUsers(deleteEvent(cookie, '404'));
    assert.equal(result.statusCode, 404);
    assert.deepEqual(JSON.parse(result.body), { error: 'User not found.' });
    assert.equal(calls.some(call => call.method === 'DELETE'), false);
  });
});

test('a profile without an Auth ID is deleted only with its matching profile ID and null Auth ID', async () => {
  const orphanProfile = { ...targetProfile, auth_user_id: null };
  const { calls, fetchMock } = createSupabaseMock({ target: orphanProfile });

  await withSupabase(fetchMock, async cookie => {
    const result = await adminUsers(deleteEvent(cookie, String(orphanProfile.id)));
    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body), { ok: true });

    const profileDelete = calls.find(call =>
      call.method === 'DELETE' && call.url.pathname === '/rest/v1/users'
    );
    assert.equal(profileDelete.url.searchParams.get('id'), `eq.${orphanProfile.id}`);
    assert.equal(profileDelete.url.searchParams.get('auth_user_id'), 'is.null');
    assert.equal(profileDelete.url.searchParams.get('select'), 'id,auth_user_id');
    assert.equal(profileDelete.headers.get('Prefer'), 'return=representation');
    assert.equal(calls.some(call => call.url.pathname.startsWith('/auth/v1/admin/users/')), false);
  });
});

test('an explicitly missing Auth account falls back to deleting the matching profile', async () => {
  const { calls, fetchMock } = createSupabaseMock({
    authDeleteResponse: jsonResponse(404, { code: 'user_not_found', message: 'User not found' })
  });

  await withSupabase(fetchMock, async cookie => {
    const result = await adminUsers(deleteEvent(cookie, String(targetProfile.id)));
    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body), { ok: true });

    const profileDelete = calls.find(call =>
      call.method === 'DELETE' && call.url.pathname === '/rest/v1/users'
    );
    assert.equal(profileDelete.url.searchParams.get('id'), `eq.${targetProfile.id}`);
    assert.equal(profileDelete.url.searchParams.get('auth_user_id'), `eq.${targetProfile.auth_user_id}`);
  });
});

test('an unrelated Auth 404 does not trigger profile deletion', async () => {
  const { calls, fetchMock } = createSupabaseMock({
    authDeleteResponse: jsonResponse(404, { message: 'Not Found' })
  });

  await withSupabase(fetchMock, async cookie => {
    const result = await adminUsers(deleteEvent(cookie, String(targetProfile.id)));
    assert.equal(result.statusCode, 502);
    assert.deepEqual(JSON.parse(result.body), {
      error: 'Unable to delete the authentication account.'
    });
    assert.equal(calls.some(call => call.method === 'DELETE' && call.url.pathname === '/rest/v1/users'), false);
  });
});

for (const status of [403, 500]) {
  test(`Auth ${status} errors do not trigger profile deletion`, async () => {
    const { calls, fetchMock } = createSupabaseMock({
      authDeleteResponse: jsonResponse(status, { message: 'Auth request failed.' })
    });

    await withSupabase(fetchMock, async cookie => {
      const result = await adminUsers(deleteEvent(cookie, String(targetProfile.id)));
      assert.equal(result.statusCode, 502);
      assert.equal(JSON.parse(result.body).error, 'Unable to delete the authentication account.');
      assert.equal(calls.some(call => call.method === 'DELETE' && call.url.pathname === '/rest/v1/users'), false);
    });
  });
}

for (const [label, authDeleteError] of [
  ['network failure', new TypeError('Network request failed.')],
  ['timeout', Object.assign(new Error('Request timed out.'), { name: 'AbortError' })]
]) {
  test(`Auth ${label} does not trigger profile deletion`, async () => {
    const { calls, fetchMock } = createSupabaseMock({ authDeleteError });

    await suppressConsoleError(() => withSupabase(fetchMock, async cookie => {
      const result = await adminUsers(deleteEvent(cookie, String(targetProfile.id)));
      assert.equal(result.statusCode, 500);
      assert.deepEqual(JSON.parse(result.body), {
        error: 'Unable to complete user-management operation.'
      });
      assert.equal(calls.some(call => call.method === 'DELETE' && call.url.pathname === '/rest/v1/users'), false);
    }));
  });
}

test('profile deletion database errors are not reported as success', async () => {
  const { fetchMock } = createSupabaseMock({
    target: { ...targetProfile, auth_user_id: null },
    profileDeleteResponse: jsonResponse(500, { message: 'Database unavailable.' })
  });

  await suppressConsoleError(() => withSupabase(fetchMock, async cookie => {
    const result = await adminUsers(deleteEvent(cookie, String(targetProfile.id)));
    assert.equal(result.statusCode, 500);
    assert.deepEqual(JSON.parse(result.body), {
      error: 'Unable to complete user-management operation.'
    });
  }));
});

test('a mismatched or unconfirmed profile deletion is not reported as success', async () => {
  const { fetchMock } = createSupabaseMock({
    authDeleteResponse: jsonResponse(404, { code: 'user_not_found' }),
    profileDeleteResponse: jsonResponse(200, [{
      id: 43,
      auth_user_id: targetProfile.auth_user_id
    }])
  });

  await withSupabase(fetchMock, async cookie => {
    const result = await adminUsers(deleteEvent(cookie, String(targetProfile.id)));
    assert.equal(result.statusCode, 404);
    assert.deepEqual(JSON.parse(result.body), { error: 'User not found.' });
  });
});

test('an empty profile deletion result is not reported as success', async () => {
  const { fetchMock } = createSupabaseMock({
    target: { ...targetProfile, auth_user_id: null },
    profileDeleteResponse: jsonResponse(200, [])
  });

  await withSupabase(fetchMock, async cookie => {
    const result = await adminUsers(deleteEvent(cookie, String(targetProfile.id)));
    assert.equal(result.statusCode, 404);
    assert.deepEqual(JSON.parse(result.body), { error: 'User not found.' });
  });
});
