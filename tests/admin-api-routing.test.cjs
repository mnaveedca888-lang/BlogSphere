const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { resolveAdminApiRouting } = require('../admin-api-routing');
const { supportsWrangler } = require('../scripts/check-node-version');

test('deployment config selects Cloudflare Pages Functions', () => {
  assert.equal(
    fs.readFileSync(path.resolve(__dirname, '..', 'deployment-config.js'), 'utf8').replace(/\r\n/g, '\n'),
    "window.BLOGSPHERE_API_PLATFORM = 'cloudflare';\n"
  );
});

test('Cloudflare custom domains and Pages previews use /api routes', () => {
  for (const hostname of ['blogsphere.info', 'www.blogsphere.info', 'blogsphere.pages.dev']) {
    const { api } = resolveAdminApiRouting({ hostname, platform: 'cloudflare' });
    assert.equal(api.login, '/api/admin/login');
    assert.equal(api.recoveryRequest, '/api/admin/password-recovery-request');
    assert.equal(api.posts, '/api/admin/posts');
  }
});

test('admin frontend uses the configured development flag without an undeclared localDevelopment reference', () => {
  const adminScript = fs.readFileSync(path.resolve(__dirname, '..', 'admin-full.js'), 'utf8');
  assert.doesNotMatch(adminScript, /\blocalDevelopment\b/);
  assert.match(adminScript, /request\(postEndpoint\(post\.id\), \{ method: 'DELETE' \}\)/);
});

test('local Netlify, Pages, and Express development select their own API routes', () => {
  const netlify = resolveAdminApiRouting({ hostname: 'localhost', port: '8888', platform: 'cloudflare' });
  assert.equal(netlify.api.login, '/.netlify/functions/api-admin-login');

  const pages = resolveAdminApiRouting({ hostname: '127.0.0.1', port: '8788', platform: 'netlify' });
  assert.equal(pages.api.login, '/api/admin/login');

  const express = resolveAdminApiRouting({ hostname: 'localhost', port: '3000' });
  assert.equal(express.expressDevelopment, true);
  assert.equal(express.api.login, '/api/login');
});

test('Wrangler local development enforces Node.js 22.12 or newer', () => {
  assert.equal(supportsWrangler('v22.11.9'), false);
  assert.equal(supportsWrangler('v22.12.0'), true);
  assert.equal(supportsWrangler('v24.16.0'), true);
  assert.equal(supportsWrangler('not-a-version'), false);
});

test('admin page loads deployment and routing configuration before its application', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'admin-full.html'), 'utf8');
  const deploymentConfig = html.indexOf('/deployment-config.js');
  const routing = html.indexOf('/admin-api-routing.js');
  const application = html.indexOf('/admin-full.js');
  assert.ok(deploymentConfig >= 0 && deploymentConfig < routing);
  assert.ok(routing < application);
});
