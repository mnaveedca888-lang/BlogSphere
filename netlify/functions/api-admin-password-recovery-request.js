const { getConfig, jsonResponse, supabaseGet } = require('./_supabase');

const recoveryRedirect = `${String(process.env.URL || 'https://resplendent-lebkuchen-4a94ae.netlify.app').replace(/\/+$/, '')}/admin-full.html`;
const diagnosticFields = ['message', 'msg', 'error', 'error_description', 'error_code', 'code'];

function sanitizeDiagnostic(value) {
  return String(value)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/gi, '[REDACTED_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_TOKEN]')
    .replace(/([?&](?:access_token|refresh_token|recovery_token|token|code|key|apikey|password)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\b(access[_-]?token|refresh[_-]?token|recovery[_-]?token|token|api[_-]?key|apikey|password|secret|authorization|cookie)\b\s*["']?\s*[:=]\s*["']?[^"'&,\s}]+/gi, '$1=[REDACTED]')
    .slice(0, 400);
}

function safeErrorDetails(body) {
  let parsed;
  try { parsed = JSON.parse(body); } catch { return 'non-JSON error body omitted'; }
  if (!parsed || typeof parsed !== 'object') return 'error body omitted';
  return diagnosticFields
    .filter(key => typeof parsed[key] === 'string' || typeof parsed[key] === 'number')
    .map(key => `${key}=${sanitizeDiagnostic(parsed[key])}`)
    .join('; ') || 'no safe diagnostic fields in error body';
}

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });
  try {
    let body;
    try {
      body = event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : {};
    } catch {
      return jsonResponse(400, { error: 'Invalid JSON body.' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return jsonResponse(400, { error: 'A JSON object is required.' });
    }
    const email = String(body.email || '').trim().toLowerCase();
    const profiles = email
      ? await supabaseGet(`/rest/v1/users?select=auth_user_id,is_active&email=eq.${encodeURIComponent(email)}&limit=1`)
      : [];
    if (!profiles[0]?.auth_user_id || profiles[0].is_active !== true) return jsonResponse(200, { ok: true });

    const { url, anonKey } = getConfig();
    const endpoint = new URL('/auth/v1/recover', url);
    endpoint.searchParams.set('redirect_to', recoveryRedirect);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (!response.ok) {
      const responseBody = await response.text();
      console.error('Admin recovery request failed:', response.status, safeErrorDetails(responseBody));
      return jsonResponse(502, { error: 'Unable to send recovery email.' });
    }
    return jsonResponse(200, { ok: true });
  } catch (error) {
    console.error('Admin recovery request failed unexpectedly:', error.name || 'Error');
    return jsonResponse(500, { error: 'Unable to send recovery email.' });
  }
};