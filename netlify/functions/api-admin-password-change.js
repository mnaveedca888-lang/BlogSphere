const {
  getConfig,
  getAdminSession,
  jsonResponse,
  responseWithHeaders,
  supabaseRequest
} = require('./_supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });
  try {
    let payload;
    try {
      payload = event.body
        ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body)
        : {};
    } catch {
      return jsonResponse(400, { error: 'Invalid JSON body.' });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return jsonResponse(400, { error: 'A JSON object is required.' });
    }

    const access = await getAdminSession(event);
    if (!access) return jsonResponse(401, { error: 'Unauthorized.' });
    if (!access.user.must_change_password) return jsonResponse(400, { error: 'A temporary password change is not required.' });
    const password = String(payload.password || '');
    if (password.length < 12 || password.length > 128) {
      return jsonResponse(400, { error: 'Use a password between 12 and 128 characters.' });
    }

    const { url, anonKey } = getConfig();
    const updated = await fetch(`${url}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${access.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password })
    });
    if (!updated.ok) return jsonResponse(400, { error: 'Unable to update the password.' });

    await supabaseRequest(`/rest/v1/users?id=eq.${encodeURIComponent(access.profile.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ must_change_password: false })
    });
    const sessionCookie = access.setCookie ? { 'Set-Cookie': access.setCookie } : {};
    return responseWithHeaders(200, { ok: true }, sessionCookie);
  } catch (error) {
    console.error('Temporary password change failed:', error.message);
    return jsonResponse(500, { error: 'Unable to update the password.' });
  }
};
