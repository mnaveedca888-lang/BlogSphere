const { getAuthUser, getConfig, jsonResponse, supabaseGet, supabaseRequest } = require('./_supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });

  try {
    let body;
    try {
      body = event.body
        ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body)
        : {};
    } catch {
      return jsonResponse(400, { error: 'Invalid JSON body.' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return jsonResponse(400, { error: 'A JSON object is required.' });
    }
    const accessToken = String(body.access_token || '').trim();
    const password = String(body.password || '');
    if (!accessToken || password.length < 8 || password.length > 128) {
      return jsonResponse(400, { error: 'A valid recovery link and a password between 8 and 128 characters are required.' });
    }
    const authUser = await getAuthUser(accessToken);
    if (!authUser) return jsonResponse(401, { error: 'The recovery link is invalid or expired.' });
    const profiles = await supabaseGet(`/rest/v1/users?select=id,is_active&auth_user_id=eq.${encodeURIComponent(authUser.id)}&limit=1`);
    if (!profiles[0] || profiles[0].is_active !== true) return jsonResponse(401, { error: 'The recovery link is invalid or expired.' });

    const { url, anonKey } = getConfig();
    const response = await fetch(`${url}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password })
    });
    if (!response.ok) {
      return jsonResponse(response.status === 401 ? 401 : 400, {
        error: response.status === 401 ? 'The recovery link is invalid or expired.' : 'Unable to update the password.'
      });
    }
    await supabaseRequest(`/rest/v1/users?id=eq.${encodeURIComponent(profiles[0].id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ must_change_password: false })
    });
    return jsonResponse(200, { ok: true });
  } catch (error) {
    console.error('Admin password recovery update failed:', error.name || 'Error');
    return jsonResponse(500, { error: 'Unable to update the password.' });
  }
};
