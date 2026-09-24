const { authRequest, getAdminProfile, jsonResponse, publicAdminUser, sessionCookie } = require('./_supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });
  try {
    const body = event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : {};
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email || !password) return jsonResponse(400, { error: 'Email and password required.' });
    const result = await authRequest('password', { email, password });
    if (!result.response.ok || !result.data.access_token || !result.data.user) return jsonResponse(401, { error: 'Invalid credentials.' });
    const profile = await getAdminProfile(result.data.user.id);
    if (!profile) return jsonResponse(403, { error: 'Administrator access required.' });
    return {
      ...jsonResponse(200, { user: publicAdminUser(profile) }),
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie({ accessToken: result.data.access_token, refreshToken: result.data.refresh_token }) }
    };
  } catch (error) {
    console.error('Admin login failed:', error.message);
    return jsonResponse(500, { error: 'Unable to sign in.' });
  }
};