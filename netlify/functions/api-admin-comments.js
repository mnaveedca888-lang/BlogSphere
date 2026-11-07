const {
  hasRole,
  jsonResponse,
  parseBody,
  requireAdmin,
  responseWithHeaders,
  supabaseGet,
  supabaseRequest
} = require('./_supabase');

const commentStatuses = new Set(['pending', 'approved', 'rejected']);

function response(status, body, session) {
  return responseWithHeaders(status, body, session?.setCookie ? { 'Set-Cookie': session.setCookie } : {});
}

async function findComment(id) {
  const rows = await supabaseGet(`/rest/v1/comments?select=id,post_id,author_user_id,name,email,website,body,status,reply,reply_at,created_at,updated_at,edited_at&id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows[0] || null;
}

async function canManageComment(user, comment) {
  if (['administrator', 'editor'].includes(user.role)) return true;
  if (user.role !== 'author') return false;
  const posts = await supabaseGet(`/rest/v1/posts?select=id&author_user_id=eq.${encodeURIComponent(user.id)}&id=eq.${encodeURIComponent(comment.post_id)}&limit=1`);
  return posts.length > 0;
}

exports.handler = async event => {
  if (!['GET', 'PATCH', 'DELETE'].includes(event.httpMethod)) return jsonResponse(405, { error: 'Method not allowed.' });
  try {
    const access = await requireAdmin(event);
    if (access.response) return access.response;
    const user = access.session.user;
    if (!hasRole(user, ['administrator', 'editor', 'author'])) {
      return response(403, { error: 'Your role does not allow comment moderation.' }, access.session);
    }

    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const status = String(params.status || 'all');
      if (status !== 'all' && !commentStatuses.has(status)) {
        return response(400, { error: 'Unsupported comment status.' }, access.session);
      }
      let postFilter = '';
      if (user.role === 'author') {
        const ownedPosts = await supabaseGet(`/rest/v1/posts?select=id&author_user_id=eq.${encodeURIComponent(user.id)}`);
        const ids = ownedPosts.map(post => String(post.id)).filter(id => /^\d+$/.test(id));
        if (!ids.length) return response(200, [], access.session);
        postFilter = `&post_id=in.(${ids.join(',')})`;
      }
      const statusFilter = status === 'all' ? '' : `&status=eq.${encodeURIComponent(status)}`;
      const comments = await supabaseGet(`/rest/v1/comments?select=id,post_id,author_user_id,name,email,website,body,status,reply,reply_at,created_at,updated_at,edited_at&order=created_at.desc${statusFilter}${postFilter}`);
      const postIds = [...new Set(comments.map(comment => String(comment.post_id)))].filter(id => /^\d+$/.test(id));
      const postRows = postIds.length
        ? await supabaseGet(`/rest/v1/posts?select=id,title,slug&id=in.(${postIds.join(',')})`)
        : [];
      const postsById = new Map(postRows.map(post => [String(post.id), post]));
      return response(200, comments.map(comment => ({
        ...comment,
        post_title: postsById.get(String(comment.post_id))?.title || '(Deleted post)',
        post_slug: postsById.get(String(comment.post_id))?.slug || ''
      })), access.session);
    }

    const id = String((event.queryStringParameters || {}).id || '');
    if (!/^\d+$/.test(id)) return response(400, { error: 'A valid comment id is required.' }, access.session);
    const comment = await findComment(id);
    if (!comment) return response(404, { error: 'Comment not found.' }, access.session);
    if (!await canManageComment(user, comment)) {
      return response(403, { error: 'You may only manage comments on your own posts.' }, access.session);
    }

    if (event.httpMethod === 'DELETE') {
      await supabaseRequest(`/rest/v1/comments?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' }
      });
      return response(200, { ok: true }, access.session);
    }

    let payload;
    try {
      payload = parseBody(event);
    } catch {
      return response(400, { error: 'Invalid JSON body.' }, access.session);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return response(400, { error: 'A JSON object is required.' }, access.session);
    }
    const updates = { updated_at: new Date().toISOString(), moderator_user_id: user.id };
    if (payload.status !== undefined) {
      const status = String(payload.status);
      if (!commentStatuses.has(status)) return response(400, { error: 'Unsupported comment status.' }, access.session);
      updates.status = status;
    }
    if (payload.body !== undefined) {
      const body = String(payload.body).trim();
      if (!body || body.length > 5000) return response(400, { error: 'Comment text must be between 1 and 5,000 characters.' }, access.session);
      updates.body = body;
      updates.edited_at = new Date().toISOString();
    }
    if (payload.name !== undefined) {
      const name = String(payload.name).trim();
      if (!name || name.length > 120) return response(400, { error: 'Name must be between 1 and 120 characters.' }, access.session);
      updates.name = name;
    }
    if (payload.reply !== undefined) {
      const reply = String(payload.reply).trim();
      if (reply.length > 5000) return response(400, { error: 'Reply must be 5,000 characters or fewer.' }, access.session);
      updates.reply = reply || null;
      updates.reply_at = reply ? new Date().toISOString() : null;
    }
    if (Object.keys(updates).length === 2) {
      return response(400, { error: 'No comment changes were provided.' }, access.session);
    }
    const saved = await supabaseRequest(`/rest/v1/comments?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(updates)
    });
    if (!Array.isArray(saved.body) || saved.body.length !== 1) return response(404, { error: 'Comment not found.' }, access.session);
    return response(200, { ok: true }, access.session);
  } catch (error) {
    console.error('Admin comments operation failed:', error.message);
    return jsonResponse(500, { error: 'Unable to complete comment operation.' });
  }
};
