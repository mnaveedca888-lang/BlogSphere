const {
  clearSessionCookie,
  getAdminSession,
  jsonResponse,
  responseWithHeaders
} = require('./_supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed.' });
  try {
    const session = await getAdminSession(event);
    if (!session) {
      return responseWithHeaders(200, { user: null }, { 'Set-Cookie': clearSessionCookie() });
    }
    return responseWithHeaders(200, { user: session.user }, session.setCookie ? { 'Set-Cookie': session.setCookie } : {});
  } catch (error) {
    console.error('Admin session check failed:', error.message);
    return jsonResponse(503, { error: 'Unable to check administrator session.' });
  }
};