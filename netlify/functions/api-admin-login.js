const { authRequest, getAdminProfile, jsonResponse, publicAdminUser, sessionCookie } = require('./_supabase');

const safeDiagnosticErrorNames = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError']);

function diagnosticErrorDetails(error) {
  const errorName = error instanceof Error && safeDiagnosticErrorNames.has(error.name)
    ? error.name
    : 'Error';
  const message = error instanceof Error ? error.message : '';
  const safeMessages = new Set([
    'SESSION_SECRET must contain at least 32 characters.',
    'Invalid key length',
    'Invalid initialization vector',
    'Invalid authentication tag length',
    'Unsupported state or unable to authenticate data',
    'Unknown encoding: base64url',
    'Supabase server configuration is missing.'
  ]);
  const safeMessage = safeMessages.has(message) || /^Supabase request failed with status \d{3}\.$/.test(message)
    ? message
    : 'Error message suppressed';
  return { errorName, errorMessage: safeMessage };
}

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });
  let operation = 'request parsing';
  try {
    const body = event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : {};
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email || !password) return jsonResponse(400, { error: 'Email and password required.' });
    operation = 'Supabase Auth';
    const result = await authRequest('password', { email, password });
    if (!result.response.ok || !result.data.access_token || !result.data.user) return jsonResponse(401, { error: 'Invalid credentials.' });
    operation = 'admin profile lookup';
    const profile = await getAdminProfile(result.data.user.id);
    if (!profile) return jsonResponse(403, { error: 'Administrator access required.' });
    operation = 'login response construction';
    const response = jsonResponse(200, { user: publicAdminUser(profile) });
    operation = 'session-cookie creation';
    const cookie = await sessionCookie({ accessToken: result.data.access_token, refreshToken: result.data.refresh_token });
    response.headers = { 'Content-Type': 'application/json', 'Set-Cookie': cookie };
    return response;
  } catch (error) {
    console.error('Admin login diagnostic:', {
      operation,
      ...diagnosticErrorDetails(error)
    });
    return jsonResponse(500, { error: 'Unable to sign in.' });
  }
};