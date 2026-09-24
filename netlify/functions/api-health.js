const { jsonResponse } = require('./_supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed.' });
  return jsonResponse(200, { ok: true });
};