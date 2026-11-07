-- Unapplied production migration for authenticated dashboard user management
-- and moderated public comments. Review and apply only after approval.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.users FROM anon, authenticated;
GRANT ALL ON public.users TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.users_id_seq TO service_role;

UPDATE public.users AS profile
SET auth_user_id = auth_user.id
FROM auth.users AS auth_user
WHERE profile.auth_user_id IS NULL
  AND lower(profile.email) = lower(auth_user.email);

UPDATE public.users
SET role = lower(role)
WHERE role IS NOT NULL AND role <> lower(role);

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS author_user_id BIGINT
  REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_posts_author_user_id
  ON public.posts(author_user_id);

WITH uniquely_named_authors AS (
  SELECT lower(btrim(name)) AS normalized_name, min(id) AS user_id
  FROM public.users
  WHERE role = 'author' AND NULLIF(btrim(name), '') IS NOT NULL
  GROUP BY lower(btrim(name))
  HAVING count(*) = 1
)
UPDATE public.posts AS post
SET author_user_id = author.user_id
FROM uniquely_named_authors AS author
WHERE post.author_user_id IS NULL
  AND lower(btrim(COALESCE(post.author, ''))) = author.normalized_name;

CREATE TABLE IF NOT EXISTS public.comments (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  author_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  website TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reply TEXT,
  reply_at TIMESTAMPTZ,
  moderator_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  rate_limit_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_comments_post_status_created
  ON public.comments(post_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_comments_rate_limit_created
  ON public.comments(rate_limit_hash, created_at);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'blog-images',
  'blog-images',
  true,
  8388608,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comments FROM anon, authenticated;
GRANT ALL ON public.comments TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.comments_id_seq TO service_role;

-- Netlify Functions use the Supabase service role after validating requests
-- and permissions. Anonymous visitors never write directly to this table.
