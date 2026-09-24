const { clearSessionCookie, jsonResponse, responseWithHeaders } = require('./_supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });
  return responseWithHeaders(200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
};