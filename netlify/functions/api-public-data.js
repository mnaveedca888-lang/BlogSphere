const { getPublicData, getPublicPost, jsonResponse, responseWithHeaders } = require('./_supabase');

// Short public cache: lists stay fresh within a minute of publishing, and the
// Netlify edge cache absorbs repeat hits instead of hitting Supabase each time.
const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=60, s-maxage=300' };

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed.' });
  try {
    const params = event.queryStringParameters || {};
    const lookup = String(params.id || params.slug || '').trim();
    if (lookup) {
      const post = await getPublicPost(lookup);
      if (!post) return jsonResponse(404, { error: 'Post not found.' });
      return responseWithHeaders(200, { post }, CACHE_HEADERS);
    }
    const lite = params.lite === '1' || params.lite === 'true';
    return responseWithHeaders(200, await getPublicData({ lite }), CACHE_HEADERS);
  } catch (error) {
    console.error('Netlify public data read failed:', error.message);
    return jsonResponse(500, { error: 'Unable to load public data.' });
  }
};
