const crypto = require('crypto');

const allowedTags = new Set(['a', 'b', 'blockquote', 'br', 'div', 'em', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'li', 'ol', 'p', 's', 'span', 'strike', 'strong', 'u', 'ul']);
const sessionCookieName = 'blogsphere_admin_session';
const sessionMaxAge = 60 * 60 * 24 * 7;
const adminEmail = 'mnaveedca888@gmail.com';

function getConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !anonKey || !serviceRoleKey) throw new Error('Supabase server configuration is missing.');
  return { url, anonKey, serviceRoleKey };
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

async function supabaseRequest(path, options = {}) {
  const { url, serviceRoleKey } = getConfig();
  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const error = new Error(`Supabase request failed with status ${response.status}.`);
    error.status = response.status;
    error.supabaseError = body && typeof body === 'object'
      ? { code: body.code || null, message: body.message || null, details: body.details || null, hint: body.hint || null }
      : { code: null, message: text || null, details: null, hint: null };
    throw error;
  }
  return { response, body };
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

function responseWithHeaders(statusCode, body, headers = {}) {
  const response = jsonResponse(statusCode, body);
  response.headers = { ...response.headers, ...headers };
  return response;
}

async function authRequest(grantType, body) {
  const { url, anonKey } = getConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=${grantType}`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function getAuthUser(accessToken) {
  const { url, anonKey } = getConfig();
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) return null;
  return response.json();
}

async function getAdminProfile(authUserId) {
  const rows = await supabaseGet(`/rest/v1/users?select=id,name,email,role,auth_user_id,is_active,must_change_password&auth_user_id=eq.${encodeURIComponent(authUserId)}`);
  const profile = rows[0];
  if (!profile || profile.is_active !== true) return null;
  return profile;
}

function sessionKey() {
  const secret = String(process.env.SESSION_SECRET || '').trim();
  if (secret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');
  return crypto.createHash('sha256').update(secret).digest();
}

function encodeSession(session) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}

function decodeSession(value) {
  try {
    const [ivValue, tagValue, encryptedValue] = String(value || '').split('.');
    if (!ivValue || !tagValue || !encryptedValue) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey(), Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8'));
  } catch {
    return null;
  }
}

function readCookie(event, name) {
  const cookieHeader = event.headers?.cookie || event.headers?.Cookie || '';
  const item = cookieHeader.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

function sessionCookie(session) {
  return `${sessionCookieName}=${encodeURIComponent(encodeSession(session))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${sessionMaxAge}`;
}

function clearSessionCookie() {
  return `${sessionCookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function publicAdminUser(profile) {
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    role: profile.role,
    is_active: profile.is_active,
    must_change_password: profile.must_change_password === true,
    is_main_admin: profile.email?.toLowerCase() === adminEmail
  };
}

async function getAdminSession(event) {
  const session = decodeSession(readCookie(event, sessionCookieName));
  if (!session?.accessToken) return null;
  let authUser = await getAuthUser(session.accessToken);
  let refreshed = null;
  if (!authUser && session.refreshToken) {
    const result = await authRequest('refresh_token', { refresh_token: session.refreshToken });
    if (result.response.ok) {
      refreshed = result.data;
      authUser = await getAuthUser(refreshed.access_token);
    }
  }
  if (!authUser) return null;
  const profile = await getAdminProfile(authUser.id);
  if (!profile) return null;
  return {
    user: publicAdminUser(profile),
    profile,
    accessToken: refreshed?.access_token || session.accessToken,
    setCookie: refreshed ? sessionCookie({ accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token || session.refreshToken }) : null
  };
}

async function requireAdmin(event) {
  const session = await getAdminSession(event);
  if (!session) return { response: jsonResponse(401, { error: 'Unauthorized' }) };
  if (session.user.must_change_password) {
    return { response: jsonResponse(403, { error: 'Change your temporary password before continuing.', code: 'PASSWORD_CHANGE_REQUIRED' }) };
  }
  return { session };
}

function isMainAdmin(user) {
  return user?.email?.toLowerCase() === adminEmail;
}

function hasRole(user, roles) {
  return roles.includes(user?.role);
}

function parseBody(event) {
  if (!event.body) return {};
  return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body);
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
  adminEmail,
  authRequest,
  clearSessionCookie,
  getConfig,
  getAdminProfile,
  getAdminSession,
  getAuthUser,
  getCategories,
  getPublishedPosts,
  getPublicData,
  hasRole,
  isMainAdmin,
  jsonResponse,
  mapPublicPost,
  parseBody,
  publicAdminUser,
  requireAdmin,
  responseWithHeaders,
  sessionCookie,
  supabaseGet,
  supabaseRequest,
  toJson,
  sanitizeRichText
};