# Cloudflare Pages migration preparation

This branch prepares a Pages static build and Pages Functions API while retaining the current Netlify setup and Supabase project. It does not connect GitHub, create Cloudflare resources, deploy, change DNS, or change Supabase.

## What is routed

The Pages function at `functions/api/[[path]].js` adapts each request and response to the existing Netlify handler contract. The original handler implementations remain in `netlify/functions`; the route table is in `functions/api/adapter.cjs`. The more-specific `functions/api/contact.js` handles `/api/contact` directly as a native Pages Function.

| Pages path | Methods handled | Existing handler |
| --- | --- | --- |
| `/api/health` | GET | `api-health` |
| `/api/public-data` | GET | `api-public-data` |
| `/api/posts` | GET | `api-posts` |
| `/api/categories` | GET | `api-categories` |
| `/api/session` | GET | `api-session` |
| `/api/comments` | GET, POST | `api-comments` |
| `/api/contact` | POST | `functions/api/contact.js` |
| `/api/admin/login` | POST | `api-admin-login` |
| `/api/admin/session` | GET | `api-admin-session` |
| `/api/admin/logout` | POST | `api-admin-logout` |
| `/api/admin/posts` | GET, POST, PUT, DELETE | `api-admin-posts` |
| `/api/admin/categories` | GET, POST, PUT, DELETE | `api-admin-categories` |
| `/api/admin/upload` | POST | `api-admin-upload` |
| `/api/admin/comments` | GET, PATCH, DELETE | `api-admin-comments` |
| `/api/admin/users` | GET, POST, PATCH, DELETE | `api-admin-users` |
| `/api/admin/password-change` | POST | `api-admin-password-change` |
| `/api/admin/password-recovery` | POST | `api-admin-password-recovery` (legacy handler) |
| `/api/admin/password-recovery-request` | POST | `api-admin-password-recovery-request` |
| `/api/admin/password-recovery-update` | POST | `api-admin-password-recovery-update` |

`/admin` and `/admin.html` retain their permanent redirects to `/admin-full.html`. Pages `404.html` supplies the custom 404 page. The Pages output is generated from a fixed public-file allowlist; backend source, package files, environment examples, local database files, and migration materials are not copied into it. `_routes.json` limits Functions invocations to `/api/*`.

Pages canonicalizes `.html` requests to extensionless URLs with a permanent redirect. The frontend already maps the extensionless category and article paths back to the existing page identities.

Static cache and `X-Content-Type-Options` rules are reproduced in the generated `_headers`. As in Cloudflare's documented behavior, `_headers` does not apply to Pages Functions; API handlers continue to return their own headers.

The checked-in `deployment-config.js` selects Netlify Functions by default, including on custom domains and Netlify previews. The Pages build replaces its output copy with a Cloudflare marker, so Pages deployments—including `blogsphere.info` after an approved cutover—use `/api/*` without relying on hostname guessing. The admin routing helper also preserves the existing Netlify CLI and Express local-development routes.

## Local checks

Use Node.js 22.12.0 or newer for Wrangler and Pages local development. `npm run pages:dev` runs the Node version check before building or starting Wrangler. From the repository root in PowerShell:

```powershell
node --version
npm ci
npm run check:node
npm test
npm run build:pages
npm run pages:dev
```

Pages dev listens on `http://127.0.0.1:8788`. The build step is also run by `pages:dev`. The automated tests exercise the asset allowlist, all 19 route mappings, request/response adaptation, and the Cloudflare read-only guard without calling Supabase. The guard blocks every non-GET Pages API request unless `BLOGSPHERE_READ_ONLY` is explicitly set to the string `false`; an unset value is read-only.

Do not put the existing project's service-role key or other production credentials in `.dev.vars`, shell history, source files, or Git. Automated tests and the static build need no Supabase credentials; Supabase-backed API calls need runtime bindings. Do not run mutation handlers through Netlify or Express local development, because the Cloudflare-only read-only guard does not apply to those runtimes.

`.dev.vars.example` contains placeholders only and is not required for these checks. Do not copy production keys into `.dev.vars`.

## Supabase Preview API configuration

Public GET handlers (`/api/categories`, `/api/posts`, `/api/public-data`, and `GET /api/comments`) use `SUPABASE_URL` and `SUPABASE_ANON_KEY`. They preserve the existing select/filter and response behavior while applying the existing Supabase anon-role permissions. They no longer require the service-role key just to serve public reads.

Admin and write handlers continue using the existing service-role helper and authorization flow. The Pages adapter's existing `BLOGSPHERE_READ_ONLY` guard is unchanged: when the variable is unset or `true`, non-GET API requests are blocked with `403`; setting it to `false` enables the existing handler behavior. No database policies, schema, data, or credentials are changed by the code.

If existing Supabase grants/RLS do not allow anon reads, the handler will return its existing generic API error after receiving the Supabase response. Do not apply SQL migrations as part of a Pages deployment. Environment changes take effect on a new Pages deployment; the current deployment continues to use its existing bindings.

Keep the Pages preview on its `*.pages.dev` hostname. Do not attach a custom domain or alter production DNS. Preview builds on non-`master` branches replace `robots.txt` with `Disallow: /` and add `X-Robots-Tag: noindex, nofollow`; the `master` build keeps the checked-in production SEO files.

### Preview checks classified by production effect

| Test or route | Classification | Safe action |
| --- | --- | --- |
| Homepage, category/article pages, admin login screen, redirects, 404, static assets | Static read | Check rendering and routing; do not submit forms. |
| `robots.txt`, `sitemap.xml` | Static read / SEO | Confirm preview `robots.txt` disallows crawling and `_headers` applies `noindex`; sitemap retains production canonical URLs. |
| `GET /api/health`, `/api/session` | Static/no-credential API check | Available without Supabase; session endpoint reports logged out. |
| `GET /api/posts`, `/api/categories`, `/api/public-data`, `/api/comments?post_id=…` | Public-read API | Uses the anon key and existing Supabase permissions; returns generic `503` when URL or anon key is absent. |
| `GET /api/admin/posts`, `/categories`, `/comments`, `/users` | Existing admin API | Uses the existing session checks and service-role helper; do not test with production admin sessions. |
| `GET /api/admin/session` without a cookie | Read-only request | Confirms logged-out behavior; returns no user and does not authenticate. |
| `POST /api/admin/login` | Auth side effect | Blocked in Pages preview. A successful Supabase login creates/updates Auth session/sign-in state; no production login test. |
| `POST /api/comments` | Production data write | Blocked. Creates a pending production comment and rate-limit record. |
| `POST /api/contact` | External side effect | Blocked in Pages read-only mode. When enabled, sends email using the configured SMTP bindings. |
| Admin post/category/comment/user create, edit, publish, moderation, delete, password-change and recovery routes | Production data/Auth writes | Blocked. Do not call these endpoints or test destructive actions. |
| `POST /api/admin/upload` | Production Storage write | Blocked. Uploads to the existing Supabase Storage bucket. |
| `POST /api/admin/password-recovery-request` | Email/Auth side effect | Blocked. It sends a real Supabase recovery email; no recovery request or password update test. |

Automated tests run without production credentials and assert that all non-GET methods on every registered Pages route are rejected by default, public reads use only the anon key, admin APIs still require service-role configuration, and the admin session remains logged out. A test that explicitly sets `BLOGSPHERE_READ_ONLY=false` exercises existing handler validation only with an invalid contact payload; it does not send email or call Supabase.

### Authentication, cookies, headers, and SEO findings

- Admin sessions are encrypted with AES-256-GCM and set in an `HttpOnly; Secure; SameSite=Lax` host-only cookie with a seven-day lifetime. `SESSION_SECRET` must be at least 32 characters. Pages and Netlify hostnames do not share cookies.
- Session GET may refresh a Supabase token. Preview checks must not copy a production cookie or sign in with a production account.
- Logout clears the browser cookie; it does not explicitly revoke the Supabase refresh token. Treat this as an existing session-management limitation.
- Recovery links use `SITE_URL` plus `/admin-full.html`. Do not send recovery mail from preview, add preview URLs to production Supabase Auth settings, or change the existing production redirect configuration.
- The repo-level Pages headers reproduce current caching and `X-Content-Type-Options: nosniff` behavior for static files. They do not add CSP, HSTS, `Referrer-Policy`, or frame restrictions, and `_headers` does not apply to Pages Functions. Confirm account-level Cloudflare security settings separately before any production cutover.
- Source `robots.txt` contains `Allow: /` and a production sitemap URL; `sitemap.xml` contains production canonical URLs. Non-`master` Pages builds emit a disallow-all `robots.txt` and `X-Robots-Tag: noindex, nofollow`; do not submit preview URLs to search engines.
- The admin user-creation handler returns a temporary password in its response, and the admin-posts error handler can return PostgREST diagnostic details. Keep authenticated admin APIs private and treat these as existing hardening items before production cutover.

## Contact email and password-recovery risks

The Pages contact route uses Cloudflare's `cloudflare:sockets` TCP API and requires `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `CONTACT_FROM`, and `CONTACT_RECIPIENT` runtime bindings. Port 465 uses direct TLS; it does not issue STARTTLS. Store `SMTP_PASSWORD` as a Cloudflare secret and never put its value in source or local development files. Cloudflare Workers support outbound TCP sockets for SMTP; outbound port 25 is blocked. A contact submission sends real email when Pages writes are enabled, so do not submit production test messages without approval.

Password-recovery request sends a real email through the existing Supabase Auth project, while recovery-update changes the user's production password. Both routes are blocked in read-only Pages mode and must not be used for preview testing.

## Cloudflare account preflight (read-only)

Checked the Cloudflare dashboard on 2026-11-12:

- Account ID shown: `66aaedd3e086b68a7fd9809589932db0`
- Workers & Pages reports **No projects found**; no existing Pages project or BlogSphere resource appeared in the account list.
- The dashboard says Zero Trust must be set up before Access sign-in can be required. Access is not needed for this credential-free static preview; it would be required before any later preview received production Supabase credentials.
- There is no Pages project yet, so a repository-to-Pages GitHub connection is not configured. Account-level GitHub App installation/authorization was not established by this read-only check.
- No Cloudflare resource, Access policy, GitHub connection, or deployment was created.

## Cloudflare Pages configuration (not performed)

- Project name: `blogsphere` (confirm availability in the target account)
- Repository root: `.`
- Build command: `npm run build:pages`
- Build output directory: `dist`
- Node.js: 22.12.0 or newer
- Runtime settings: `wrangler.toml` (`compatibility_date` and Node compatibility flags)
- Production branch: `master`; do not switch production traffic or attach custom domains
- Preview branch: `cloudflare-migration`
- Preview variables for public reads: `SUPABASE_URL` and `SUPABASE_ANON_KEY`; existing Supabase anon-role grants/RLS determine whether reads are allowed. Admin and write handlers retain their existing service-role requirements. Keep `BLOGSPHERE_READ_ONLY=true` (or unset; the adapter defaults to read-only).
- No `blogsphere.info` or `www.blogsphere.info` custom domain

Connecting GitHub or creating Pages resources can trigger builds and has not been done. If approved later, authorize the Cloudflare Workers & Pages GitHub App only for `mnaveedca888-lang/BlogSphere`, configure branch controls before enabling builds, and do not set the read-only flag to `false` without separate approval.

## GitHub branch preparation (not performed)

The migration work remains uncommitted locally. Before a future push:

1. On the current branch, verify `git status --short --branch` reports `cloudflare-migration`; ensure no `.dev.vars`, `.env`, or credentials are staged.
2. After explicit approval only, stage reviewed files, review the staged diff, commit, and push only this branch:

   ```powershell
   git status --short --branch
   git branch --show-current
   git diff --check
   git add -- .gitignore admin-full.html admin-full.js netlify/functions/api-admin-password-recovery-request.js netlify/functions/api-comments.js package-lock.json package.json script.js .dev.vars.example CLOUDFLARE_MIGRATION.md admin-api-routing.js deployment-config.js 'functions/api/[[path]].js' functions/api/adapter.cjs scripts/build-pages.js scripts/check-node-version.js tests/admin-api-routing.test.cjs tests/cloudflare-pages.test.cjs wrangler.toml
   git diff --cached --check
   git diff --cached
   git commit -m "Prepare Cloudflare preview" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
   git push -u origin cloudflare-migration
   ```

   Confirm `git branch --show-current` prints `cloudflare-migration` before the commit or push. Adjust the explicit add list only after reviewing any changed file set; never use `git add .` for this operation.

## Exact next steps after approval

1. Review the read-only Pages adapter and tests; run the local test/build checks.
2. Keep all API and production credentials unset for the static-only preview; no Zero Trust/Access setup is required for this credential-free phase.
3. Commit and push only `cloudflare-migration` after explicit approval, using the commands above.
4. Connect the exact GitHub repository to Pages with `master` as the production branch and `cloudflare-migration` as the only preview branch; keep preview read-only and do not attach custom domains.
5. Keep all Supabase, session, and mail credentials unset; verify missing-credential API responses are `503`, and all writes remain `403`.
6. Test static routes, preview SEO files, asset loading, health, and logged-out admin behavior only.

No Supabase project or data changes, Git commit/push, Cloudflare connection/resource creation, deployment, or DNS changes have been performed.
