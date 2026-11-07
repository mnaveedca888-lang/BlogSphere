const {
  getCategories,
  hasRole,
  jsonResponse,
  parseBody,
  requireAdmin,
  responseWithHeaders,
  supabaseGet,
  supabaseRequest
} = require('./_supabase');

function query(event) {
  return event.queryStringParameters || {};
}

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || `category-${Date.now()}`;
}

async function findCategory(id) {
  const rows = await supabaseGet(`/rest/v1/categories?select=id,name,slug,description&id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows[0] || null;
}

async function slugExists(slug, excludeId) {
  let path = `/rest/v1/categories?select=id&slug=eq.${encodeURIComponent(slug)}`;
  if (excludeId) path += `&id=not.eq.${encodeURIComponent(excludeId)}`;
  return (await supabaseGet(path)).length > 0;
}

async function uniqueSlug(name, excludeId) {
  const base = normalizeSlug(name);
  let candidate = base;
  let suffix = 1;
  while (await slugExists(candidate, excludeId)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function response(status, body, headers) {
  return responseWithHeaders(status, body, headers);
}

exports.handler = async event => {
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(event.httpMethod)) {
    return jsonResponse(405, { error: 'Method not allowed.' });
  }

  try {
    const access = await requireAdmin(event);
    if (access.response) return access.response;
    const headers = access.session.setCookie ? { 'Set-Cookie': access.session.setCookie } : {};
    const id = query(event).id;

    if (event.httpMethod === 'GET') {
      return response(200, await getCategories(), headers);
    }
    if (!hasRole(access.session.user, ['administrator', 'editor'])) {
      return response(403, { error: 'Your role does not allow category changes.' }, headers);
    }

    if (event.httpMethod === 'POST' && id) {
      return response(400, { error: 'Category id is not allowed when creating a category.' }, headers);
    }

    if (event.httpMethod === 'POST' || event.httpMethod === 'PUT') {
      if (event.httpMethod === 'PUT' && (!id || !/^\d+$/.test(String(id)))) {
        return response(400, { error: 'A valid category id is required.' }, headers);
      }
      let payload;
      try {
        payload = parseBody(event);
      } catch {
        return response(400, { error: 'Invalid JSON body.' }, headers);
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return response(400, { error: 'A JSON object is required.' }, headers);
      }
      const name = String(payload.name || '').trim();
      const description = String(payload.description || '').trim();
      if (!name || name.length > 120 || description.length > 500) {
        return response(400, { error: 'Category name is required (maximum 120 characters); description must be 500 characters or fewer.' }, headers);
      }

      const current = event.httpMethod === 'PUT' ? await findCategory(id) : null;
      if (event.httpMethod === 'PUT' && !current) {
        return response(404, { error: 'Category not found.' }, headers);
      }
      const slug = await uniqueSlug(name, id);
      const values = { name, slug, description };
      if (event.httpMethod === 'POST') {
        await supabaseRequest('/rest/v1/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify(values)
        });
        return response(201, { ok: true }, headers);
      }

      const result = await supabaseRequest(`/rest/v1/categories?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(values)
      });
      if (!Array.isArray(result.body) || result.body.length !== 1) {
        return response(404, { error: 'Category not found.' }, headers);
      }
      return response(200, { ok: true }, headers);
    }

    if (!id || !/^\d+$/.test(String(id))) {
      return response(400, { error: 'A valid category id is required.' }, headers);
    }
    const current = await findCategory(id);
    if (!current) return response(404, { error: 'Category not found.' }, headers);
    const posts = await supabaseGet(`/rest/v1/posts?select=id&category_id=eq.${encodeURIComponent(id)}&limit=1`);
    if (posts.length) {
      return response(409, { error: 'Category is assigned to posts and cannot be deleted.' }, headers);
    }
    await supabaseRequest(`/rest/v1/categories?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' }
    });
    return response(200, { ok: true }, headers);
  } catch (error) {
    console.error('Admin categories operation failed:', error.message);
    if (error.status === 409) return jsonResponse(409, { error: 'A category with this name or slug already exists.' });
    return jsonResponse(500, { error: 'Unable to complete category operation.' });
  }
};
