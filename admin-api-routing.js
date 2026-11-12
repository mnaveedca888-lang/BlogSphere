function resolveAdminApiRouting({ hostname = '', port = '', platform = 'netlify' } = {}) {
  const localDevelopment = ['localhost', '127.0.0.1'].includes(hostname);
  const netlifyDevelopment = localDevelopment && ['8888', '9999'].includes(port);
  const pagesDevelopment = localDevelopment && ['8787', '8788'].includes(port);
  const expressDevelopment = localDevelopment && !netlifyDevelopment && !pagesDevelopment;
  const netlifyDeployment = netlifyDevelopment || (!pagesDevelopment && platform !== 'cloudflare');

  if (expressDevelopment) {
    return {
      expressDevelopment,
      api: {
        login: '/api/login',
        session: '/api/session',
        logout: '/api/logout',
        posts: '/api/posts',
        categories: '/api/categories',
        upload: '/api/upload',
        comments: '/.netlify/functions/api-admin-comments',
        users: '/.netlify/functions/api-admin-users',
        passwordChange: '/.netlify/functions/api-admin-password-change'
      }
    };
  }

  if (netlifyDeployment) {
    return {
      expressDevelopment,
      api: {
        login: '/.netlify/functions/api-admin-login',
        session: '/.netlify/functions/api-admin-session',
        logout: '/.netlify/functions/api-admin-logout',
        posts: '/.netlify/functions/api-admin-posts',
        categories: '/.netlify/functions/api-admin-categories',
        upload: '/.netlify/functions/api-admin-upload',
        comments: '/.netlify/functions/api-admin-comments',
        users: '/.netlify/functions/api-admin-users',
        passwordChange: '/.netlify/functions/api-admin-password-change',
        recoveryRequest: '/.netlify/functions/api-admin-password-recovery-request',
        recoveryUpdate: '/.netlify/functions/api-admin-password-recovery-update'
      }
    };
  }

  return {
    expressDevelopment,
    api: {
      login: '/api/admin/login',
      session: '/api/admin/session',
      logout: '/api/admin/logout',
      posts: '/api/admin/posts',
      categories: '/api/admin/categories',
      upload: '/api/admin/upload',
      comments: '/api/admin/comments',
      users: '/api/admin/users',
      passwordChange: '/api/admin/password-change',
      recoveryRequest: '/api/admin/password-recovery-request',
      recoveryUpdate: '/api/admin/password-recovery-update'
    }
  };
}

if (typeof window !== 'undefined') {
  window.BlogSphereAdminRouting = { resolveAdminApiRouting };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { resolveAdminApiRouting };
}
