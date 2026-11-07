const { hasRole, jsonResponse, parseBody, requireAdmin, responseWithHeaders, supabaseRequest } = require('./_supabase');

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const maxBytes = 8 * 1024 * 1024;
const extensionsByType = {
  'image/jpeg': new Set(['jpg', 'jpeg']),
  'image/png': new Set(['png']),
  'image/webp': new Set(['webp']),
  'image/gif': new Set(['gif'])
};

function matchesImageSignature(bytes, contentType) {
  if (contentType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (contentType === 'image/gif') return bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
  if (contentType === 'image/webp') {
    return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });
  try {
    const access = await requireAdmin(event);
    if (access.response) return access.response;
    if (!hasRole(access.session.user, ['administrator', 'editor', 'author'])) {
      return jsonResponse(403, { error: 'Your role does not allow image uploads.' });
    }
    const body = parseBody(event);
    const originalName = String(body.filename || '').trim();
    const contentType = String(body.contentType || '').toLowerCase();
    const data = String(body.data || '');
    if (!originalName || !allowedTypes.has(contentType) || !data) return jsonResponse(400, { error: 'Valid image data is required.' });
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > maxBytes) return jsonResponse(400, { error: 'Image must be between 1 byte and 8 MB.' });
    const safeName = originalName.split(/[\\/]/).pop().replace(/[^a-zA-Z0-9._-]/g, '-');
    const extension = safeName.includes('.') ? safeName.split('.').pop().toLowerCase() : '';
    if (!matchesImageSignature(bytes, contentType) || (extension && !extensionsByType[contentType].has(extension))) {
      return jsonResponse(400, { error: 'Image data and file extension must match the selected image type.' });
    }
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