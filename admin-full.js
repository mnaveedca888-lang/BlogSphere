const { api, expressDevelopment } = window.BlogSphereAdminRouting.resolveAdminApiRouting({
  hostname: window.location.hostname,
  port: window.location.port,
  platform: window.BLOGSPHERE_API_PLATFORM
});

const $ = id => document.getElementById(id);
const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const localSettingsKey = 'blogsphere-admin-settings-v2';
const localMediaKey = 'blogsphere-admin-media-v2';
let adminUser = null;
let posts = [];
let categories = [];
let comments = [];
let users = [];
let localMedia = readLocal(localMediaKey, []);
let settings = readLocal(localSettingsKey, {
  title: '', tagline: '', url: window.location.origin, author: '', perPage: 9,
  metaTitle: '', metaDesc: '', facebook: '', x: '', instagram: '', youtube: ''
});
let editingPostId = null;
let editingComment = null;
let commentEditMode = null;
let editingUser = null;
let userPasswordTimer;
let recoveryToken = null;
let toastTimer;

function readLocal(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    console.error(`Unable to read ${key} from local storage.`, error);
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Unable to save ${key} to local storage.`, error);
    throw new Error('This browser could not save the local preference.');
  }
}

function toast(message) {
  const element = $('toast');
  element.textContent = message;
  element.classList.remove('hidden');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => element.classList.add('hidden'), 4000);
}

function slugify(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}

async function request(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`The server returned an invalid response (${response.status}).`);
    }
  }
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function normalizeCategory(category) {
  return {
    id: category.id,
    name: category.name || category.title || '',
    description: category.description || '',
    slug: category.slug || ''
  };
}

function normalizePost(post) {
  const category = categories.find(item => String(item.id) === String(post.category_id));
  return {
    ...post,
    id: String(post.id),
    slug: post.slug || String(post.id),
    title: post.title || '(No title)',
    category: post.category_name || post.category || (category && category.name) || 'Uncategorized',
    category_id: post.category_id || null,
    author: post.author || 'Admin',
    status: String(post.status || 'draft').toLowerCase(),
    date: post.published_at || post.created_at || '',
    modified: post.updated_at || post.created_at || '',
    excerpt: post.excerpt || '',
    content: post.content || '',
    image: post.featured_image || post.image || '',
    tags: Array.isArray(post.tags) ? post.tags : [],
    meta_title: post.meta_title || '',
    meta_description: post.meta_description || ''
  };
}

function allPosts() {
  return posts;
}

function postEndpoint(id, action) {
  if (!expressDevelopment) {
    const params = new URLSearchParams();
    if (id != null) params.set('id', id);
    if (action) params.set('action', action);
    const query = params.toString();
    return api.posts + (query ? `?${query}` : '');
  }
  if (id == null) return api.posts;
  const suffix = action === 'duplicate' ? 'duplicate' : action;
  return `${api.posts}/${encodeURIComponent(id)}${suffix ? `/${suffix}` : ''}`;
}

function categoryEndpoint(id) {
  if (!expressDevelopment && id != null) return `${api.categories}?id=${encodeURIComponent(id)}`;
  return id == null ? api.categories : `${api.categories}/${encodeURIComponent(id)}`;
}

async function loadData() {
  const [postRows, categoryRows] = await Promise.all([
    request(postEndpoint()),
    request(api.categories)
  ]);
  if (!Array.isArray(postRows) || !Array.isArray(categoryRows)) {
    throw new Error('The admin API returned an unexpected data format.');
  }
  categories = categoryRows.map(normalizeCategory);
  posts = postRows.map(normalizePost);
}

function showLogin() {
  $('app').classList.add('hidden');
  $('passwordChangeScreen').classList.add('hidden');
  $('loginScreen').classList.remove('hidden');
}

function showApp(user) {
  adminUser = user;
  $('loginScreen').classList.add('hidden');
  if (user.must_change_password) {
    $('app').classList.add('hidden');
    $('passwordChangeScreen').classList.remove('hidden');
    $('forcePasswordMsg').classList.add('hidden');
    return false;
  }
  $('passwordChangeScreen').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('adminEmailLabel').textContent = user.email || '';
  $('globalNotice').textContent = '';
  $('pfAuthor').value = user.name || 'Admin';
  applyRoleVisibility();
  showSection('dashboard');
  return true;
}

function applyRoleVisibility() {
  const role = adminUser?.role;
  document.querySelector('[data-nav="users"]').classList.toggle('hidden', role !== 'administrator');
  document.querySelector('[data-nav="comments"]').classList.toggle('hidden', !['administrator', 'editor', 'author'].includes(role));
  document.querySelector('[data-nav="media"]').classList.toggle('hidden', role === 'viewer');
  const canWritePosts = ['administrator', 'editor', 'author'].includes(role);
  $('addPostBtn').classList.toggle('hidden', !canWritePosts);
  $('postFormCard').classList.toggle('hidden', !canWritePosts);
  const canWriteCategories = ['administrator', 'editor'].includes(role);
  $('catNameInput').disabled = !canWriteCategories;
  $('catDescInput').disabled = !canWriteCategories;
  $('addCatBtn').disabled = !canWriteCategories;
  $('ufRole').querySelector('option[value="administrator"]').disabled = !adminUser?.is_main_admin;
}

function showLoginError(message) {
  const error = $('loginError');
  error.textContent = message;
  error.classList.remove('hidden');
}

$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('loginError').classList.add('hidden');
  const button = $('loginForm').querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await request(api.login, {
      method: 'POST',
      body: JSON.stringify({
        email: $('loginEmail').value.trim(),
        password: $('loginPassword').value
      })
    });
    if (!result.user) throw new Error('The server did not return an administrator session.');
    $('loginPassword').value = '';
    if (showApp(result.user)) await refreshData();
  } catch (error) {
    showLoginError(error.message);
  } finally {
    button.disabled = false;
  }
});

function showPasswordChangeError(message) {
  const element = $('forcePasswordMsg');
  element.textContent = message;
  element.classList.remove('hidden');
}

$('forcePasswordForm').addEventListener('submit', async event => {
  event.preventDefault();
  const password = $('forcePassword').value;
  if (password.length < 12 || password.length > 128) {
    showPasswordChangeError('Use a password between 12 and 128 characters.');
    return;
  }
  if (password !== $('forcePasswordConfirm').value) {
    showPasswordChangeError('The passwords do not match.');
    return;
  }
  const button = $('forcePasswordForm').querySelector('button[type="submit"]');
  button.disabled = true;
  $('forcePasswordMsg').classList.add('hidden');
  try {
    await request(api.passwordChange, { method: 'POST', body: JSON.stringify({ password }) });
    $('forcePassword').value = '';
    $('forcePasswordConfirm').value = '';
    adminUser.must_change_password = false;
    showApp(adminUser);
    await refreshData();
    toast('Password updated.');
  } catch (error) {
    showPasswordChangeError(error.message);
  } finally {
    button.disabled = false;
  }
});

async function refreshData() {
  try {
    await loadData();
    $('globalNotice').textContent = '';
    renderAll();
  } catch (error) {
    $('globalNotice').innerHTML = `<div class="notice warn">${escapeHtml(error.message)} Refresh the page or sign in again.</div>`;
    if (error.status === 401) {
      adminUser = null;
      showLogin();
    }
    throw error;
  }
}

async function logout() {
  try {
    await request(api.logout, { method: 'POST' });
    adminUser = null;
    posts = [];
    categories = [];
    comments = [];
    users = [];
    $('loginPassword').value = '';
    showLogin();
  } catch (error) {
    toast(`Logout failed: ${error.message}`);
  }
}

$('navLogout').addEventListener('click', logout);
$('topLogout').addEventListener('click', logout);

$('forgotLink').addEventListener('click', event => {
  event.preventDefault();
  $('loginForm').classList.add('hidden');
  $('recoveryRequestForm').classList.remove('hidden');
  $('recoveryEmail').value = $('loginEmail').value.trim();
  $('recoveryRequestMsg').classList.add('hidden');
});

$('backToLogin').addEventListener('click', event => {
  event.preventDefault();
  $('recoveryRequestForm').classList.add('hidden');
  $('loginForm').classList.remove('hidden');
});

$('recoveryRequestForm').addEventListener('submit', async event => {
  event.preventDefault();
  const message = $('recoveryRequestMsg');
  message.classList.add('hidden');
  try {
    if (localDevelopment) throw new Error('Password recovery is available on the deployed site only.');
    await request(api.recoveryRequest, {
      method: 'POST',
      body: JSON.stringify({ email: $('recoveryEmail').value.trim() })
    });
    message.textContent = 'If the address belongs to an active dashboard user, a reset link will be sent.';
    message.classList.remove('hidden');
    message.classList.add('notice');
    $('recoveryRequestForm').querySelector('button[type="submit"]').disabled = true;
  } catch (error) {
    message.textContent = error.message;
    message.classList.remove('hidden');
  }
});

$('recoveryUpdateForm').addEventListener('submit', async event => {
  event.preventDefault();
  const message = $('recoveryUpdateMsg');
  message.classList.add('hidden');
  const password = $('recoveryPassword').value;
  if (password.length < 8) {
    message.textContent = 'Use a password with at least 8 characters.';
    message.classList.remove('hidden');
    return;
  }
  if (password !== $('recoveryPasswordConfirm').value) {
    message.textContent = 'The passwords do not match.';
    message.classList.remove('hidden');
    return;
  }
  try {
    await request(api.recoveryUpdate, {
      method: 'POST',
      body: JSON.stringify({ access_token: recoveryToken, password })
    });
    recoveryToken = null;
    $('recoveryPassword').value = '';
    $('recoveryPasswordConfirm').value = '';
    $('recoveryUpdateForm').classList.add('hidden');
    $('loginForm').classList.remove('hidden');
    showLoginError('Password updated. Sign in with your new password.');
  } catch (error) {
    message.textContent = error.message;
    message.classList.remove('hidden');
  }
});

function handleRecoveryLink() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (params.get('type') !== 'recovery' || !params.get('access_token')) return;
  recoveryToken = params.get('access_token');
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  $('loginForm').classList.add('hidden');
  $('recoveryRequestForm').classList.add('hidden');
  $('recoveryUpdateForm').classList.remove('hidden');
}

const sections = ['dashboard', 'posts', 'media', 'categories', 'comments', 'users', 'settings'];
function showSection(name) {
  if (name !== 'users') {
    window.clearTimeout(userPasswordTimer);
    $('userFormMsg').textContent = '';
    $('userFormMsg').classList.add('hidden');
  }
  sections.forEach(section => $(`section-${section}`).classList.toggle('hidden', section !== name));
  document.querySelectorAll('.side-item[data-nav]').forEach(button => {
    button.classList.toggle('active', button.dataset.nav === name);
  });
  $('sidebar').classList.remove('open');
  const renderers = {
    dashboard: renderDashboard, posts: renderPosts, media: renderMedia,
    categories: renderCategories, comments: renderComments, users: renderUsers,
    settings: renderSettings
  };
  renderers[name]();
}

document.querySelectorAll('.side-item[data-nav]').forEach(button => {
  button.addEventListener('click', () => showSection(button.dataset.nav));
});
$('menuBtn').addEventListener('click', () => $('sidebar').classList.toggle('open'));
$('themeBtn').addEventListener('click', () => {
  document.body.classList.toggle('dark');
  window.localStorage.setItem('blogsphere-theme', document.body.classList.contains('dark') ? 'dark' : 'light');
});
if (window.localStorage.getItem('blogsphere-theme') === 'dark') document.body.classList.add('dark');
$('topSearch').addEventListener('input', () => {
  const query = $('topSearch').value.trim();
  $('postSearch').value = query;
  if (query) {
    showSection('posts');
  } else if (!$('section-posts').classList.contains('hidden')) {
    renderPosts();
  }
});

function countForCategory(category) {
  return posts.filter(post => String(post.category_id) === String(category.id) || (!post.category_id && post.category === category.name)).length;
}

function renderDashboard() {
  const published = posts.filter(post => post.status === 'published').length;
  const drafts = posts.filter(post => post.status === 'draft').length;
  const trashed = posts.filter(post => post.status === 'trash').length;
  const stats = [
    ['Total Posts', posts.length], ['Published', published], ['Drafts', drafts],
    ['Trash', trashed], ['Categories', categories.length]
  ];
  $('statCards').innerHTML = stats.map(([label, count]) =>
    `<div class="stat"><div class="n">${count}</div><div class="l">${escapeHtml(label)}</div></div>`
  ).join('');
  const max = Math.max(1, ...categories.map(countForCategory));
  $('catBars').innerHTML = categories.map(category => {
    const count = countForCategory(category);
    return `<div class="bar-row"><span class="nm">${escapeHtml(category.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(count / max * 100)}%"></div></div><b>${count}</b></div>`;
  }).join('') || '<p>No live categories.</p>';
  const latest = posts.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 5);
  $('latestPosts').innerHTML = latest.map(post =>
    `<div class="list-item">${post.image ? `<img src="${escapeHtml(post.image)}" alt="" onerror="this.style.visibility='hidden'">` : ''}<div><b>${escapeHtml(post.title)}</b><br><span style="color:var(--muted);font-size:13px">${escapeHtml(post.category)} • ${escapeHtml(post.author)} • ${escapeHtml(formatDate(post.date))} • ${escapeHtml(post.status)}</span></div></div>`
  ).join('') || '<p>No posts yet.</p>';
  $('recentActivity').innerHTML = latest.map(post =>
    `<div class="list-item"><span>•</span><span>${escapeHtml(post.title)} — ${escapeHtml(post.status)} on ${escapeHtml(formatDate(post.modified))}</span></div>`
  ).join('') || '<p>No recent post activity.</p>';
}

function renderPosts() {
  const query = $('postSearch').value.trim().toLowerCase();
  const filter = $('postFilter').value;
  const filtered = posts.filter(post => {
    if (filter !== 'all' && post.status !== filter) return false;
    return !query || `${post.title} ${post.category} ${post.author}`.toLowerCase().includes(query);
  });
  const selectedCategory = $('pfCategory').value;
  $('pfCategory').innerHTML = '<option value="">Uncategorized</option>' + categories.map(category =>
    `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`
  ).join('');
  $('pfCategory').value = selectedCategory;
  const canWrite = ['administrator', 'editor', 'author'].includes(adminUser?.role);
  $('postsTable').innerHTML = filtered.map(post => {
    const actions = !canWrite ? ''
      : post.status === 'trash'
        ? `<button class="btn ghost small" data-action="restore">Restore</button> <button class="btn danger small" data-action="delete">Delete permanently</button>`
        : `<button class="btn ghost small" data-action="edit">Edit</button> <button class="btn ghost small" data-action="duplicate">Duplicate</button> ${post.status === 'published' ? '<button class="btn ghost small" data-action="draft">Draft</button>' : '<button class="btn ghost small" data-action="publish">Publish</button>'} <button class="btn danger small" data-action="trash">Trash</button>`;
    return `<tr data-post-id="${escapeHtml(post.id)}"><td>${post.image ? `<img class="thumb" src="${escapeHtml(post.image)}" alt="">` : '—'}</td><td><b>${escapeHtml(post.title)}</b><br><span style="color:var(--muted);font-size:12px">${escapeHtml(post.excerpt)}</span></td><td>${escapeHtml(post.category)}</td><td>${escapeHtml(post.author)}</td><td><span class="pill ${escapeHtml(post.status)}">${escapeHtml(post.status.toUpperCase())}</span></td><td>${escapeHtml(formatDate(post.date))}</td><td>${escapeHtml(formatDate(post.modified))}</td><td style="white-space:nowrap"><button class="btn ghost small" data-action="view">View</button> ${actions}</td></tr>`;
  }).join('') || '<tr><td colspan="8">No posts found.</td></tr>';
}

$('postsTable').addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const row = button.closest('tr[data-post-id]');
  const post = posts.find(item => item.id === row.dataset.postId);
  if (!post) return;
  const action = button.dataset.action;
  if (action === 'view') {
    window.open(`${window.location.origin}/article.html?id=${encodeURIComponent(post.slug)}`, '_blank', 'noopener');
  } else if (action === 'edit') {
    editPost(post);
  } else if (action === 'delete') {
    if (window.confirm(`Permanently delete “${post.title}”? This cannot be undone.`)) await performPostAction(post, 'delete');
  } else {
    await performPostAction(post, action);
  }
});

function editPost(post) {
  editingPostId = post.id;
  renderPosts();
  $('postFormTitle').textContent = `Edit Post — ${post.title}`;
  $('pfTitle').value = post.title;
  $('pfSlug').value = post.slug;
  $('pfExcerpt').value = post.excerpt;
  $('pfContent').value = post.content;
  $('pfCategory').value = post.category_id || '';
  $('pfAuthor').value = post.author;
  $('pfTags').value = post.tags.join(', ');
  $('pfDate').value = formatDate(post.date) === '—' ? '' : formatDate(post.date);
  $('pfStatus').value = post.status === 'published' ? 'published' : 'draft';
  $('pfImage').value = post.image;
  $('pfMetaTitle').value = post.meta_title;
  $('pfMetaDesc').value = post.meta_description;
  $('postFormCard').scrollIntoView({ behavior: 'smooth' });
}

async function performPostAction(post, action) {
  try {
    if (action === 'delete') {
      await request(localDevelopment ? postEndpoint(post.id) : postEndpoint(post.id), { method: 'DELETE' });
    } else {
      const serverAction = action === 'publish' || action === 'draft' || action === 'trash' || action === 'restore' || action === 'duplicate'
        ? action : null;
      if (!serverAction) return;
      await request(postEndpoint(post.id, serverAction), { method: 'POST' });
    }
    await refreshData();
    toast(action === 'delete' ? 'Post permanently deleted.' : `Post ${action} successful.`);
  } catch (error) {
    toast(`Post action failed: ${error.message}`);
  }
}

$('postSearch').addEventListener('input', () => {
  $('topSearch').value = $('postSearch').value;
  renderPosts();
});
$('postFilter').addEventListener('change', renderPosts);
$('refreshPostsBtn').addEventListener('click', async () => {
  const button = $('refreshPostsBtn');
  button.disabled = true;
  try {
    await refreshData();
    toast('Live data refreshed.');
  } catch (error) {
    toast(`Refresh failed: ${error.message}`);
  } finally {
    button.disabled = false;
  }
});
$('addPostBtn').addEventListener('click', () => {
  editingPostId = null;
  $('postForm').reset();
  $('pfAuthor').value = adminUser.name || 'Admin';
  $('pfCategory').value = '';
  $('postFormTitle').textContent = 'Add New Post';
  $('postSaveMsg').textContent = '';
  $('postFormCard').scrollIntoView({ behavior: 'smooth' });
});
$('genSlugBtn').addEventListener('click', () => { $('pfSlug').value = slugify($('pfTitle').value); });
$('cancelPostBtn').addEventListener('click', () => {
  editingPostId = null;
  $('postForm').reset();
  $('postFormTitle').textContent = 'Add New Post';
  $('postSaveMsg').textContent = '';
});
$('saveDraftBtn').addEventListener('click', () => savePost('draft'));
$('postForm').addEventListener('submit', event => {
  event.preventDefault();
  savePost($('pfStatus').value || 'published');
});

async function savePost(status) {
  const message = $('postSaveMsg');
  const title = $('pfTitle').value.trim();
  if (!title) {
    message.textContent = 'Title is required to save a post.';
    message.style.color = '#991b1b';
    toast('Post was not saved: title is required.');
    $('pfTitle').focus();
    return;
  }
  const payload = {
    title,
    slug: $('pfSlug').value.trim() || slugify($('pfTitle').value),
    excerpt: $('pfExcerpt').value.trim(),
    content: $('pfContent').value,
    category_id: $('pfCategory').value || null,
    author: $('pfAuthor').value.trim() || adminUser.name || 'Admin',
    tags: $('pfTags').value.split(',').map(tag => tag.trim()).filter(Boolean),
    published_at: $('pfDate').value ? new Date(`${$('pfDate').value}T12:00:00`).toISOString() : null,
    status,
    featured_image: $('pfImage').value.trim(),
    meta_title: $('pfMetaTitle').value.trim(),
    meta_description: $('pfMetaDesc').value.trim()
  };
  const button = $('postForm').querySelector('button[type="submit"]');
  button.disabled = true;
  message.textContent = '';
  try {
    await request(editingPostId ? postEndpoint(editingPostId) : postEndpoint(), {
      method: editingPostId ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
    editingPostId = null;
    $('postForm').reset();
    $('postFormTitle').textContent = 'Add New Post';
    message.textContent = 'Saved to the live database.';
    message.style.color = 'green';
    await refreshData();
    toast('Post saved.');
  } catch (error) {
    message.textContent = `Post was not saved: ${error.message}`;
    message.style.color = '#991b1b';
    toast(`Post save failed: ${error.message}`);
  } finally {
    button.disabled = false;
  }
}

function renderMedia() {
  const items = [];
  posts.forEach(post => {
    if (post.image) items.push({ title: post.title, label: 'Used by a live post', url: post.image });
  });
  localMedia.forEach(item => items.push(item));
  window._mediaItems = items;
  $('mediaGrid').innerHTML = items.map((item, index) =>
    `<div class="media-item"><img src="${escapeHtml(item.url)}" alt="" onerror="this.style.visibility='hidden'"><div class="pad"><b>${escapeHtml(item.title || 'Image')}</b><span style="color:var(--muted)">${escapeHtml(item.label || 'Browser-local URL reference')}</span><br><code>${escapeHtml(item.url)}</code><br><br><button class="btn ghost small" data-copy-index="${index}">Copy URL</button></div></div>`
  ).join('') || '<p>No images yet.</p>';
}

$('mediaGrid').addEventListener('click', async event => {
  const button = event.target.closest('button[data-copy-index]');
  if (!button) return;
  const item = window._mediaItems[Number(button.dataset.copyIndex)];
  if (!item) return;
  try {
    await navigator.clipboard.writeText(item.url);
    toast('URL copied.');
  } catch (error) {
    toast(`Unable to copy the URL: ${error.message}`);
  }
});

$('addMediaUrlBtn').addEventListener('click', () => {
  const url = $('mediaUrlInput').value.trim();
  if (!url) return toast('Paste an image URL first.');
  try {
    const parsed = new URL(url, window.location.origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Enter a valid HTTP image URL.');
    localMedia.unshift({ title: 'Added image', label: 'Browser-local URL reference', url: parsed.href });
    writeLocal(localMediaKey, localMedia);
    $('mediaUrlInput').value = '';
    renderMedia();
    toast('Image URL reference saved in this browser.');
  } catch (error) {
    toast(error.message);
  }
});

$('mediaFileInput').addEventListener('change', async event => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type) || file.size > 8 * 1024 * 1024) {
    toast('Choose a JPEG, PNG, WebP or GIF image under 8 MB.');
    event.target.value = '';
    return;
  }
  try {
    let result;
    if (expressDevelopment) {
      const formData = new FormData();
      formData.append('file', file);
      result = await request(api.upload, { method: 'POST', body: formData });
    } else {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Unable to read the selected image.'));
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
      result = await request(api.upload, {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, contentType: file.type, data: String(dataUrl).split(',')[1] })
      });
    }
    if (!result.url) throw new Error('The upload API did not return an image URL.');
    localMedia.unshift({ title: file.name, label: 'Uploaded image', url: result.url });
    writeLocal(localMediaKey, localMedia);
    renderMedia();
    toast('Image uploaded successfully.');
  } catch (error) {
    toast(`Image upload failed: ${error.message}`);
  } finally {
    event.target.value = '';
  }
});

function renderCategories() {
  const canWrite = ['administrator', 'editor'].includes(adminUser?.role);
  $('catTable').innerHTML = categories.map(category =>
    `<tr data-category-id="${escapeHtml(category.id)}"><td>${escapeHtml(category.id)}</td><td><b>${escapeHtml(category.name)}</b></td><td>${escapeHtml(category.description)}</td><td>${countForCategory(category)}</td><td style="white-space:nowrap">${canWrite ? '<button class="btn ghost small" data-action="edit">Edit</button> <button class="btn danger small" data-action="delete">Delete</button>' : 'Read only'}</td></tr>`
  ).join('') || '<tr><td colspan="5">No categories.</td></tr>';
}

$('catTable').addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const row = button.closest('tr[data-category-id]');
  const category = categories.find(item => String(item.id) === row.dataset.categoryId);
  if (!category) return;
  try {
    if (button.dataset.action === 'edit') {
      const name = window.prompt('Category name:', category.name);
      if (name === null) return;
      const description = window.prompt('Description:', category.description);
      if (description === null) return;
      if (!name.trim()) return toast('Category name is required.');
      await request(categoryEndpoint(category.id), {
        method: 'PUT',
        body: JSON.stringify({ name: name.trim(), description: description.trim() })
      });
    } else {
      if (window.confirm(`Delete category “${category.name}”? Categories assigned to posts cannot be deleted.`)) {
        await request(categoryEndpoint(category.id), { method: 'DELETE' });
      } else {
        return;
      }
    }
    await refreshData();
    toast('Category saved.');
  } catch (error) {
    toast(`Category update failed: ${error.message}`);
  }
});

$('addCatBtn').addEventListener('click', async () => {
  const name = $('catNameInput').value.trim();
  if (!name) return toast('Enter a category name.');
  try {
    await request(categoryEndpoint(), {
      method: 'POST',
      body: JSON.stringify({ name, description: $('catDescInput').value.trim() })
    });
    $('catNameInput').value = '';
    $('catDescInput').value = '';
    await refreshData();
    toast('Category added.');
  } catch (error) {
    toast(`Category could not be added: ${error.message}`);
  }
});

function renderComments() {
  if (!['administrator', 'editor', 'author'].includes(adminUser?.role)) {
    $('commentCount').textContent = 'Your role has read-only access.';
    $('commentTable').innerHTML = '<tr><td colspan="6">Comment moderation is unavailable for this role.</td></tr>';
    return;
  }
  $('commentCount').textContent = 'Loading comments…';
  const filter = $('commentFilter').value;
  const query = filter === 'all' ? '' : `?status=${encodeURIComponent(filter)}`;
  request(`${api.comments}${query}`).then(rows => {
    if (!Array.isArray(rows)) throw new Error('The comments API returned an unexpected data format.');
    comments = rows;
    $('commentCount').textContent = `${comments.length} comment${comments.length === 1 ? '' : 's'}`;
    $('commentTable').innerHTML = comments.map(comment => {
      const actions = [
        comment.status === 'approved' ? '' : '<button class="btn ghost small" data-action="approve">Approve</button>',
        comment.status === 'rejected' ? '' : '<button class="btn ghost small" data-action="reject">Reject</button>',
        '<button class="btn ghost small" data-action="edit">Edit</button>',
        '<button class="btn ghost small" data-action="reply">Reply</button>',
        '<button class="btn danger small" data-action="delete">Delete</button>'
      ].filter(Boolean).join(' ');
      return `<tr data-comment-id="${escapeHtml(comment.id)}"><td><b>${escapeHtml(comment.name)}</b><br><span style="color:var(--muted);font-size:12px">${escapeHtml(comment.email)}</span></td><td><div style="white-space:pre-wrap">${escapeHtml(comment.body)}</div>${comment.reply ? `<div style="margin-top:8px;padding:8px;background:var(--grey);border-radius:6px"><b>Admin reply:</b><br><span style="white-space:pre-wrap">${escapeHtml(comment.reply)}</span></div>` : ''}</td><td><a href="article.html?id=${encodeURIComponent(comment.post_id)}" target="_blank" rel="noopener">${escapeHtml(comment.post_title)}</a></td><td>${escapeHtml(formatDate(comment.created_at))}</td><td><span class="pill ${escapeHtml(comment.status)}">${escapeHtml(comment.status.toUpperCase())}</span></td><td style="white-space:nowrap">${actions}</td></tr>`;
    }).join('') || '<tr><td colspan="6">No comments for this filter.</td></tr>';
  }).catch(error => {
    $('commentCount').textContent = 'Comments could not be loaded.';
    $('commentTable').innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;
  });
}

function renderUsers() {
  if (adminUser?.role !== 'administrator') {
    $('userTable').innerHTML = '<tr><td colspan="5">Administrator access is required.</td></tr>';
    return;
  }
  request(api.users).then(rows => {
    if (!Array.isArray(rows)) throw new Error('The user-management API returned an unexpected data format.');
    users = rows;
    $('userTable').innerHTML = users.map(user => {
      const protectedTarget = user.is_main_admin;
      const canChangeAdmin = adminUser.is_main_admin;
      const edit = `<button class="btn ghost small" data-action="edit">Edit</button>`;
      const toggle = protectedTarget || String(user.id) === String(adminUser.id)
        ? ''
        : `<button class="btn ghost small" data-action="toggle">${user.is_active ? 'Deactivate' : 'Reactivate'}</button>`;
      const remove = protectedTarget || String(user.id) === String(adminUser.id) || (user.role === 'administrator' && !canChangeAdmin)
        ? ''
        : `<button class="btn danger small" data-action="delete">Delete</button>`;
      return `<tr data-user-id="${escapeHtml(user.id)}"><td><b>${escapeHtml(user.name || '—')}</b></td><td>${escapeHtml(user.email)}</td><td>${escapeHtml(user.role)}</td><td>${user.is_active ? 'Active' : 'Inactive'}${user.must_change_password ? ' · Password change required' : ''}</td><td style="white-space:nowrap">${edit} ${toggle} ${remove}</td></tr>`;
    }).join('') || '<tr><td colspan="5">No users.</td></tr>';
  }).catch(error => {
    $('userTable').innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
  });
}

$('commentFilter').addEventListener('change', renderComments);
$('refreshCommentsBtn').addEventListener('click', renderComments);

$('commentTable').addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const row = button.closest('tr[data-comment-id]');
  const comment = comments.find(item => String(item.id) === row?.dataset.commentId);
  if (!comment) return;
  const action = button.dataset.action;
  try {
    if (action === 'delete') {
      if (!window.confirm(`Permanently delete this comment by ${comment.name}?`)) return;
      await request(`${api.comments}?id=${encodeURIComponent(comment.id)}`, { method: 'DELETE' });
    } else if (action === 'edit' || action === 'reply') {
      editingComment = comment;
      commentEditMode = action;
      $('commentEditorTitle').textContent = action === 'edit' ? 'Edit comment' : 'Reply to comment';
      $('commentEditFields').classList.toggle('hidden', action !== 'edit');
      $('commentEditName').value = comment.name;
      $('commentEditBody').value = comment.body;
      $('commentEditReply').value = comment.reply || '';
      $('commentEditorError').classList.add('hidden');
      $('commentEditor').classList.remove('hidden');
      if (action === 'reply') $('commentEditReply').focus();
      else $('commentEditName').focus();
      return;
    } else {
      const payload = { status: action === 'approve' ? 'approved' : 'rejected' };
      await request(`${api.comments}?id=${encodeURIComponent(comment.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
    }
    renderComments();
    toast('Comment updated.');
  } catch (error) {
    toast(`Comment operation failed: ${error.message}`);
  }
});

$('cancelCommentEdit').addEventListener('click', () => {
  $('commentEditor').classList.add('hidden');
  editingComment = null;
  commentEditMode = null;
});

$('commentEditor').addEventListener('click', event => {
  if (event.target !== $('commentEditor')) return;
  $('cancelCommentEdit').click();
});

$('commentEditorForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!editingComment || !commentEditMode) return;
  const payload = commentEditMode === 'reply'
    ? { reply: $('commentEditReply').value }
    : { name: $('commentEditName').value, body: $('commentEditBody').value };
  const button = $('commentEditorForm').querySelector('button[type="submit"]');
  button.disabled = true;
  $('commentEditorError').classList.add('hidden');
  try {
    await request(`${api.comments}?id=${encodeURIComponent(editingComment.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    $('commentEditor').classList.add('hidden');
    editingComment = null;
    commentEditMode = null;
    renderComments();
    toast('Comment updated.');
  } catch (error) {
    $('commentEditorError').textContent = error.message;
    $('commentEditorError').classList.remove('hidden');
  } finally {
    button.disabled = false;
  }
});

$('userForm').addEventListener('submit', async event => {
  event.preventDefault();
  const message = $('userFormMsg');
  message.classList.add('hidden');
  try {
    const result = await request(api.users, {
      method: 'POST',
      body: JSON.stringify({
        name: $('ufName').value.trim(),
        email: $('ufEmail').value.trim(),
        role: $('ufRole').value
      })
    });
    $('ufName').value = '';
    $('ufEmail').value = '';
    message.textContent = `Account created for ${result.user.email}. One-time temporary password: ${result.temporary_password}. Copy and deliver it securely; it will not be shown again.`;
    message.classList.remove('hidden');
    message.classList.remove('warn');
    window.clearTimeout(userPasswordTimer);
    userPasswordTimer = window.setTimeout(() => {
      message.textContent = '';
      message.classList.add('hidden');
    }, 60 * 1000);
    renderUsers();
  } catch (error) {
    message.textContent = error.message;
    message.classList.remove('hidden');
    message.classList.add('warn');
  }
});

$('userTable').addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const row = button.closest('tr[data-user-id]');
  const user = users.find(item => String(item.id) === row?.dataset.userId);
  if (!user) return;
  const action = button.dataset.action;
  try {
    if (action === 'delete') {
      if (!window.confirm(`Permanently delete ${user.email}? This cannot be undone.`)) return;
      await request(`${api.users}?id=${encodeURIComponent(user.id)}`, { method: 'DELETE' });
    } else if (action === 'toggle') {
      const is_active = !user.is_active;
      if (!window.confirm(`${is_active ? 'Reactivate' : 'Deactivate'} ${user.email}?`)) return;
      await request(`${api.users}?id=${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active })
      });
    } else if (action === 'edit') {
      editingUser = user;
      $('userEditName').value = user.name;
      $('userEditRole').value = user.role;
      $('userEditRoleField').classList.toggle('hidden', !adminUser.is_main_admin || user.is_main_admin);
      $('userEditorError').classList.add('hidden');
      $('userEditor').classList.remove('hidden');
      $('userEditName').focus();
      return;
    }
    renderUsers();
    toast('User record updated.');
  } catch (error) {
    toast(`User operation failed: ${error.message}`);
  }
});

$('cancelUserEdit').addEventListener('click', () => {
  $('userEditor').classList.add('hidden');
  editingUser = null;
});

$('userEditor').addEventListener('click', event => {
  if (event.target !== $('userEditor')) return;
  $('cancelUserEdit').click();
});

$('userEditorForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!editingUser) return;
  const payload = { name: $('userEditName').value.trim() };
  if (!$('userEditRoleField').classList.contains('hidden')) payload.role = $('userEditRole').value;
  const button = $('userEditorForm').querySelector('button[type="submit"]');
  button.disabled = true;
  $('userEditorError').classList.add('hidden');
  try {
    await request(`${api.users}?id=${encodeURIComponent(editingUser.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    $('userEditor').classList.add('hidden');
    editingUser = null;
    renderUsers();
    toast('User record updated.');
  } catch (error) {
    $('userEditorError').textContent = error.message;
    $('userEditorError').classList.remove('hidden');
  } finally {
    button.disabled = false;
  }
});

function renderSettings() {
  $('sTitle').value = settings.title || '';
  $('sTagline').value = settings.tagline || '';
  $('sUrl').value = settings.url || window.location.origin;
  $('sAuthor').value = settings.author || (adminUser && adminUser.name) || '';
  $('sPerPage').value = settings.perPage || 9;
  $('sMetaTitle').value = settings.metaTitle || '';
  $('sMetaDesc').value = settings.metaDesc || '';
  $('sFacebook').value = settings.facebook || '';
  $('sX').value = settings.x || '';
  $('sInstagram').value = settings.instagram || '';
  $('sYoutube').value = settings.youtube || '';
}

$('settingsForm').addEventListener('submit', event => {
  event.preventDefault();
  settings = {
    title: $('sTitle').value.trim(), tagline: $('sTagline').value.trim(),
    url: $('sUrl').value.trim(), author: $('sAuthor').value.trim(),
    perPage: parseInt($('sPerPage').value, 10) || 9,
    metaTitle: $('sMetaTitle').value.trim(), metaDesc: $('sMetaDesc').value.trim(),
    facebook: $('sFacebook').value.trim(), x: $('sX').value.trim(),
    instagram: $('sInstagram').value.trim(), youtube: $('sYoutube').value.trim()
  };
  try {
    writeLocal(localSettingsKey, settings);
    $('settingsMsg').textContent = 'Preferences saved in this browser only; production site settings are unchanged.';
    toast('Browser-local preferences saved.');
  } catch (error) {
    $('settingsMsg').textContent = error.message;
    toast(error.message);
  }
});

$('resetSettingsBtn').addEventListener('click', () => {
  if (!window.confirm('Reset browser-local preferences?')) return;
  settings = {
    title: '', tagline: '', url: window.location.origin, author: adminUser.name || '',
    perPage: 9, metaTitle: '', metaDesc: '', facebook: '', x: '', instagram: '', youtube: ''
  };
  try {
    writeLocal(localSettingsKey, settings);
    renderSettings();
    $('settingsMsg').textContent = 'Browser-local preferences reset.';
    toast('Preferences reset.');
  } catch (error) {
    toast(error.message);
  }
});

function renderAll() {
  renderDashboard();
  renderPosts();
  renderMedia();
  renderCategories();
  renderComments();
  renderUsers();
  renderSettings();
}

async function init() {
  handleRecoveryLink();
  document.body.classList.toggle('dark', window.localStorage.getItem('blogsphere-theme') === 'dark');
  try {
    const session = await request(api.session);
    if (!session.user) {
      showLogin();
      return;
    }
    if (showApp(session.user)) await refreshData();
  } catch (error) {
    showLogin();
    showLoginError(`Unable to check administrator session: ${error.message}`);
  }
}

init();
