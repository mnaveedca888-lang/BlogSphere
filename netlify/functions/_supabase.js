const crypto = require('crypto');

const allowedTags = new Set(['a', 'b', 'blockquote', 'br', 'caption', 'col', 'colgroup', 'div', 'em', 'figcaption', 'figure', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 's', 'span', 'strike', 'strong', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul']);
const sessionCookieName = 'blogsphere_admin_session';
const sessionMaxAge = 60 * 60 * 24 * 30;
const sessionAuthTagLength = 16;
const adminEmail = 'mnaveedca888@gmail.com';
const safeDiagnosticErrorNames = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'OperationError', 'DataError', 'InvalidAccessError', 'NotSupportedError']);
const safeSessionErrorMessages = new Map([
  ['SESSION_SECRET must contain at least 32 characters.', 'Session secret validation failed.'],
  ['Invalid key length', 'Cipher key length was rejected.'],
  ['Invalid initialization vector', 'Cipher initialization vector was rejected.'],
  ['Invalid authentication tag length', 'Cipher authentication tag length was rejected.'],
  ['Unsupported state or unable to authenticate data', 'Authenticated encryption finalization failed.'],
  ['Unknown encoding: base64url', 'Base64url encoding is unsupported.']
]);

function getConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !anonKey || !serviceRoleKey) throw new Error('Supabase server configuration is missing.');
  return { url, anonKey, serviceRoleKey };
}

function getPublicConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  if (!url || !anonKey) throw new Error('Supabase public-read configuration is missing.');
  return { url, anonKey };
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

async function supabasePublicGet(path) {
  const { url, anonKey } = getPublicConfig();
  const response = await fetch(`${url}${path}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`
    }
  });
  if (!response.ok) throw new Error(`Supabase public read failed with status ${response.status}.`);
  return response.json();
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
  if ([401, 403].includes(response.status)) return null;
  if (!response.ok) throw new Error(`Supabase Auth user lookup failed with status ${response.status}.`);
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

async function encodeSession(session) {
  let operation = 'IV generation';
  try {
    const iv = crypto.randomBytes(12);
    operation = 'session key derivation';
    const key = sessionKey();
    operation = 'AES-GCM key import';
    const cryptoKey = await globalThis.crypto.subtle.importKey(
      'raw',
      new Uint8Array(key),
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );
    operation = 'session serialization';
    const serializedSession = new TextEncoder().encode(JSON.stringify(session));
    operation = 'AES-GCM encryption';
    const encryptedWithTag = new Uint8Array(await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv), tagLength: sessionAuthTagLength * 8 },
      cryptoKey,
      serializedSession
    ));
    operation = 'authentication tag extraction';
    if (encryptedWithTag.byteLength < sessionAuthTagLength) {
      throw new Error('Invalid AES-GCM output length.');
    }
    const ciphertextEnd = encryptedWithTag.byteLength - sessionAuthTagLength;
    const encrypted = Buffer.from(encryptedWithTag.subarray(0, ciphertextEnd));
    const authTag = Buffer.from(encryptedWithTag.subarray(ciphertextEnd));
    operation = 'IV base64url encoding';
    const encodedIv = iv.toString('base64url');
    operation = 'authentication tag base64url encoding';
    const encodedAuthTag = authTag.toString('base64url');
    operation = 'ciphertext base64url encoding';
    const encodedCiphertext = encrypted.toString('base64url');
    operation = 'session token assembly';
    return [encodedIv, encodedAuthTag, encodedCiphertext].join('.');
  } catch (error) {
    const errorName = error instanceof Error && safeDiagnosticErrorNames.has(error.name)
      ? error.name
      : 'Error';
    const errorMessage = safeSessionErrorMessages.get(error instanceof Error ? error.message : '')
      || `${operation} failed; error detail suppressed.`;
    console.error('Admin session encoding diagnostic:', {
      operation,
      errorName,
      errorMessage
    });
    throw error;
  }
}

async function decodeSession(value) {
  try {
    const [ivValue, tagValue, encryptedValue] = String(value || '').split('.');
    if (!ivValue || !tagValue || !encryptedValue) return null;
    const iv = Buffer.from(ivValue, 'base64url');
    const authTag = Buffer.from(tagValue, 'base64url');
    if (iv.byteLength !== 12 || authTag.byteLength !== sessionAuthTagLength) return null;
    const encrypted = Buffer.concat([
      Buffer.from(encryptedValue, 'base64url'),
      authTag
    ]);
    const cryptoKey = await globalThis.crypto.subtle.importKey(
      'raw',
      new Uint8Array(sessionKey()),
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    const decrypted = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv), tagLength: sessionAuthTagLength * 8 },
      cryptoKey,
      new Uint8Array(encrypted)
    );
    const session = JSON.parse(new TextDecoder().decode(decrypted));
    return session && typeof session === 'object' && !Array.isArray(session) ? session : null;
  } catch (error) {
    if (error instanceof SyntaxError || error?.name === 'OperationError') return null;
    throw error;
  }
}

function readCookie(event, name) {
  const cookieHeader = event.headers?.cookie || event.headers?.Cookie || '';
  const item = cookieHeader.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  if (!item) return null;
  try {
    return decodeURIComponent(item.slice(name.length + 1));
  } catch {
    return null;
  }
}

async function sessionCookie(session) {
  const now = Math.floor(Date.now() / 1000);
  const requestedExpiry = Number.isSafeInteger(session.expiresAt)
    ? session.expiresAt
    : now + sessionMaxAge;
  const expiresAt = Math.min(requestedExpiry, now + sessionMaxAge);
  const maxAge = expiresAt - now;
  if (maxAge <= 0) throw new Error('Cannot issue an expired admin session.');
  const value = await encodeSession({ ...session, expiresAt });
  return `${sessionCookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
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
  const session = await decodeSession(readCookie(event, sessionCookieName));
  if (!session?.accessToken) return null;
  const now = Math.floor(Date.now() / 1000);
  const legacySession = session.expiresAt === undefined;
  const expiresAt = legacySession ? now + sessionMaxAge : session.expiresAt;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return null;

  let authUser = await getAuthUser(session.accessToken);
  let refreshed = null;
  if (!authUser && session.refreshToken) {
    const result = await authRequest('refresh_token', { refresh_token: session.refreshToken });
    if (result.response.ok) {
      if (!result.data.access_token) {
        throw new Error('Supabase Auth refresh returned no access token.');
      }
      refreshed = result.data;
      authUser = await getAuthUser(refreshed.access_token);
    } else if (![400, 401, 403].includes(result.response.status)) {
      throw new Error(`Supabase Auth refresh failed with status ${result.response.status}.`);
    }
  }
  if (!authUser) return null;
  const profile = await getAdminProfile(authUser.id);
  if (!profile) return null;
  const setCookie = refreshed || legacySession
    ? await sessionCookie({
      accessToken: refreshed?.access_token || session.accessToken,
      refreshToken: refreshed?.refresh_token || session.refreshToken,
      expiresAt
    })
    : null;
  return {
    user: publicAdminUser(profile),
    profile,
    accessToken: refreshed?.access_token || session.accessToken,
    setCookie
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

function mapPublicPost(post, categoriesById, options = {}) {
  const categoryName = categoriesById.get(String(post.category_id)) || post.category || 'Technology';
  const publishedAt = post.published_at || post.created_at;
  const image = post.featured_image || 'https://blogsphere.info/Logo.webp';
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
    thumb: post.featured_image || 'https://blogsphere.info/Logo.webp',
    tags: toJson(post.tags, []),
    // Lite mode (list pages) omits the full article body so the list payload
    // stays small; article pages fetch the single post with content instead.
    content: options.lite ? undefined : sanitizeRichText(post.content || ''),
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

async function getPublicCategories() {
  return supabasePublicGet('/rest/v1/categories?select=*&order=name.asc');
}

async function getPublishedPosts() {
  return supabasePublicGet('/rest/v1/posts?select=*&status=eq.published&deleted_at=is.null&order=published_at.desc.nullslast,created_at.desc.nullslast,id.desc');
}

async function getPublicData(options = {}) {
  const [categories, posts] = await Promise.all([getPublicCategories(), getPublishedPosts()]);
  const categoriesById = new Map(categories.map(category => [String(category.id), category.name]));
  return { posts: posts.map(post => mapPublicPost(post, categoriesById, options)), categories };
}

async function getPublicPost(lookup) {
  const wanted = String(lookup || '').trim();
  if (!wanted) return null;
  const normalized = wanted.toLowerCase();
  const posts = await getPublishedPosts();
  const post = posts.find(item => String(item.id) === wanted || String(item.slug || '').toLowerCase() === normalized);
  if (!post) return null;
  const categories = await getPublicCategories();
  const categoriesById = new Map(categories.map(category => [String(category.id), category.name]));
  return mapPublicPost(post, categoriesById);
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
  getPublicCategories,
  getPublishedPosts,
  getPublicData,
  getPublicPost,
  hasRole,
  isMainAdmin,
  jsonResponse,
  mapPublicPost,
  parseBody,
  publicAdminUser,
  requireAdmin,
  responseWithHeaders,
  sessionCookie,
  supabasePublicGet,
  supabaseGet,
  supabaseRequest,
  toJson,
  sanitizeRichText
};