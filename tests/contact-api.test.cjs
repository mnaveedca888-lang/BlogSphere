const assert = require('node:assert/strict');
const test = require('node:test');

const RESEND_URL = 'https://api.resend.com/emails';
const API_KEY = 'mock-resend-api-key';
const contactPayload = {
  name: 'Test Visitor',
  email: 'visitor@example.com',
  subject: 'Contact question',
  queryType: 'General inquiry',
  article: 'Example article',
  message: 'A mock contact message.'
};

function requestWith(payload = contactPayload) {
  return new Request('https://blogsphere.info/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

function validEnv(overrides = {}) {
  return {
    BLOGSPHERE_READ_ONLY: 'false',
    RESEND_API_KEY: API_KEY,
    CONTACT_FROM: 'admin@blogsphere.info',
    CONTACT_RECIPIENT: 'admin@blogsphere.info',
    ...overrides
  };
}

test('contact handler sends the existing message through Resend and preserves success response', async () => {
  const { onRequest } = await import('../functions/api/contact.js');
  const originalFetch = global.fetch;
  let fetchUrl;
  let fetchOptions;

  global.fetch = async (url, options) => {
    fetchUrl = String(url);
    fetchOptions = options;
    return new Response(JSON.stringify({ id: 'mock-email-id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const response = await onRequest({ request: requestWith(), env: validEnv() });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      message: 'Your message has been sent successfully.'
    });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(fetchUrl, RESEND_URL);
    assert.equal(fetchOptions.method, 'POST');

    const headers = new Headers(fetchOptions.headers);
    assert.equal(headers.get('authorization'), `Bearer ${API_KEY}`);
    assert.equal(headers.get('content-type'), 'application/json');
    assert.equal(headers.get('user-agent'), 'BlogSphere/1.0');

    const email = JSON.parse(fetchOptions.body);
    assert.equal(email.from, 'admin@blogsphere.info');
    assert.deepEqual(email.to, ['admin@blogsphere.info']);
    assert.equal(email.reply_to, 'visitor@example.com');
    assert.equal(email.subject, '[BlogSphere Contact: General inquiry] Contact question');
    assert.match(email.text, /Visitor name: Test Visitor/);
    assert.match(email.text, /Message:\nA mock contact message\./);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Resend API failures preserve the generic contact error response without logging the API key', async () => {
  const { onRequest } = await import('../functions/api/contact.js');
  const originalFetch = global.fetch;
  const originalConsoleError = console.error;
  const loggedErrors = [];

  global.fetch = async url => {
    assert.equal(String(url), RESEND_URL);
    return new Response(JSON.stringify({ message: 'Invalid API key.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  console.error = (...args) => loggedErrors.push(args.join(' '));

  try {
    const response = await onRequest({ request: requestWith(), env: validEnv() });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      ok: false,
      message: 'Unable to send your message.'
    });
    assert.deepEqual(loggedErrors, [
      'Contact email delivery failed: Resend API request failed with HTTP 401.'
    ]);
    assert.equal(loggedErrors.join('\n').includes(API_KEY), false);
  } finally {
    global.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test('missing Resend configuration fails closed without calling the API', async () => {
  const { onRequest } = await import('../functions/api/contact.js');
  const originalFetch = global.fetch;
  const originalConsoleError = console.error;
  global.fetch = async () => {
    throw new Error('Fetch must not be called without Resend configuration.');
  };
  console.error = () => {};

  try {
    const response = await onRequest({
      request: requestWith(),
      env: validEnv({ RESEND_API_KEY: '' })
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      message: 'Unable to send your message.'
    });
  } finally {
    global.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test('invalid contact requests return 400 without calling Resend', async () => {
  const { onRequest } = await import('../functions/api/contact.js');
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('Fetch must not be called for invalid contact requests.');
  };

  try {
    const missingFieldsResponse = await onRequest({
      request: requestWith({ ...contactPayload, message: '' }),
      env: validEnv()
    });
    assert.equal(missingFieldsResponse.status, 400);
    assert.deepEqual(await missingFieldsResponse.json(), {
      ok: false,
      message: 'Name, email, subject, and message are required.'
    });

    const invalidEmailResponse = await onRequest({
      request: requestWith({ ...contactPayload, email: 'not-an-email' }),
      env: validEnv()
    });
    assert.equal(invalidEmailResponse.status, 400);
    assert.deepEqual(await invalidEmailResponse.json(), {
      ok: false,
      message: 'Please provide valid contact information.'
    });
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});
