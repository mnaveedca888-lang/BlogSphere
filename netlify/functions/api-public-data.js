const { getPublicData, jsonResponse } = require('./_supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed.' });
  try {
    return jsonResponse(200, await getPublicData());
  } catch (error) {
    console.error('Netlify public data read failed:', error.message);
    return jsonResponse(500, { error: 'Unable to load public data.' });
  }
};