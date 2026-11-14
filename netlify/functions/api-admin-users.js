const crypto = require('crypto');
const {
  adminEmail,
  getConfig,
  hasRole,
  isMainAdmin,
  jsonResponse,
  parseBody,
  requireAdmin,
  responseWithHeaders,
  supabaseGet,
  supabaseRequest
} = require('./_supabase');

const roles = new Set(['administrator', 'editor', 'author', 'viewer']);

async function authAdminRequest(path, method, body) {
  const { url, serviceRoleKey } = getConfig();
  const response = await fetch(`${url}/auth/v1/admin/${path}`, {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function result(status, body, session) {
  return responseWithHeaders(status, body, session?.setCookie ? { 'Set-Cookie': session.setCookie } : {});
}

async function findUser(id) {
  const rows = await supabaseGet(`/rest/v1/users?select=id,auth_user_id,name,email,role,is_active,must_change_password,created_at&id=eq.${encodeURIComponent(id)}&limit=1`);
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  return sameNumericId(rows[0].id, id) ? rows[0] : null;
}

function sameNumericId(actual, expected) {
  try {
    return /^\d+$/.test(String(actual)) && BigInt(actual) === BigInt(expected);
  } catch {
    return false;
  }
}

async function deleteProfile(profile) {
  const missingAuthId = profile.auth_user_id === null || profile.auth_user_id === undefined;
  const authIdFilter = missingAuthId ? 'is.null' : `eq.${encodeURIComponent(profile.auth_user_id)}`;
  const query = new URLSearchParams({
    id: `eq.${encodeURIComponent(profile.id)}`,
    auth_user_id: authIdFilter,
    select: 'id,auth_user_id'
  });
  const deleted = await supabaseRequest(`/rest/v1/users?${query}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' }
  });
  if (!Array.isArray(deleted.body) || deleted.body.length !== 1) return false;
  const deletedProfile = deleted.body[0];
  return sameNumericId(deletedProfile.id, profile.id)
    && (missingAuthId
      ? deletedProfile.auth_user_id === null || deletedProfile.auth_user_id === undefined
      : deletedProfile.auth_user_id === profile.auth_user_id);
}

function isMissingAuthUser(response, data) {
  if (response.status !== 404) return false;
  const message = String(data?.message || '').trim().toLowerCase().replace(/[.!]$/, '');
  return String(data?.code || '').toLowerCase() === 'user_not_found'
    || message === 'user not found';
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name || '',
    email: user.email,
    role: user.role,
    is_active: user.is_active,
    must_change_password: user.must_change_password,
    is_main_admin: user.email?.toLowerCase() === adminEmail,
    created_at: user.created_at
  };
}

exports.handler = async event => {
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(event.httpMethod)) {
    return jsonResponse(405, { error: 'Method not allowed.' });
  }

  try {
    const access = await requireAdmin(event);
    if (access.response) return access.response;
    if (!hasRole(access.session.user, ['administrator'])) {
      return result(403, { error: 'Administrator access is required to manage users.' }, access.session);
    }

    if (event.httpMethod === 'GET') {
      const users = await supabaseGet('/rest/v1/users?select=id,name,email,role,is_active,must_change_password,created_at&order=created_at.asc,id.asc');
      return result(200, users.map(publicUser), access.session);
    }

    let payload;
    try {
      payload = parseBody(event);
    } catch {
      return result(400, { error: 'Invalid JSON body.' }, access.session);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return result(400, { error: 'A JSON object is required.' }, access.session);
    }

    if (event.httpMethod === 'POST') {
      const name = String(payload.name || '').trim();
      const email = String(payload.email || '').trim().toLowerCase();
      const role = String(payload.role || '').trim().toLowerCase();
      if (!name || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !roles.has(role)) {
        return result(400, { error: 'Provide a valid name, email, and role.' }, access.session);
      }
      if (email === access.session.user.email.toLowerCase() || (role === 'administrator' && !isMainAdmin(access.session.user))) {
        return result(403, { error: 'Only the main administrator can grant administrator privileges.' }, access.session);
      }
      if (email === adminEmail) {
        return result(409, { error: 'The protected main administrator account already exists.' }, access.session);
      }

      const temporaryPassword = crypto.randomBytes(24).toString('base64url');
      const created = await authAdminRequest('users', 'POST', {
        email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: { name, role, must_change_password: true }
      });
      if (!created.response.ok || !created.data.id) {
        return result(created.response.status === 422 || created.response.status === 409 ? 409 : 502, {
          error: created.response.status === 422 || created.response.status === 409
            ? 'A user with this email already exists.'
            : 'Unable to create the authentication account.'
        }, access.session);
      }

      try {
        await supabaseRequest('/rest/v1/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({
            auth_user_id: created.data.id,
            name,
            email,
            role,
            is_active: true,
            must_change_password: true
          })
        });
      } catch (error) {
        await authAdminRequest(`users/${encodeURIComponent(created.data.id)}`, 'DELETE');
        throw error;
      }
      return result(201, {
        ok: true,
        user: { name, email, role, is_active: true, must_change_password: true },
        temporary_password: temporaryPassword
      }, access.session);
    }

    const id = String((event.queryStringParameters || {}).id || '');
    if (!/^\d+$/.test(id)) return result(400, { error: 'A valid user id is required.' }, access.session);
    const user = await findUser(id);
    if (!user) return result(404, { error: 'User not found.' }, access.session);
    const isMainTarget = user.email.toLowerCase() === adminEmail;
    const isSelf = String(user.id) === String(access.session.user.id);

    if (isMainTarget && !isMainAdmin(access.session.user)) {
      return result(403, { error: 'Only the main administrator can manage this account.' }, access.session);
    }
    if (isSelf && event.httpMethod === 'DELETE') {
      return result(400, { error: 'You cannot delete your own account.' }, access.session);
    }

    if (event.httpMethod === 'DELETE') {
      if (isMainTarget || (user.role === 'administrator' && !isMainAdmin(access.session.user))) {
        return result(403, { error: 'Only the main administrator can delete administrator accounts, and the main account is protected.' }, access.session);
      }
      if (!user.auth_user_id) {
        const profileDeleted = await deleteProfile(user);
        if (!profileDeleted) return result(404, { error: 'User not found.' }, access.session);
        return result(200, { ok: true }, access.session);
      }
      const deleted = await authAdminRequest(`users/${encodeURIComponent(user.auth_user_id)}`, 'DELETE');
      if (isMissingAuthUser(deleted.response, deleted.data)) {
        const profileDeleted = await deleteProfile(user);
        if (!profileDeleted) return result(404, { error: 'User not found.' }, access.session);
        return result(200, { ok: true }, access.session);
      }
      if (!deleted.response.ok) return result(502, { error: 'Unable to delete the authentication account.' }, access.session);
      return result(200, { ok: true }, access.session);
    }

    const updates = {};
    if (payload.name !== undefined) {
      const name = String(payload.name).trim();
      if (!name || name.length > 120) return result(400, { error: 'Name must be between 1 and 120 characters.' }, access.session);
      updates.name = name;
    }
    if (payload.role !== undefined) {
      const role = String(payload.role).trim().toLowerCase();
      if (!roles.has(role)) return result(400, { error: 'Unsupported user role.' }, access.session);
      if (isMainTarget || ((role === 'administrator' || user.role === 'administrator') && !isMainAdmin(access.session.user))) {
        return result(403, { error: 'Only the main administrator can grant or revoke administrator privileges.' }, access.session);
      }
      updates.role = role;
    }
    if (payload.is_active !== undefined) {
      if (typeof payload.is_active !== 'boolean') return result(400, { error: 'is_active must be a boolean.' }, access.session);
      if (isSelf && !payload.is_active) return result(400, { error: 'You cannot deactivate your own account.' }, access.session);
      if (isMainTarget) return result(403, { error: 'The main administrator account cannot be deactivated.' }, access.session);
      if (user.role === 'administrator' && !isMainAdmin(access.session.user)) {
        return result(403, { error: 'Only the main administrator can deactivate or reactivate administrator accounts.' }, access.session);
      }
      updates.is_active = payload.is_active;
    }
    if (!Object.keys(updates).length) return result(400, { error: 'No supported user changes were provided.' }, access.session);

    const authUpdates = {};
    if (updates.name !== undefined || updates.role !== undefined) {
      authUpdates.user_metadata = {
        name: updates.name || user.name,
        role: updates.role || user.role,
        must_change_password: user.must_change_password
      };
    }
    if (updates.is_active !== undefined) {
      authUpdates.ban_duration = updates.is_active ? 'none' : '876000h';
    }
    if (Object.keys(authUpdates).length) {
      const changed = await authAdminRequest(`users/${encodeURIComponent(user.auth_user_id)}`, 'PUT', authUpdates);
      if (!changed.response.ok) return result(502, { error: 'Unable to update the authentication account.' }, access.session);
    }

    const saved = await supabaseRequest(`/rest/v1/users?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(updates)
    });
    if (!Array.isArray(saved.body) || saved.body.length !== 1) return result(404, { error: 'User not found.' }, access.session);
    return result(200, { ok: true, user: publicUser(saved.body[0]) }, access.session);
  } catch (error) {
    console.error('Admin user-management operation failed:', error.message);
    return jsonResponse(500, { error: 'Unable to complete user-management operation.' });
  }
};
