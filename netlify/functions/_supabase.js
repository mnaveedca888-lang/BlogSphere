const allowedTags = new Set(['a', 'b', 'blockquote', 'br', 'div', 'em', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'li', 'ol', 'p', 's', 'span', 'strike', 'strong', 'u', 'ul']);

function getConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceRoleKey) throw new Error('Supabase server configuration is missing.');
  return { url, serviceRoleKey };
}

async function supabaseGet(path) {
  const { url, serviceRoleKey } = getConfig();
  const response = await fetch(`${url}${path}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`
    }
  });
  if (!response.ok) throw new Error(`Supabase request failed with status ${response.status}.`);
  return response.json();
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

function toJson(value, fallback = []) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || 'null');
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function sanitizeRichText(value = '') {
  const html = String(value)
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|svg|math)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|svg|math)\b[^>]*\/?>/gi, '');

  return html.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (full, tagName, rawAttrs) => {
    const tag = tagName.toLowerCase();
    if (!allowedTags.has(tag)) return '';
    if (full.startsWith('</')) return `</${tag}>`;
    const attrs = [];
    rawAttrs.replace(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gi, (_, name, quote, rawValue) => {
      const attr = name.toLowerCase();
      if (!['class', 'color', 'href', 'rel', 'src', 'style', 'target', 'alt'].includes(attr)) return '';
      if (attr === 'href' || attr === 'src') {
        const safeUrl = rawValue.trim();
        if (!/^(https?:\/\/|\/)/i.test(safeUrl)) return '';
        attrs.push(`${attr}="${safeUrl.replace(/"/g, '&quot;')}"`);
        return '';
      }
      if (attr === 'style') {
        const safeStyle = rawValue.split(';').map(rule => rule.trim()).filter(rule => /^(text-align|color|background-color|font-weight|font-style|text-decoration(?:-line)?)\s*:\s*[#\w(),.% -]+$/i.test(rule)).join('; ');
        if (safeStyle) attrs.push(`style="${safeStyle.replace(/"/g, '&quot;')}"`);
        return '';
      }
      if (attr === 'color' && !/^#[0-9a-f]{3,8}$/i.test(rawValue.trim())) return '';
      attrs.push(`${attr}="${rawValue.replace(/"/g, '&quot;')}"`);
      return '';
    });
    return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`;
  });
}

function mapPublicPost(post, categoriesById) {
  const categoryName = categoriesById.get(String(post.category_id)) || post.category || 'Technology';
  const publishedAt = post.published_at || post.created_at;
  const image = post.featured_image || 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1200&q=80';
  return {
    id: String(post.id),
    slug: post.slug || String(post.title || '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''),
    title: post.title,
    category: categoryName,
    category_id: post.category_id,
    category_name: categoryName,
    date: publishedAt,
    readTime: '5 min read',
    summary: post.excerpt || '',
    excerpt: post.excerpt || '',
    image,
    thumb: post.featured_image || 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=900&q=80',
    tags: toJson(post.tags, []),
    content: sanitizeRichText(post.content || ''),
    author: post.author || 'Admin',
    status: post.status,
    meta_title: post.meta_title || post.title,
    meta_description: post.meta_description || post.excerpt,
    published_at: publishedAt,
    created_at: post.created_at,
    updated_at: post.updated_at
  };
}

async function getCategories() {
  return supabaseGet('/rest/v1/categories?select=*&order=name.asc');
}

async function getPublishedPosts() {
  return supabaseGet('/rest/v1/posts?select=*&status=eq.published&deleted_at=is.null&order=published_at.desc.nullslast,created_at.desc.nullslast,id.desc');
}

async function getPublicData() {
  const [categories, posts] = await Promise.all([getCategories(), getPublishedPosts()]);
  const categoriesById = new Map(categories.map(category => [String(category.id), category.name]));
  return { posts: posts.map(post => mapPublicPost(post, categoriesById)), categories };
}

module.exports = {
  getCategories,
  getPublishedPosts,
  getPublicData,
  jsonResponse,
  mapPublicPost
};