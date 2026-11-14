const crypto = require('crypto');
const {
  getConfig,
  jsonResponse,
  parseBody,
  supabasePublicGet,
  supabaseGet,
  supabaseRequest
} = require('./_supabase');

function validPostId(value) {
  return /^\d+$/.test(String(value || ''));
}

function requestIp(event) {
  const headers = event.headers || {};
  return String(headers['x-nf-client-connection-ip'] || headers['X-Nf-Client-Connection-Ip'] || '').trim();
}

exports.requestIp = requestIp;

function rateLimitHash(event, postId, email) {
  const { serviceRoleKey } = getConfig();
  const secret = String(process.env.SESSION_SECRET || serviceRoleKey);
  return crypto.createHmac('sha256', secret)
    .update(`${requestIp(event)}|${postId}|${email.toLowerCase()}`)
    .digest('hex');
}

function response(status, body) {
  return jsonResponse(status, body);
}

exports.handler = async event => {
  if (!['GET', 'POST'].includes(event.httpMethod)) return response(405, { error: 'Method not allowed.' });
  try {
    const params = event.queryStringParameters || {};
    const postId = String(params.post_id || '');
    if (!validPostId(postId)) return response(400, { error: 'A valid post_id is required.' });

    if (event.httpMethod === 'GET') {
      const postRows = await supabasePublicGet(`/rest/v1/posts?select=id&id=eq.${encodeURIComponent(postId)}&status=eq.published&deleted_at=is.null&limit=1`);
      if (!postRows.length) return response(404, { error: 'Post not found.' });
      const commentRows = await supabaseGet(`/rest/v1/comments?select=id,post_id,status,name,body,reply,reply_at,created_at&post_id=eq.${encodeURIComponent(postId)}&status=eq.approved&order=created_at.asc`);
      const comments = commentRows
        .filter(comment => String(comment.post_id) === postId && comment.status === 'approved')
        .map(({ id, name, body, reply, reply_at, created_at }) => ({
          id,
          name,
          body,
          reply,
          reply_at,
          created_at
        }));
      return response(200, comments);
    }

    let payload;
    try {
      payload = parseBody(event);
    } catch {
      return response(400, { error: 'Invalid JSON body.' });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return response(400, { error: 'A JSON object is required.' });
    }
    if (String(payload.website || '').trim()) return response(201, { ok: true, message: 'Your comment is awaiting moderation.' });

    const name = String(payload.name || '').trim();
    const email = String(payload.email || '').trim().toLowerCase();
    const website = String(payload.website_url || '').trim();
    const body = String(payload.body || '').trim();
    if (!name || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !body || body.length > 5000) {
      return response(400, { error: 'Enter a name, valid email address, and comment (maximum 5,000 characters).' });
    }
    if (website.length > 500) return response(400, { error: 'Website must be 500 characters or fewer.' });
    if (website) {
      try {
        const parsed = new URL(website);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid URL.');
      } catch {
        return response(400, { error: 'Website must be a valid http or https URL.' });
      }
    }

    const postRows = await supabaseGet(`/rest/v1/posts?select=id,status,deleted_at&id=eq.${encodeURIComponent(postId)}&status=eq.published&deleted_at=is.null&limit=1`);
    if (!postRows.length) return response(404, { error: 'Post not found.' });
    const hash = rateLimitHash(event, postId, email);
    const cutoff = encodeURIComponent(new Date(Date.now() - 30000).toISOString());
    const recent = await supabaseGet(`/rest/v1/comments?select=id&rate_limit_hash=eq.${hash}&created_at=gte.${cutoff}&limit=1`);
    if (recent.length) return response(429, { error: 'Please wait before submitting another comment.' });

    await supabaseRequest('/rest/v1/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        post_id: Number(postId),
        name,
        email,
        website: website || null,
        body,
        status: 'pending',
        rate_limit_hash: hash
      })
    });
    return response(201, { ok: true, message: 'Your comment is awaiting moderation.' });
  } catch (error) {
    console.error('Public comments request failed:', error.message);
    if (error.status === 429) return response(429, { error: 'Please wait before submitting another comment.' });
    return response(500, { error: 'Unable to process comments right now.' });
  }
};
