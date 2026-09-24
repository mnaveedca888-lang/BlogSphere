const { jsonResponse, parseBody, requireAdmin, responseWithHeaders, supabaseRequest } = require('./_supabase');

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const maxBytes = 8 * 1024 * 1024;

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });
  try {
    const access = await requireAdmin(event);
    if (access.response) return access.response;
    const body = parseBody(event);
    const originalName = String(body.filename || '').trim();
    const contentType = String(body.contentType || '').toLowerCase();
    const data = String(body.data || '');
    if (!originalName || !allowedTypes.has(contentType) || !data) return jsonResponse(400, { error: 'Valid image data is required.' });
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > maxBytes) return jsonResponse(400, { error: 'Image must be between 1 byte and 8 MB.' });
    const safeName = originalName.split(/[\\/]/).pop().replace(/[^a-zA-Z0-9._-]/g, '-');
    const objectName = `${Date.now()}-${safeName}`;
    await supabaseRequest(`/storage/v1/object/blog-images/${encodeURIComponent(objectName)}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'x-upsert': 'false', 'cache-control': '3600' },
      body: bytes
    });
    const { url } = require('./_supabase').getConfig();
    const publicUrl = `${url}/storage/v1/object/public/blog-images/${encodeURIComponent(objectName)}`;
    return responseWithHeaders(201, { url: publicUrl, filename: originalName }, access.session.setCookie ? { 'Set-Cookie': access.session.setCookie } : {});
  } catch (error) {
    console.error('Admin upload failed:', error.message);
    return jsonResponse(error.status === 409 ? 409 : 500, { error: error.status === 409 ? 'Image already exists.' : 'Upload failed.' });
  }
};