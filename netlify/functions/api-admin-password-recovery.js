const { getAdminProfile, getAuthUser, getConfig, jsonResponse } = require('./_supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });
  try {
    const body = event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : {};
    const accessToken = String(body.accessToken || '');
    const password = String(body.password || '');
    if (!accessToken || !password) return jsonResponse(400, { error: 'Recovery session and new password are required.' });

    const user = await getAuthUser(accessToken);
    if (!user) return jsonResponse(401, { error: 'This recovery link is invalid or expired.' });
    const profile = await getAdminProfile(user.id);
    if (!profile) return jsonResponse(403, { error: 'Administrator access required.' });

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
    if (!response.ok) return jsonResponse(400, { error: 'Unable to update password. Request a new recovery email.' });
    return jsonResponse(200, { ok: true });
  } catch (error) {
    console.error('Admin password recovery failed:', error.message);
    return jsonResponse(500, { error: 'Unable to update password.' });
  }
};