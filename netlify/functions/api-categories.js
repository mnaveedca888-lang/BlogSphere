const { getPublicCategories, jsonResponse } = require('./_supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed.' });
  try {
    return jsonResponse(200, await getPublicCategories());
  } catch (error) {
    console.error('Netlify categories read failed:', error.message);
    return jsonResponse(500, { error: 'Unable to load categories.' });
  }
};