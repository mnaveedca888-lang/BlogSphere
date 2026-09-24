-- BlogSphere Supabase schema for active runtime data only
-- Based on the current SQLite app behavior in server.js and the actual live DB rows.

CREATE TABLE IF NOT EXISTS categories (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'administrator',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS posts (
  id BIGSERIAL PRIMARY KEY,
  title TEXT,
  slug TEXT UNIQUE,
  excerpt TEXT,
  content TEXT,
  featured_image TEXT,
  category TEXT,
  category_id BIGINT REFERENCES categories(id),
  tags JSONB NOT NULL DEFAULT '[]',
  author TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  meta_title TEXT,
  meta_description TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_deleted_at ON posts(deleted_at);
CREATE INDEX IF NOT EXISTS idx_posts_category_id ON posts(category_id);
CREATE INDEX IF NOT EXISTS idx_posts_published_at ON posts(published_at);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Active categories required by the current app.
INSERT INTO categories (name, slug, description)
VALUES
  ('Technology', 'technology', 'Tech, gadgets and digital trends.'),
  ('Business', 'business', 'Business growth and strategy.'),
  ('Home Decor', 'home-decor', 'Interior inspiration and styling.'),
  ('Make Money Online', 'make-money-online', 'Practical online income and digital business ideas.')
ON CONFLICT (name) DO NOTHING;

-- Notes:
-- This schema intentionally excludes legacy SQLite tables that are not part of the active runtime path:
-- comments, media, pages, settings.
