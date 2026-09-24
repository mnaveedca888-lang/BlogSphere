const { getCategories, jsonResponse, requireAdmin, responseWithHeaders } = require('./_supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed.' });
  try {
    const access = await requireAdmin(event);
    if (access.response) return access.response;
    return responseWithHeaders(200, await getCategories(), access.session.setCookie ? { 'Set-Cookie': access.session.setCookie } : {});
  } catch (error) {
    console.error('Admin categories read failed:', error.message);
    return jsonResponse(500, { error: 'Unable to load categories.' });
  }
};