const {
  getCategories,
  jsonResponse,
  parseBody,
  requireAdmin,
  responseWithHeaders,
  supabaseGet,
  supabaseRequest,
  toJson,
  sanitizeRichText
} = require('./_supabase');

function query(event) {
  return event.queryStringParameters || {};
}

async function findPost(id) {
  const rows = await supabaseGet(`/rest/v1/posts?select=*&id=eq.${encodeURIComponent(id)}`);
  return rows[0] || null;
}

function normalizeSlug(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'post';
}

async function slugExists(slug, excludeId = null) {
  const query = excludeId
    ? `/rest/v1/posts?select=id,slug&slug=eq.${encodeURIComponent(slug)}&id=not.eq.${encodeURIComponent(excludeId)}`
    : `/rest/v1/posts?select=id,slug&slug=eq.${encodeURIComponent(slug)}`;
  const rows = await supabaseGet(query);
  return Array.isArray(rows) && rows.length > 0;
}

async function resolveUniqueSlug(rawSlug, excludeId = null) {
  const baseSlug = normalizeSlug(rawSlug || `post-${Date.now()}`);
  let slug = baseSlug;
  let suffix = 1;

  while (await slugExists(slug, excludeId)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return slug;
}

function normalizePublishedAt(value, fallback = new Date().toISOString()) {
  if (value === null || value === undefined || value === '') return fallback;
  const trimmed = String(value).trim();
  if (!trimmed) return fallback;

  let parsedDate = null;
  const localMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (localMatch) {
    const [, year, month, day, hours, minutes] = localMatch;
    const localDate = new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes));
    if (!Number.isNaN(localDate.getTime())) parsedDate = localDate;
  }

  if (!parsedDate) {
    parsedDate = new Date(value);
  }

  if (!Number.isNaN(parsedDate.getTime())) {
    const normalized = new Date(parsedDate.getTime());
    const now = Date.now();
    return normalized.getTime() > now ? new Date(now).toISOString() : normalized.toISOString();
  }

  return fallback;
}

function toUtcIso(value, fallback = new Date().toISOString()) {
  if (value === null || value === undefined || value === '') return fallback;
  return normalizePublishedAt(value, fallback);
}

async function withCategoryNames(posts) {
  const categories = await getCategories();
  const names = new Map(categories.map(category => [String(category.id), category.name]));
  return posts.map(post => ({ ...post, tags: toJson(post.tags, []), category_name: names.get(String(post.category_id)) || post.category || null }));
}

async function categoryValue(categoryId, fallback) {
  if (!categoryId) return fallback || 'Technology';
  const categories = await getCategories();
  return categories.find(category => String(category.id) === String(categoryId))?.name || fallback || 'Technology';
}

async function updatePost(id, values) {
  const result = await supabaseRequest(`/rest/v1/posts?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(values)
  });
  if (!Array.isArray(result.body) || result.body.length !== 1) throw new Error('Post update affected an unexpected number of rows.');
}

async function insertPost(values) {
  const result = await supabaseRequest('/rest/v1/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(values)
  });

  if (Array.isArray(result.body) && result.body.length > 0) {
    return result.body[0];
  }

  return null;
}

exports.handler = async event => {
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(event.httpMethod)) return jsonResponse(405, { error: 'Method not allowed.' });
  try {
    const access = await requireAdmin(event);
    if (access.response) return access.response;
    const params = query(event);
    const id = params.id;
    const action = params.action;
    const setCookie = access.session.setCookie ? { 'Set-Cookie': access.session.setCookie } : {};

    if (event.httpMethod === 'GET') {
      const posts = await supabaseGet('/rest/v1/posts?select=*&order=updated_at.desc.nullslast,created_at.desc.nullslast,id.desc');
      return responseWithHeaders(200, await withCategoryNames(posts), setCookie);
    }

    if (event.httpMethod === 'POST' && action) {
      const post = await findPost(id);
      if (!post) return jsonResponse(404, { error: 'Post not found.' });
      const now = new Date().toISOString();
      if (action === 'duplicate') {
        const slug = `${post.slug}-copy-${Date.now()}`;
        await supabaseRequest('/rest/v1/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ title: `${post.title} Copy`, slug, excerpt: post.excerpt, content: post.content, featured_image: post.featured_image, category: post.category, category_id: post.category_id, tags: toJson(post.tags, []), author: post.author, status: 'draft', meta_title: post.meta_title, meta_description: post.meta_description, published_at: now })
        });
      } else if (action === 'publish') {
        await updatePost(id, { status: 'published', published_at: now, updated_at: now });
      } else if (action === 'draft') {
        await updatePost(id, { status: 'draft', updated_at: now });
      } else if (action === 'trash') {
        await updatePost(id, { status: 'trash', deleted_at: now, updated_at: now });
      } else if (action === 'restore') {
        await updatePost(id, { status: 'published', published_at: now, deleted_at: null, updated_at: now });
      } else {
        return jsonResponse(400, { error: 'Unsupported post action.' });
      }
      return responseWithHeaders(200, { ok: true }, setCookie);
    }

    if (event.httpMethod === 'POST') {
      const payload = parseBody(event);
      const title = String(payload.title || '').trim();
      if (!title) return jsonResponse(400, { error: 'Title is required.' });
      const categoryId = Number(payload.category_id || 0) || null;
      const now = new Date().toISOString();
      const status = (payload.status || 'draft').toLowerCase();
      const nextPublishedAt = status === 'published' ? toUtcIso(payload.published_at, now) : toUtcIso(payload.published_at, null);
      const uniqueSlug = await resolveUniqueSlug(payload.slug || title);
      await insertPost({
        title,
        slug: uniqueSlug,
        excerpt: payload.excerpt || '',
        content: sanitizeRichText(payload.content || ''),
        featured_image: payload.featured_image || '',
        category: await categoryValue(categoryId, payload.category),
        category_id: categoryId,
        tags: Array.isArray(payload.tags) ? payload.tags : [],
        author: payload.author || access.session.user.name || 'Admin',
        status,
        meta_title: payload.meta_title || title,
        meta_description: payload.meta_description || payload.excerpt || '',
        published_at: nextPublishedAt,
        created_at: now,
        updated_at: now
      });
      return responseWithHeaders(201, { ok: true }, setCookie);
    }

    if (!id) return jsonResponse(400, { error: 'Post id is required.' });
    const existing = await findPost(id);
    if (!existing) return jsonResponse(404, { error: 'Post not found.' });

    if (event.httpMethod === 'DELETE') {
      await supabaseRequest(`/rest/v1/posts?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return responseWithHeaders(200, { ok: true }, setCookie);
    }

    const payload = parseBody(event);
    const categoryId = Number(payload.category_id || 0) || null;
    const now = new Date().toISOString();
    const status = (payload.status ?? existing.status ?? 'draft').toLowerCase();
    const nextSlug = payload.slug ?? existing.slug ?? existing.title;
    const uniqueSlug = await resolveUniqueSlug(nextSlug, id);
    const nextPublishedAt = status === 'published'
      ? toUtcIso(payload.published_at ?? existing.published_at, now)
      : toUtcIso(payload.published_at ?? existing.published_at, existing.published_at || null);
    await updatePost(id, {
      title: payload.title ?? existing.title,
      slug: uniqueSlug,
      excerpt: payload.excerpt ?? existing.excerpt ?? '',
      content: sanitizeRichText(payload.content ?? existing.content ?? ''),
      featured_image: payload.featured_image ?? existing.featured_image ?? '',
      category: await categoryValue(categoryId, payload.category ?? existing.category),
      category_id: categoryId,
      tags: Array.isArray(payload.tags) ? payload.tags : toJson(existing.tags, []),
      author: payload.author ?? existing.author ?? 'Admin',
      status,
      meta_title: payload.meta_title ?? existing.meta_title ?? existing.title,
      meta_description: payload.meta_description ?? existing.meta_description ?? existing.excerpt ?? '',
      published_at: nextPublishedAt,
      updated_at: now,
      deleted_at: status === 'published' ? null : (payload.deleted_at ?? existing.deleted_at)
    });
    return responseWithHeaders(200, { ok: true }, setCookie);
  } catch (error) {
    const supabaseError = error.supabaseError || { message: error.message || 'Unknown error' };
    console.error('Admin posts operation failed:', JSON.stringify({
      status: error.status || null,
      code: supabaseError.code || null,
      message: supabaseError.message || null,
      details: supabaseError.details || null,
      hint: supabaseError.hint || null
    }));
    return jsonResponse(error.status === 404 ? 404 : 500, {
      error: error.status === 404 ? 'Post not found.' : 'Unable to complete post operation.',
      status: error.status || 500,
      code: supabaseError.code || null,
      message: supabaseError.message || null,
      details: supabaseError.details || null,
      hint: supabaseError.hint || null
    });
  }
};