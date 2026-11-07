require('dotenv').config();

const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { getPublicData } = require('./netlify/functions/_supabase');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const DB_PATH = path.join(ROOT_DIR, 'blogsphere.db');
const UPLOAD_DIR = path.join(ROOT_DIR, 'uploads');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@blogsphere.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin123!';
const CONTACT_RECIPIENT = 'mnaveedca888@gmail.com';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = new sqlite3.Database(DB_PATH);

const sessionSecret = process.env.SESSION_SECRET || 'blogsphere-session-secret';

function runDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function allDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function getDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function normalizeSlug(value = '') {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizePublishedAt(value, fallback = new Date().toISOString()) {
  if (value === null || value === undefined || value === '') return fallback;
  const trimmed = String(value).trim();
  if (!trimmed) return fallback;

  let parsedDate = null;
  const localMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (localMatch) {
    const [, year, month, day, hours, minutes] = localMatch;
    const localDate = new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes));
    if (!Number.isNaN(localDate.getTime())) parsedDate = localDate;
  }

  if (!parsedDate) {
    parsedDate = new Date(value);
  }

  if (!Number.isNaN(parsedDate.getTime())) {
    const normalized = new Date(parsedDate.getTime());
    const now = Date.now();
    return normalized.getTime() > now ? new Date(now).toISOString() : normalized.toISOString();
  }

  return fallback;
}

function toJson(value, fallback = []) {
  try {
    const parsed = JSON.parse(value || 'null');
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function sanitizeRichText(value = '') {
  const allowedTags = new Set(['a', 'b', 'blockquote', 'br', 'div', 'em', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'li', 'ol', 'p', 's', 'span', 'strike', 'strong', 'u', 'ul']);
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
        const safeStyle = rawValue.split(';').map((rule) => rule.trim()).filter((rule) => /^(text-align|color|background-color|font-weight|font-style|text-decoration(?:-line)?)\s*:\s*[#\w(),.% -]+$/i.test(rule)).join('; ');
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

function getLegacyArticleContent(category) {
  if (category === 'Technology') {
    return `<h2>Why the Right Laptop Matters for Developers</h2><p>As a developer, your machine is more than just a device — it is your coding environment, testing ground, and creative workspace. Picking the right hardware can make a significant difference in how quickly you ship ideas and how comfortably you work through long sessions.</p><p>In a fast-moving digital landscape, performance, battery life, display quality, and portability all matter. Whether you are writing code, running containers, or collaborating with a team, the right laptop helps you stay focused and productive without unnecessary frustration.</p><h3>Key Features to Look For</h3><ul><li><strong>Performance:</strong> A fast CPU and enough memory for modern development workflows.</li><li><strong>Display:</strong> Clear visuals and accurate colors help during long design and engineering sessions.</li><li><strong>Battery Life:</strong> A reliable battery keeps your setup ready for travel and all-day work.</li><li><strong>Build Quality:</strong> Practical hardware lasts longer and feels more dependable over time.</li><li><strong>Portability:</strong> Lightweight laptops make it easier to work from anywhere without compromise.</li></ul><h2>What to Prioritize Before Buying</h2><ol class="rank-list"><li><span class="rank-label">1</span><div><strong>Workflow fit</strong><span>Choose a device that matches your coding style, local tooling, and software requirements.</span></div></li><li><span class="rank-label">2</span><div><strong>Performance balance</strong><span>Look for a laptop that balances CPU power, memory, and battery life without overspending.</span></div></li><li><span class="rank-label">3</span><div><strong>Comfort and ergonomics</strong><span>A good keyboard, low heat, and a pleasant screen can improve productivity over time.</span></div></li></ol><div class="quote-box"><h3>Final Thoughts</h3><p>The best choice depends on your budget, priorities, and how you work. The right device should feel fast, dependable, and easy to use every day.</p></div>`;
  }

  if (category === 'Business') {
    return `<h2>Why Strategy Still Matters</h2><p>Business growth depends on clarity, consistency, and strong execution. Even powerful ideas need a structured plan to turn into long-term momentum. Smart founders and teams know that sustainable progress comes from focused decisions.</p><p>Whether you are building an online brand, managing a small team, or improving your workflow, the right systems and habits can dramatically improve outcomes. A solid strategy helps you move faster with less friction.</p><h3>Practical Habits to Build</h3><ul><li><strong>Plan with purpose:</strong> Align daily actions with bigger business goals.</li><li><strong>Track results:</strong> Measure what matters so your decisions are based on evidence.</li><li><strong>Improve collaboration:</strong> Strong communication keeps teams aligned and motivated.</li><li><strong>Invest in systems:</strong> The right tools reduce noise and save time.</li></ul><h2>How to Grow Without Losing Focus</h2><ol class="rank-list"><li><span class="rank-label">1</span><div><strong>Start with a clear offer</strong><span>People buy clarity. Make your value proposition easy to understand and easy to trust.</span></div></li><li><span class="rank-label">2</span><div><strong>Use the right tools</strong><span>Productivity systems and analytics help your business run more smoothly.</span></div></li><li><span class="rank-label">3</span><div><strong>Protect your time</strong><span>High-impact work deserves focus, and focus brings momentum.</span></div></li></ol><div class="quote-box"><h3>Final Thoughts</h3><p>A healthy business is built on systems, discipline, and a deep understanding of the customer. Small improvements compound over time and create sustainable growth.</p></div>`;
  }

  return `<h2>Create a Space You Truly Enjoy</h2><p>Your home should feel personal, comfortable, and visually calming. Tiny design updates can transform the mood of a room without requiring a full renovation. The goal is not perfection — it is a space that supports your daily life.</p><p>Thoughtful decor helps you blend beauty with function. Soft textures, natural light, intentional color choices, and useful storage all make a room feel more welcoming while making it easier to live in.</p><h3>Simple Design Ideas That Work</h3><ul><li><strong>Layer textures:</strong> Mixed fabrics and finishes add warmth without adding clutter.</li><li><strong>Choose a consistent palette:</strong> A simple color rhythm makes a room feel more polished.</li><li><strong>Keep function in view:</strong> Decor should support your routine, not work against it.</li><li><strong>Use lighting intentionally:</strong> Mood lighting can instantly change how a room feels.</li></ul><h2>How to Keep Your Home Feeling Fresh</h2><ol class="rank-list"><li><span class="rank-label">1</span><div><strong>Start small</strong><span>Simple updates like pillows, curtains, or wall art can have a major visual impact.</span></div></li><li><span class="rank-label">2</span><div><strong>Balance style and utility</strong><span>Decor should look good and still make everyday life easier.</span></div></li><li><span class="rank-label">3</span><div><strong>Focus on comfort</strong><span>Warm, welcoming spaces feel better to live in and to return to each day.</span></div></li></ol><div class="quote-box"><h3>Final Thoughts</h3><p>A beautiful home is not about following rules — it is about creating a place that supports comfort, personality, and everyday joy.</p></div>`;
}

async function ensureDatabase() {
  await runDb(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    password_hash TEXT,
    role TEXT DEFAULT 'administrator',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await runDb(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    slug TEXT UNIQUE,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await runDb(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    slug TEXT UNIQUE,
    excerpt TEXT,
    content TEXT,
    featured_image TEXT,
    category TEXT,
    category_id INTEGER,
    tags TEXT DEFAULT '[]',
    author TEXT,
    status TEXT DEFAULT 'draft',
    meta_title TEXT,
    meta_description TEXT,
    published_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
  )`);

  await createDefaultCategories();
  await ensureAdminUser();

  const shouldSeedDemoData = String(process.env.ALLOW_DEMO_SEED || '').toLowerCase() === 'true';
  if (shouldSeedDemoData) {
    await ensureSeedPosts();
    await ensureMakeMoneyOnlinePosts();
    await migrateLegacyArticleContent();
  }
}

async function createDefaultCategories() {
  const categories = [
    { name: 'Technology', description: 'Tech, gadgets and digital trends.' },
    { name: 'Business', description: 'Business growth and strategy.' },
    { name: 'Home Decor', description: 'Interior inspiration and styling.' },
    { name: 'Make Money Online', description: 'Practical online income and digital business ideas.' }
  ];

  for (const item of categories) {
    const existing = await getDb('SELECT id FROM categories WHERE name = ?', [item.name]);
    if (!existing) {
      await runDb('INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)', [item.name, normalizeSlug(item.name), item.description || '']);
    }
  }
}

async function ensureMakeMoneyOnlinePosts() {
  const category = await getDb('SELECT id, name FROM categories WHERE name = ?', ['Make Money Online']);
  if (!category) return;

  const posts = [
    {
      title: 'Practical Ways to Start Making Money Online',
      slug: 'practical-ways-to-start-making-money-online',
      excerpt: 'A grounded look at online income paths and the first steps needed to build useful digital work.',
      content: 'Making money online usually starts with a useful skill, a clear audience, and consistent effort. This guide breaks down practical starting points without promising overnight results.',
      featured_image: 'https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1200&q=80',
      tags: ['Online Income', 'Freelancing', 'Digital Work']
    },
    {
      title: 'How to Build a Simple Freelance Service',
      slug: 'build-a-simple-freelance-service',
      excerpt: 'Turn a skill you already have into a clear freelance offer that potential clients can understand.',
      content: 'A focused freelance service is easier to explain, price, and improve. Start with a specific problem, a defined result, and a simple way for clients to see what you can do.',
      featured_image: 'https://images.unsplash.com/photo-1521737711867-e3b97375f902?auto=format&fit=crop&w=1200&q=80',
      tags: ['Freelancing', 'Services', 'Work Online']
    },
    {
      title: 'Digital Products That Solve Real Problems',
      slug: 'digital-products-that-solve-real-problems',
      excerpt: 'Learn why useful templates, guides, and tools begin with a real customer problem.',
      content: 'The strongest digital products make a repeated task easier. Before building one, understand who needs it, what they already use, and what a better outcome looks like.',
      featured_image: 'https://images.unsplash.com/photo-1553877522-43269d4ea984?auto=format&fit=crop&w=1200&q=80',
      tags: ['Digital Products', 'Creators', 'Business']
    }
  ];

  for (const post of posts) {
    const existingPost = await getDb('SELECT id FROM posts WHERE slug = ?', [post.slug]);
    if (existingPost) continue;
    const now = new Date().toISOString();
    await runDb(
      `INSERT INTO posts (title, slug, excerpt, content, featured_image, category, category_id, tags, author, status, meta_title, meta_description, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [post.title, post.slug, post.excerpt, post.content, post.featured_image, category.name, category.id, JSON.stringify(post.tags), 'Admin', 'published', post.title, post.excerpt, now, now, now]
    );
  }
}

async function ensureAdminUser() {
  const existing = await getDb('SELECT id FROM users WHERE email = ?', [ADMIN_EMAIL]);
  if (!existing) {
    const hashed = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await runDb('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', ['Admin', ADMIN_EMAIL, hashed, 'administrator']);
    console.log(`Admin account created: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  }
}

async function ensureSeedPosts() {
  const existing = await getDb('SELECT id FROM posts LIMIT 1');
  if (existing) return;

  const posts = [
    {
      title: 'The Best Laptops for Developers in 2025',
      slug: 'best-laptops-for-developers-2025',
      excerpt: 'From performance to battery life, here are the top laptops that every developer should consider this year.',
      content: 'A developer laptop should balance performance, battery life, and portability. In 2025, the strongest machines combine power-efficient chips with comfortable keyboards and durable design.',
      featured_image: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1200&q=80',
      category: 'Technology',
      category_id: 1,
      tags: ['Laptops', 'Developers', 'Tech'],
      author: 'Admin',
      status: 'published',
      published_at: '2025-09-12T00:00:00.000Z',
      meta_title: 'Best Laptops for Developers in 2025',
      meta_description: 'Top laptops for developers in 2025 based on performance, battery life, and portability.'
    },
    {
      title: "iPhone 16 is iPhone 15: What's New?",
      slug: 'iphone-16-vs-iphone-15',
      excerpt: 'Apple’s latest iPhone brings several improvements. Here’s a quick comparison to help you decide.',
      content: 'The iPhone 16 introduces small but useful improvements that add up to a better experience. You may not need a full upgrade if you are already on the 15, but the gains are worthwhile for some users.',
      featured_image: 'https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?auto=format&fit=crop&w=1200&q=80',
      category: 'Technology',
      category_id: 1,
      tags: ['iPhone', 'Apple'],
      author: 'Admin',
      status: 'published',
      published_at: '2025-09-10T00:00:00.000Z',
      meta_title: 'iPhone 16 vs iPhone 15',
      meta_description: 'What is new in the iPhone 16 compared to the iPhone 15.'
    },
    {
      title: '5 Proven Strategies to Grow Your Online Business',
      slug: 'grow-online-business',
      excerpt: 'Simple, high-impact growth tactics that can help you attract more customers and build a stronger brand.',
      content: 'Growth comes from clarity, consistency, and offering real value. Brands that test, learn, and refine their messaging usually win over time.',
      featured_image: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1200&q=80',
      category: 'Business',
      category_id: 2,
      tags: ['Marketing', 'Growth'],
      author: 'Admin',
      status: 'published',
      published_at: '2025-09-10T00:00:00.000Z',
      meta_title: 'Grow Your Online Business',
      meta_description: 'Five practical strategies to grow an online business.'
    },
    {
      title: '10 Simple Home Decor Ideas for a Modern Look',
      slug: 'modern-home-decor-ideas',
      excerpt: 'Create a cleaner, warmer, and more stylish home with functional decor updates that feel effortless.',
      content: 'A modern home does not require a complete overhaul. Small, thoughtful design changes can improve comfort and visual balance across every room.',
      featured_image: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80',
      category: 'Home Decor',
      category_id: 3,
      tags: ['Decor', 'Styling'],
      author: 'Admin',
      status: 'published',
      published_at: '2025-09-06T00:00:00.000Z',
      meta_title: 'Modern Home Decor Ideas',
      meta_description: 'Simple, modern home decor ideas that feel stylish and practical.'
    }
  ];

  for (const post of posts) {
    const existingPost = await getDb('SELECT id FROM posts WHERE slug = ?', [post.slug]);
    if (!existingPost) {
      await runDb(
        `INSERT INTO posts (title, slug, excerpt, content, featured_image, category, category_id, tags, author, status, meta_title, meta_description, published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [post.title, post.slug, post.excerpt, post.content, post.featured_image, post.category, post.category_id, JSON.stringify(post.tags), post.author, post.status, post.meta_title, post.meta_description, post.published_at]
      );
    }
  }
}

async function migrateLegacyArticleContent() {
  const legacyContent = new Map([
    ['A developer laptop should balance performance, battery life, and portability. In 2025, the strongest machines combine power-efficient chips with comfortable keyboards and durable design.', 'Technology'],
    ['The iPhone 16 introduces small but useful improvements that add up to a better experience. You may not need a full upgrade if you are already on the 15, but the gains are worthwhile for some users.', 'Technology'],
    ['Growth comes from clarity, consistency, and offering real value. Brands that test, learn, and refine their messaging usually win over time.', 'Business'],
    ['A modern home does not require a complete overhaul. Small, thoughtful design changes can improve comfort and visual balance across every room.', 'Home Decor']
  ]);
  const rows = await allDb('SELECT id, content, category FROM posts WHERE status = ?', ['published']);
  for (const post of rows) {
    const category = legacyContent.get(post.content);
    if (category) await runDb('UPDATE posts SET content = ? WHERE id = ?', [getLegacyArticleContent(category), post.id]);
  }
}

async function getPublicPosts() {
  const rows = await allDb(`
    SELECT p.*, c.name AS category_name
    FROM posts p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'published' AND p.deleted_at IS NULL
    ORDER BY COALESCE(p.published_at, p.created_at) DESC
  `);

  return rows.map((post) => ({
    id: String(post.id),
    slug: post.slug || normalizeSlug(post.title),
    title: post.title,
    category: post.category_name || post.category || 'Technology',
    category_id: post.category_id,
    category_name: post.category_name || post.category || 'Technology',
    date: post.published_at || post.created_at,
    readTime: '5 min read',
    summary: post.excerpt || '',
    excerpt: post.excerpt || '',
    image: post.featured_image || 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1200&q=80',
    thumb: post.featured_image || 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=900&q=80',
    tags: toJson(post.tags, []),
    content: sanitizeRichText(post.content || ''),
    author: post.author || 'Admin',
    status: post.status,
    meta_title: post.meta_title || post.title,
    meta_description: post.meta_description || post.excerpt,
    published_at: post.published_at || post.created_at,
    created_at: post.created_at,
    updated_at: post.updated_at
  }));
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '-');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only image uploads are allowed.'));
  }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use(express.static(ROOT_DIR));

app.get('/api/session', (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  res.json({ user: req.session.user });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

  const user = await getDb('SELECT * FROM users WHERE email = ?', [String(email).trim().toLowerCase()]);
  if (!user) return res.status(401).json({ error: 'Invalid credentials.' });

  const passwordMatches = await bcrypt.compare(String(password), user.password_hash);
  if (!passwordMatches) return res.status(401).json({ error: 'Invalid credentials.' });

  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  return res.json({ user: req.session.user });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.post('/api/contact', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim();
  const subject = String(req.body?.subject || '').trim();
  const message = String(req.body?.message || '').trim();

  if (!name || !email || !subject || !message) {
    return res.status(400).json({ ok: false, message: 'Name, email, subject, and message are required.' });
  }
  if (name.length > 120 || subject.length > 200 || message.length > 5000 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, message: 'Please provide valid contact information.' });
  }
  const gmailUser = String(process.env.GMAIL_USER || '').trim();
  const gmailAppPassword = String(process.env.GMAIL_APP_PASSWORD || '').trim();
  if (!gmailUser || !gmailAppPassword) {
    return res.status(503).json({ ok: false, message: 'Contact email is not configured. Please try again later.' });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmailUser,
        pass: gmailAppPassword
      }
    });
    await transporter.sendMail({
      from: gmailUser,
      to: CONTACT_RECIPIENT,
      replyTo: email,
      subject: `[BlogSphere Contact] ${subject.replace(/[\r\n]+/g, ' ')}`,
      text: `Visitor name: ${name}\nVisitor email: ${email}\nSubject: ${subject}\nSubmitted: ${new Date().toISOString()}\n\nMessage:\n${message}`
    });
    return res.json({ ok: true, message: 'Your message has been sent successfully.' });
  } catch (error) {
    console.error('Contact email delivery failed:', error.message);
    return res.status(502).json({ ok: false, message: 'Unable to send your message.' });
  }
});

app.get('/api/public-data', async (_, res) => {
  const hasSupabaseConfig = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
    .every((key) => String(process.env[key] || '').trim());

  try {
    if (hasSupabaseConfig) return res.json(await getPublicData());

    const posts = await getPublicPosts();
    const categories = await allDb('SELECT * FROM categories ORDER BY name ASC');
    return res.json({ posts, categories });
  } catch (error) {
    console.error('Public data read failed:', error.message);
    return res.status(503).json({ error: 'Unable to load public data.' });
  }
});

app.get('/api/posts', requireAuth, async (_, res) => {
  const rows = await allDb(`
    SELECT p.*, c.name AS category_name
    FROM posts p
    LEFT JOIN categories c ON c.id = p.category_id
    ORDER BY COALESCE(p.updated_at, p.created_at) DESC
  `);
  res.json(rows.map((post) => ({ ...post, tags: toJson(post.tags, []) })));
});

app.post('/api/posts', requireAuth, async (req, res) => {
  const payload = req.body || {};
  const title = String(payload.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Title is required.' });

  const slug = normalizeSlug(payload.slug || title) || normalizeSlug(Date.now().toString());
  const categoryId = Number(payload.category_id || 0) || null;
  const category = categoryId ? (await getDb('SELECT name FROM categories WHERE id = ?', [categoryId]))?.name || payload.category || 'Technology' : payload.category || 'Technology';

  const tags = Array.isArray(payload.tags) ? JSON.stringify(payload.tags) : JSON.stringify([]);
  const status = (payload.status || 'draft').toLowerCase();
  const now = new Date().toISOString();
  const publishedAt = status === 'published' ? normalizePublishedAt(payload.published_at || now, now) : payload.published_at ? normalizePublishedAt(payload.published_at, null) : null;

  await runDb(
    `INSERT INTO posts (title, slug, excerpt, content, featured_image, category, category_id, tags, author, status, meta_title, meta_description, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, slug, payload.excerpt || '', sanitizeRichText(payload.content || ''), payload.featured_image || '', category, categoryId, tags, payload.author || req.session.user.name || 'Admin', status, payload.meta_title || title, payload.meta_description || payload.excerpt || '', publishedAt, now, now]
  );

  res.status(201).json({ ok: true });
});

app.put('/api/posts/:id', requireAuth, async (req, res) => {
  const post = await getDb('SELECT * FROM posts WHERE id = ?', [req.params.id]);
  if (!post) return res.status(404).json({ error: 'Post not found.' });

  const payload = req.body || {};
  const categoryId = Number(payload.category_id || 0) || null;
  const category = categoryId ? (await getDb('SELECT name FROM categories WHERE id = ?', [categoryId]))?.name || payload.category || 'Technology' : payload.category || post.category || 'Technology';
  const tags = Array.isArray(payload.tags) ? JSON.stringify(payload.tags) : JSON.stringify(toJson(post.tags, []));
  const now = new Date().toISOString();
  const status = (payload.status ?? post.status ?? 'draft').toLowerCase();
  const deletedAt = status === 'published' ? null : post.deleted_at;
  const publishedAt = status === 'published'
    ? normalizePublishedAt(payload.published_at ?? post.published_at ?? now, now)
    : payload.published_at ? normalizePublishedAt(payload.published_at, post.published_at || null) : post.published_at;

  await runDb(
    `UPDATE posts SET title = ?, slug = ?, excerpt = ?, content = ?, featured_image = ?, category = ?, category_id = ?, tags = ?, author = ?, status = ?, meta_title = ?, meta_description = ?, published_at = ?, updated_at = ?, deleted_at = ? WHERE id = ?`,
    [payload.title ?? post.title, payload.slug ?? post.slug ?? normalizeSlug(payload.title ?? post.title), payload.excerpt ?? post.excerpt ?? '', sanitizeRichText(payload.content ?? post.content ?? ''), payload.featured_image ?? post.featured_image ?? '', category, categoryId, tags, payload.author ?? post.author ?? 'Admin', status, payload.meta_title ?? post.meta_title ?? payload.title ?? post.title, payload.meta_description ?? post.meta_description ?? payload.excerpt ?? post.excerpt ?? '', publishedAt, now, deletedAt, req.params.id]
  );

  res.json({ ok: true });
});

app.post('/api/posts/:id/duplicate', requireAuth, async (req, res) => {
  const post = await getDb('SELECT * FROM posts WHERE id = ?', [req.params.id]);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  const slug = normalizeSlug(`${post.slug}-copy-${Date.now()}`);
  await runDb(
    `INSERT INTO posts (title, slug, excerpt, content, featured_image, category, category_id, tags, author, status, meta_title, meta_description, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [`${post.title} Copy`, slug, post.excerpt, post.content, post.featured_image, post.category, post.category_id, post.tags, post.author, 'draft', post.meta_title, post.meta_description, new Date().toISOString()]
  );
  res.json({ ok: true });
});

app.post('/api/posts/:id/publish', requireAuth, async (req, res) => {
  const now = new Date().toISOString();
  await runDb('UPDATE posts SET status = ?, published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?', ['published', now, now, req.params.id]);
  res.json({ ok: true });
});

app.post('/api/posts/:id/draft', requireAuth, async (req, res) => {
  await runDb('UPDATE posts SET status = ?, updated_at = ? WHERE id = ?', ['draft', new Date().toISOString(), req.params.id]);
  res.json({ ok: true });
});

app.post('/api/posts/:id/trash', requireAuth, async (req, res) => {
  await runDb('UPDATE posts SET status = ?, deleted_at = ?, updated_at = ? WHERE id = ?', ['trash', new Date().toISOString(), new Date().toISOString(), req.params.id]);
  res.json({ ok: true });
});

app.post('/api/posts/:id/restore', requireAuth, async (req, res) => {
  const now = new Date().toISOString();
  await runDb('UPDATE posts SET status = ?, deleted_at = NULL, published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?', ['published', now, now, req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/posts/:id', requireAuth, async (req, res) => {
  await runDb('DELETE FROM posts WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/categories', requireAuth, async (_, res) => {
  const rows = await allDb('SELECT * FROM categories ORDER BY name ASC');
  res.json(rows);
});

app.post('/api/upload', requireAuth, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });

    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const url = `/uploads/${req.file.filename}`;
    return res.status(201).json({ url, filename: req.file.originalname });
  });
});

app.get('/admin', (_, res) => {
  res.sendFile(path.join(ROOT_DIR, 'admin-full.html'));
});

app.get('/admin.html', (_, res) => {
  res.sendFile(path.join(ROOT_DIR, 'admin-full.html'));
});

app.get('/api/health', (_, res) => {
  res.json({ ok: true });
});

app.use('/uploads', express.static(UPLOAD_DIR));

ensureDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`BlogSphere CMS running at http://localhost:${PORT}`);
  });
}).catch((error) => {
  console.error('Database initialization failed:', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  db.close(() => process.exit(0));
});
