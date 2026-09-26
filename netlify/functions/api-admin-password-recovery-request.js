const { adminEmail, getConfig, jsonResponse } = require('./_supabase');

const recoveryRedirect = 'https://blogggsphere.netlify.app';

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });
  try {
    const body = event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : {};
    const email = String(body.email || '').trim().toLowerCase();
    if (email !== adminEmail) return jsonResponse(200, { ok: true });

    const { url, anonKey } = getConfig();
    const endpoint = new URL('/auth/v1/recover', url);
    endpoint.searchParams.set('redirect_to', recoveryRedirect);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (!response.ok) {
      console.error('Admin recovery request failed with status:', response.status);
      return jsonResponse(502, { error: 'Unable to send recovery email.' });
    }
    return jsonResponse(200, { ok: true });
  } catch (error) {
    console.error('Admin recovery request failed:', error.message);
    return jsonResponse(500, { error: 'Unable to send recovery email.' });
  }
};