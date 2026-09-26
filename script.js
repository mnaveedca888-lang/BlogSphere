const nav = document.querySelector('.nav');
const menuButton = document.querySelector('.menu-button');
const themeToggle = document.querySelector('.theme-toggle');

const authRecoveryParams = new URLSearchParams(window.location.hash.slice(1));
if (window.location.hostname.endsWith('.netlify.app') && authRecoveryParams.get('type') === 'recovery' && authRecoveryParams.has('access_token') && !window.location.pathname.endsWith('/admin.html')) {
  window.location.replace(`${window.location.origin}/admin.html${window.location.search}${window.location.hash}`);
}

let POSTS = [];
const STATIC_POSTS = [
  {
    id: 'best-laptops-for-developers-2025',
    title: 'The Best Laptops for Developers in 2025',
    category: 'Technology',
    date: 'Sep 12, 2025',
    readTime: '6 min read',
    summary: 'From performance to battery life, here are the top laptops that every developer should consider this year.',
    image: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1400&q=80',
    thumb: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=900&q=80',
    tags: ['Laptops', 'Developers', 'Tech', 'Productivity', 'Work From Anywhere']
  },
  {
    id: 'iphone-16-vs-iphone-15',
    title: "iPhone 16 is iPhone 15: What's New?",
    category: 'Technology',
    date: 'Sep 10, 2025',
    readTime: '4 min read',
    summary: 'Apple’s latest iPhone brings several improvements. Here’s a quick comparison to help you decide.',
    image: 'https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?auto=format&fit=crop&w=800&q=80',
    tags: ['iPhone', 'Apple', 'Tech']
  },
  {
    id: 'must-have-vscode-extensions',
    title: '10 Essential VS Code Extensions for Better Productivity',
    category: 'Technology',
    date: 'Sep 8, 2025',
    readTime: '4 min read',
    summary: 'These must-have extensions can save you time and make your coding experience smoother.',
    image: 'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?auto=format&fit=crop&w=800&q=80',
    tags: ['VS Code', 'Developer Tools']
  },
  {
    id: 'smart-home-devices-2025',
    title: 'Smart Home Devices You Should Buy in 2025',
    category: 'Technology',
    date: 'Sep 5, 2025',
    readTime: '5 min read',
    summary: 'Upgrade your living space with the smartest home gadgets that are worth your money.',
    image: 'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=800&q=80',
    tags: ['Smart Home', 'Gadgets']
  },
  {
    id: 'android-apps-for-students',
    title: 'Best Android Apps for Students in 2025',
    category: 'Technology',
    date: 'Sep 2, 2025',
    readTime: '4 min read',
    summary: 'Stay organized, learn faster and boost your productivity with these essential Android apps.',
    image: 'https://images.unsplash.com/photo-1526379095098-d400fd0bf935?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1526379095098-d400fd0bf935?auto=format&fit=crop&w=800&q=80',
    tags: ['Android', 'Students', 'Apps']
  },
  {
    id: 'keep-data-safe-online',
    title: 'How to Keep Your Data Safe Online',
    category: 'Technology',
    date: 'Aug 30, 2025',
    readTime: '5 min read',
    summary: 'Simple steps to protect your personal data and avoid common cyber threats.',
    image: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=800&q=80',
    tags: ['Security', 'Cyber Security']
  },
  {
    id: 'future-of-ai-2025',
    title: 'The Future of AI: What to Expect in 2025 and Beyond',
    category: 'Technology',
    date: 'Aug 28, 2025',
    readTime: '6 min read',
    summary: 'From smarter tools to new jobs, here’s what AI is shaping for the future.',
    image: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=800&q=80',
    tags: ['AI', 'Innovation']
  },
  {
    id: 'improve-laptop-performance',
    title: "How to Improve Your Laptop's Performance",
    category: 'Technology',
    date: 'Sep 11, 2025',
    readTime: '2 min read',
    summary: 'Quick adjustments can make your machine faster, cooler, and more responsive.',
    image: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=800&q=80',
    tags: ['Laptop', 'Performance']
  },
  {
    id: 'top-10-must-have-apps-2025',
    title: 'Top 10 Must-Have Apps for 2025',
    category: 'Technology',
    date: 'Sep 9, 2025',
    readTime: '4 min read',
    summary: 'The apps that help with productivity, creativity, and better everyday workflows.',
    image: 'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?auto=format&fit=crop&w=800&q=80',
    tags: ['Apps', 'Productivity']
  },
  {
    id: 'getting-started-with-python-2025',
    title: 'Getting Started with Python in 2025',
    category: 'Technology',
    date: 'Sep 7, 2025',
    readTime: '5 min read',
    summary: 'A practical guide to learning the language, the tools, and the best next steps.',
    image: 'https://images.unsplash.com/photo-1526379095098-d400fd0bf935?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1526379095098-d400fd0bf935?auto=format&fit=crop&w=800&q=80',
    tags: ['Python', 'Programming']
  },
  {
    id: 'grow-online-business',
    title: '5 Proven Strategies to Grow Your Online Business',
    category: 'Business',
    date: 'Sep 10, 2025',
    readTime: '4 min read',
    summary: 'Simple, high-impact growth tactics that can help you attract more customers and build a stronger brand.',
    image: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=800&q=80',
    tags: ['Marketing', 'Growth']
  },
  {
    id: 'team-productivity-tools',
    title: 'The Power of Productivity Tools for Teams',
    category: 'Business',
    date: 'Sep 8, 2025',
    readTime: '3 min read',
    summary: 'Improve project flow and communication with the tools that keep distributed teams aligned.',
    image: 'https://images.unsplash.com/photo-1556157382-97eda2d62296?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1556157382-97eda2d62296?auto=format&fit=crop&w=800&q=80',
    tags: ['Productivity', 'Teams']
  },
  {
    id: 'smart-money-habits',
    title: 'Smart Money Habits for a Secure Future',
    category: 'Business',
    date: 'Sep 5, 2025',
    readTime: '4 min read',
    summary: 'Build financial confidence with practical habits that help you plan, save and invest wisely.',
    image: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=800&q=80',
    tags: ['Finance', 'Planning']
  },
  {
    id: 'strong-brand-identity',
    title: 'How to Create a Strong Brand Identity',
    category: 'Business',
    date: 'Sep 1, 2025',
    readTime: '5 min read',
    summary: 'Discover the differences between a memorable brand and a forgettable one.',
    image: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80',
    tags: ['Branding', 'Marketing']
  },
  {
    id: 'small-business-marketing-tactics',
    title: 'Best Marketing Tactics for Small Businesses',
    category: 'Business',
    date: 'Aug 28, 2025',
    readTime: '5 min read',
    summary: 'Use focused customer strategies to make your message stand out without overspending.',
    image: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=800&q=80',
    tags: ['Marketing', 'Small Business']
  },
  {
    id: 'leadership-skills-entrepreneurs',
    title: 'Leadership Skills Every Entrepreneur Needs',
    category: 'Business',
    date: 'Aug 22, 2025',
    readTime: '4 min read',
    summary: 'Strong leadership is a habit built through clarity, communication and consistency.',
    image: 'https://images.unsplash.com/photo-1556157382-97eda2d62296?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1556157382-97eda2d62296?auto=format&fit=crop&w=800&q=80',
    tags: ['Leadership', 'Entrepreneurship']
  },
  {
    id: 'scalable-business-model',
    title: 'How to Build a Scalable Business Model',
    category: 'Business',
    date: 'Aug 18, 2025',
    readTime: '6 min read',
    summary: 'Structure your company so it can grow without losing quality, focus, or speed.',
    image: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=800&q=80',
    tags: ['Strategy', 'Business Model']
  },
  {
    id: 'modern-home-decor-ideas',
    title: '10 Simple Home Decor Ideas for a Modern Look',
    category: 'Home Decor',
    date: 'Sep 6, 2025',
    readTime: '3 min read',
    summary: 'Create a cleaner, warmer, and more stylish home with functional decor updates that feel effortless.',
    image: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=800&q=80',
    tags: ['Decor', 'Styling']
  },
  {
    id: 'cozy-bedroom-retreat',
    title: 'How to Create a Cozy Bedroom Retreat',
    category: 'Home Decor',
    date: 'Sep 4, 2025',
    readTime: '4 min read',
    summary: 'Turn your bedroom into a restful space with soft textures, mood lighting, and thoughtful styling.',
    image: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=800&q=80',
    tags: ['Bedroom', 'Styling']
  },
  {
    id: 'indoor-plants-that-improve-your-home',
    title: 'Indoor Plants That Improve Your Home',
    category: 'Home Decor',
    date: 'Sep 2, 2025',
    readTime: '3 min read',
    summary: 'Bring life and freshness into your space with low-maintenance plants that look beautiful and feel calming.',
    image: 'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?auto=format&fit=crop&w=800&q=80',
    tags: ['Plants', 'Interior']
  },
  {
    id: 'small-space-decorating-tips',
    title: 'Small Space Decorating Tips That Maximize Style',
    category: 'Home Decor',
    date: 'Aug 30, 2025',
    readTime: '4 min read',
    summary: 'Use clever layouts, light colors, and multipurpose pieces to make a compact space feel bigger.',
    image: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=800&q=80',
    tags: ['Small Space', 'Decor']
  },
  {
    id: 'fresh-living-room-color-schemes',
    title: 'Top Color Schemes for a Fresh Living Room',
    category: 'Home Decor',
    date: 'Aug 27, 2025',
    readTime: '5 min read',
    summary: 'Explore neutral and bold pairings that create warmth and balance in your primary living space.',
    image: 'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=800&q=80',
    tags: ['Color', 'Living Room']
  },
  {
    id: 'weekend-diy-home-projects',
    title: 'Simple DIY Home Projects for a Weekend Update',
    category: 'Home Decor',
    date: 'Aug 24, 2025',
    readTime: '4 min read',
    summary: 'Refresh your living spaces with quick upgrades that don’t require a full renovation.',
    image: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=800&q=80',
    tags: ['DIY', 'Weekend Project']
  },
  {
    id: 'minimalist-home-without-feeling-cold',
    title: 'How to Style a Minimalist Home Without It Feeling Cold',
    category: 'Home Decor',
    date: 'Aug 20, 2025',
    readTime: '6 min read',
    summary: 'A minimalist home can still feel warm, personal, and inviting with the right textures and accents.',
    image: 'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1200&q=80',
    thumb: 'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=800&q=80',
    tags: ['Minimalism', 'Interior Design']
  }
];

const PAGE_CATEGORY = {
  Technology: 'Technology.html',
  Business: 'Business.html',
  'Home Decor': 'Home-Decor.html',
  'Make Money Online': 'Make-Money-Online.html'
};

const normalize = (value = '') => value.toLowerCase().trim();
const normalizeForLookup = (value = '') => value.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

const getPageName = () => window.location.pathname.split('/').pop();

const findPostByTitle = (title = '') => {
  const normalizedTitle = normalizeForLookup(title);
  if (!normalizedTitle) return null;

  return POSTS.find((post) => normalizeForLookup(post.title) === normalizedTitle || normalizeForLookup(post.title).includes(normalizedTitle) || normalizedTitle.includes(normalizeForLookup(post.title))) || null;
};

const getUrlParams = () => new URLSearchParams(window.location.search);

const buildStoryCard = (post) => {
  const categoryClass = post.category === 'Business' ? 'business-pill' : post.category === 'Home Decor' ? 'decor-pill' : post.category === 'Make Money Online' ? 'money-pill' : '';
  return `
    <article class="story-card" data-post-id="${post.id}" role="link" tabindex="0">
      <div class="story-image" style="background-image:url('${post.thumb}')"></div>
      <div class="story-body">
        <span class="pill ${categoryClass}">${post.category}</span>
        <h3>${post.title}</h3>
        <div class="meta-row compact">
          <span>${post.date}</span>
          <span class="meta-divider">•</span>
          <span>${post.readTime}</span>
        </div>
      </div>
    </article>
  `;
};

const buildTechArticleCard = (post) => `
  <article class="tech-article" data-post-id="${post.id}" role="link" tabindex="0">
    <div class="article-thumb" style="background-image:url('${post.thumb}')"></div>
    <div class="article-copy">
      <span class="article-label">${post.category}</span>
      <h3>${post.title}</h3>
      <p>${post.summary}</p>
      <div class="article-meta">
        <span class="calendar" aria-hidden="true"></span>
        <span>${post.date}</span>
        <span class="meta-dot" aria-hidden="true"></span>
        <span>${post.readTime}</span>
      </div>
    </div>
  </article>
`;

const buildPopularCard = (post) => `
  <li>
    <a href="article.html?id=${post.id}">
      <span class="mini-thumb" style="background-image:url('${post.thumb}')"></span>
      <span class="popular-copy">
        <strong>${post.title}</strong>
        <small>${post.date}</small>
      </span>
    </a>
  </li>
`;

const matchesQuery = (post, query) => {
  if (!query) return true;
  const haystacks = [post.title, post.category, post.summary, post.date, ...(post.tags || [])];
  return haystacks.some((value) => normalize(value).includes(normalize(query)));
};

const getPostTimestamp = (post) => {
  const timestamp = Date.parse(post.published_at || post.date || post.created_at || '');
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const sortPublishedPosts = (posts) => [...posts]
  .filter((post) => post.status === 'published')
  .sort((first, second) => getPostTimestamp(second) - getPostTimestamp(first) || Number(second.id) - Number(first.id));

const formatPostDate = (post) => {
  const value = post.published_at || post.date || post.created_at;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return post.date || '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const setFeaturedPostContent = (element, post) => {
  const label = element.querySelector('.pill');
  const title = element.querySelector('h1, h3');
  const summary = element.querySelector('.feature-content p');
  const meta = element.querySelector('.meta-row');
  const metaItems = meta ? meta.querySelectorAll('span:not(.meta-divider):not(.meta-icon)') : [];

  element.hidden = !post;
  if (!post) {
    element.removeAttribute('data-post-id');
    return;
  }

  element.setAttribute('data-post-id', post.id);
  element.setAttribute('aria-label', post.title);
  if (label) label.textContent = post.category;
  if (title) title.textContent = post.title;
  if (summary) summary.textContent = post.summary || post.excerpt || '';
  if (element.classList.contains('feature-card')) {
    element.style.backgroundImage = `url('${post.image || post.thumb || ''}')`;
  }
  if (metaItems.length >= 2) {
    metaItems[0].textContent = formatPostDate(post);
    metaItems[1].textContent = post.readTime || '';
  }
};

const renderFeaturedPosts = () => {
  const heroGrid = document.querySelector('.hero-grid');
  const emptyState = document.querySelector('.hero-grid + .empty-state');
  const featureCard = document.querySelector('.hero-grid .feature-card');
  const miniFeatures = document.querySelectorAll('.hero-grid .mini-feature');
  const featuredPosts = sortPublishedPosts(POSTS).slice(0, 4);

  if (!heroGrid || !featureCard) return;

  const hasPosts = featuredPosts.length > 0;
  heroGrid.hidden = !hasPosts;
  if (emptyState) emptyState.hidden = hasPosts;

  setFeaturedPostContent(featureCard, featuredPosts[0]);
  miniFeatures.forEach((element, index) => {
    setFeaturedPostContent(element, featuredPosts[index + 1]);
  });
};

const updateCategoryCounts = () => {
  const categoryList = document.querySelectorAll('.category-list li');
  categoryList.forEach((item) => {
    const countNode = item.querySelector('.count, .category-count');
    if (!countNode) return;
    const link = item.querySelector('a');
    const labelSource = link?.cloneNode(true);
    labelSource?.querySelectorAll('.count, .category-count, .list-icon, .category-bullet').forEach((node) => node.remove());
    const label = labelSource?.textContent.trim() || '';
    const count = POSTS.filter((post) => post.status === 'published' && !post.deleted_at && post.category === label).length;
    countNode.textContent = String(count);
  });
};

const attachArticleNavigation = () => {
  const articleElements = document.querySelectorAll('[data-post-id], .story-card, .tech-article, .mini-feature, .feature-card');

  articleElements.forEach((element) => {
    const explicitPostId = element.getAttribute('data-post-id');
    const post = explicitPostId ? POSTS.find((item) => item.id === explicitPostId) : findPostByTitle(element.querySelector('h3')?.textContent || element.textContent || '');
    if (!post) return;

    if (!explicitPostId) {
      element.setAttribute('data-post-id', post.id);
    }

    const navigate = () => {
      window.location.href = `article.html?id=${post.id}`;
    };

    element.onclick = navigate;
    element.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        navigate();
      }
    };
  });
};

const renderHomePage = () => {
  renderFeaturedPosts();
  const query = getUrlParams().get('q') || '';
  const selectedCategory = getUrlParams().get('category') || 'All';
  const blocks = document.querySelectorAll('.section-block');
  const categories = ['Technology', 'Business', 'Home Decor', 'Make Money Online'];

  blocks.forEach((block, index) => {
    const category = categories[index];
    const row = block.querySelector('.article-row');
    if (!row) return;

    const visible = selectedCategory === 'All' || selectedCategory === category;
    block.style.display = visible ? '' : 'none';

    if (!visible) return;

    const posts = POSTS.filter((post) => post.category === category && matchesQuery(post, query));
    if (!posts.length) {
      row.innerHTML = '<div class="empty-state">No posts found</div>';
      return;
    }

    row.innerHTML = posts.slice(0, 3).map(buildStoryCard).join('');
  });

  document.querySelectorAll('.sidebar .category-list a').forEach((link) => {
    const category = link.textContent.replace(/\d+$/, '').trim();
    const page = PAGE_CATEGORY[category];
    if (page) {
      link.setAttribute('href', `${page}?category=${encodeURIComponent(category)}`);
    }
  });

  updateCategoryCounts();
  attachArticleNavigation();
};

const renderCategoryPage = (category) => {
  const list = document.querySelector('.article-list');
  const query = getUrlParams().get('q') || '';
  if (!list) return;

  const matches = POSTS.filter((post) => post.category === category && matchesQuery(post, query));
  if (!matches.length) {
    list.innerHTML = '<div class="empty-state">No posts found</div>';
  } else {
    list.innerHTML = matches.map(buildTechArticleCard).join('');
  }

  const popularList = document.querySelector('.tech-sidebar .popular-list');
  if (popularList) {
    const popularPosts = POSTS.filter((post) => post.category === category).slice(0, 5);
    popularList.innerHTML = popularPosts.map(buildPopularCard).join('');
    document.querySelectorAll('.tech-sidebar .popular-list a').forEach((link) => {
      const postId = link.getAttribute('href').split('id=')[1];
      if (postId) link.setAttribute('href', `article.html?id=${postId}`);
    });
  }

  document.querySelectorAll('.category-list a').forEach((link) => {
    const categoryText = link.textContent.replace(/\d+$/, '').trim();
    const page = PAGE_CATEGORY[categoryText];
    if (page) link.setAttribute('href', `${page}?category=${encodeURIComponent(categoryText)}`);
  });

  updateCategoryCounts();
  attachArticleNavigation();
};

const buildArticleContent = (post) => {
  if (/<(?:h[1-6]|p|ul|ol|blockquote|img)\b/i.test(post.content || '')) return post.content;
  if (post.category === 'Technology') {
    return `
      <h2>Why the Right Laptop Matters for Developers</h2>
      <p>As a developer, your machine is more than just a device — it is your coding environment, testing ground, and creative workspace. Picking the right hardware can make a significant difference in how quickly you ship ideas and how comfortably you work through long sessions.</p>
      <p>In a fast-moving digital landscape, performance, battery life, display quality, and portability all matter. Whether you are writing code, running containers, or collaborating with a team, the right laptop helps you stay focused and productive without unnecessary frustration.</p>
      <h3>Key Features to Look For</h3>
      <ul>
        <li><strong>Performance:</strong> A fast CPU and enough memory for modern development workflows.</li>
        <li><strong>Display:</strong> Clear visuals and accurate colors help during long design and engineering sessions.</li>
        <li><strong>Battery Life:</strong> A reliable battery keeps your setup ready for travel and all-day work.</li>
        <li><strong>Build Quality:</strong> Practical hardware lasts longer and feels more dependable over time.</li>
        <li><strong>Portability:</strong> Lightweight laptops make it easier to work from anywhere without compromise.</li>
      </ul>
      <h2>What to Prioritize Before Buying</h2>
      <ol class="rank-list">
        <li><span class="rank-label">1</span><div><strong>Workflow fit</strong><span>Choose a device that matches your coding style, local tooling, and software requirements.</span></div></li>
        <li><span class="rank-label">2</span><div><strong>Performance balance</strong><span>Look for a laptop that balances CPU power, memory, and battery life without overspending.</span></div></li>
        <li><span class="rank-label">3</span><div><strong>Comfort and ergonomics</strong><span>A good keyboard, low heat, and a pleasant screen can improve productivity over time.</span></div></li>
      </ol>
      <div class="quote-box">
        <h3>Final Thoughts</h3>
        <p>The best choice depends on your budget, priorities, and how you work. The right device should feel fast, dependable, and easy to use every day.</p>
      </div>
    `;
  }

  if (post.category === 'Business') {
    return `
      <h2>Why Strategy Still Matters</h2>
      <p>Business growth depends on clarity, consistency, and strong execution. Even powerful ideas need a structured plan to turn into long-term momentum. Smart founders and teams know that sustainable progress comes from focused decisions.</p>
      <p>Whether you are building an online brand, managing a small team, or improving your workflow, the right systems and habits can dramatically improve outcomes. A solid strategy helps you move faster with less friction.</p>
      <h3>Practical Habits to Build</h3>
      <ul>
        <li><strong>Plan with purpose:</strong> Align daily actions with bigger business goals.</li>
        <li><strong>Track results:</strong> Measure what matters so your decisions are based on evidence.</li>
        <li><strong>Improve collaboration:</strong> Strong communication keeps teams aligned and motivated.</li>
        <li><strong>Invest in systems:</strong> The right tools reduce noise and save time.</li>
      </ul>
      <h2>How to Grow Without Losing Focus</h2>
      <ol class="rank-list">
        <li><span class="rank-label">1</span><div><strong>Start with a clear offer</strong><span>People buy clarity. Make your value proposition easy to understand and easy to trust.</span></div></li>
        <li><span class="rank-label">2</span><div><strong>Use the right tools</strong><span>Productivity systems and analytics help your business run more smoothly.</span></div></li>
        <li><span class="rank-label">3</span><div><strong>Protect your time</strong><span>High-impact work deserves focus, and focus brings momentum.</span></div></li>
      </ol>
      <div class="quote-box">
        <h3>Final Thoughts</h3>
        <p>A healthy business is built on systems, discipline, and a deep understanding of the customer. Small improvements compound over time and create sustainable growth.</p>
      </div>
    `;
  }

  if (post.category === 'Make Money Online') {
    return `<p>${post.content || post.summary || ''}</p>`;
  }

  return `
    <h2>Create a Space You Truly Enjoy</h2>
    <p>Your home should feel personal, comfortable, and visually calming. Tiny design updates can transform the mood of a room without requiring a full renovation. The goal is not perfection — it is a space that supports your daily life.</p>
    <p>Thoughtful decor helps you blend beauty with function. Soft textures, natural light, intentional color choices, and useful storage all make a room feel more welcoming while making it easier to live in.</p>
    <h3>Simple Design Ideas That Work</h3>
    <ul>
      <li><strong>Layer textures:</strong> Mixed fabrics and finishes add warmth without adding clutter.</li>
      <li><strong>Choose a consistent palette:</strong> A simple color rhythm makes a room feel more polished.</li>
      <li><strong>Keep function in view:</strong> Decor should support your routine, not work against it.</li>
      <li><strong>Use lighting intentionally:</strong> Mood lighting can instantly change how a room feels.</li>
    </ul>
    <h2>How to Keep Your Home Feeling Fresh</h2>
    <ol class="rank-list">
      <li><span class="rank-label">1</span><div><strong>Start small</strong><span>Simple updates like pillows, curtains, or wall art can have a major visual impact.</span></div></li>
      <li><span class="rank-label">2</span><div><strong>Balance style and utility</strong><span>Decor should look good and still make everyday life easier.</span></div></li>
      <li><span class="rank-label">3</span><div><strong>Focus on comfort</strong><span>Warm, welcoming spaces feel better to live in and to return to each day.</span></div></li>
    </ol>
    <div class="quote-box">
      <h3>Final Thoughts</h3>
      <p>A beautiful home is not about following rules — it is about creating a place that supports comfort, personality, and everyday joy.</p>
    </div>
  `;
};

const renderArticlePage = () => {
  const articleId = getUrlParams().get('id') || 'best-laptops-for-developers-2025';
  const post = POSTS.find((item) => item.id === articleId) || POSTS[0];

  const featureImage = document.querySelector('.article-feature-image');
  const titleNode = document.getElementById('article-title');
  const summaryNode = document.getElementById('article-summary');
  const categoryNode = document.getElementById('article-category');
  const dateNode = document.getElementById('article-date');
  const contentNode = document.getElementById('article-content');
  const breadcrumbs = document.querySelector('.article-breadcrumbs');
  const tagNode = document.querySelector('.article-tags');
  const popularList = document.querySelector('.article-sidebar .popular-list');
  const relatedList = document.querySelector('.related-list');

  if (featureImage) featureImage.style.backgroundImage = `url('${post.image}')`;
  if (titleNode) titleNode.textContent = post.title;
  if (summaryNode) summaryNode.textContent = post.summary;
  if (categoryNode) categoryNode.textContent = post.category;
  if (dateNode) dateNode.textContent = post.date;
  if (contentNode) contentNode.innerHTML = buildArticleContent(post);
  if (breadcrumbs) {
    breadcrumbs.innerHTML = `
      <a href="index.html">Home</a>
      <span>›</span>
      <a href="${PAGE_CATEGORY[post.category] || 'index.html'}">${post.category}</a>
      <span>›</span>
      <span>${post.title}</span>
    `;
  }
  if (tagNode) {
    tagNode.innerHTML = '<span>Tags:</span> ' + post.tags.map((tag) => `<a href="index.html?q=${encodeURIComponent(tag)}">${tag}</a>`).join(' ');
  }

  if (popularList) {
    const popularPosts = POSTS.filter((item) => item.category === post.category && item.id !== post.id).slice(0, 5);
    popularList.innerHTML = popularPosts.map(buildPopularCard).join('');
  }

  if (relatedList) {
    const relatedPosts = POSTS.filter((item) => item.category === post.category && item.id !== post.id).slice(0, 4);
    relatedList.innerHTML = relatedPosts.map((item) => `
      <li>
        <span class="related-thumb" style="background-image:url('${item.thumb}')"></span>
        <a href="article.html?id=${item.id}">${item.title}</a>
        <span class="related-arrow">›</span>
      </li>
    `).join('');
  }

  document.querySelectorAll('.article-sidebar .category-list a').forEach((link) => {
    const label = link.textContent.replace(/\d+$/, '').trim();
    const page = PAGE_CATEGORY[label];
    if (page) link.setAttribute('href', `${page}?category=${encodeURIComponent(label)}`);
  });

  updateCategoryCounts();
  attachArticleNavigation();
};

const bindTheme = () => {
  const getStoredTheme = () => {
    const savedTheme = localStorage.getItem('blogsphere-theme');
    if (savedTheme === 'dark' || savedTheme === 'light') return savedTheme;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };

  const applyTheme = (theme) => {
    const isDark = theme === 'dark';
    document.body.classList.toggle('theme-dark', isDark);
    document.body.classList.toggle('theme-light', !isDark);
    document.body.setAttribute('data-theme', theme);

    if (themeToggle) {
      const icon = themeToggle.querySelector('.theme-toggle-icon');
      if (icon) icon.textContent = isDark ? '☀' : '☾';
      themeToggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
      themeToggle.setAttribute('aria-pressed', String(isDark));
    }

    localStorage.setItem('blogsphere-theme', theme);
  };

  applyTheme(getStoredTheme());

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const nextTheme = document.body.classList.contains('theme-dark') ? 'light' : 'dark';
      applyTheme(nextTheme);
    });
  }
};

const bindMobileMenu = () => {
  if (!nav || !menuButton) return;

  const syncMenuState = () => {
    const open = nav.classList.contains('is-open');
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
  };

  menuButton.addEventListener('click', () => {
    nav.classList.toggle('is-open');
    syncMenuState();
  });

  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      nav.classList.remove('is-open');
      syncMenuState();
    });
  });

  syncMenuState();
};

const bindSearchFocus = () => {
  const triggerButton = document.querySelector('.search-button');
  const searchInput = document.querySelector('.sidebar-search-input, .search-box input');
  if (!triggerButton || !searchInput) return;

  triggerButton.addEventListener('click', () => {
    searchInput.focus();
    searchInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
};

const bindSearchInputs = () => {
  const inputs = document.querySelectorAll('.sidebar-search-input, .search-box input');
  inputs.forEach((input) => {
    input.addEventListener('input', () => {
      const query = input.value.trim();
      const currentPage = getPageName();
      const params = getUrlParams();
      if (query) params.set('q', query); else params.delete('q');

      if (currentPage === 'index.html') {
        const url = new URL(window.location.href);
        if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
        window.history.replaceState({}, '', url);
        renderHomePage();
      } else if (['Technology.html', 'Business.html', 'Home-Decor.html', 'Make-Money-Online.html'].includes(currentPage)) {
        const category = currentPage === 'Technology.html' ? 'Technology' : currentPage === 'Business.html' ? 'Business' : currentPage === 'Home-Decor.html' ? 'Home Decor' : 'Make Money Online';
        const url = new URL(window.location.href);
        if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
        url.searchParams.set('category', category);
        window.history.replaceState({}, '', url);
        renderCategoryPage(category);
      } else if (currentPage === 'article.html') {
        const url = new URL(window.location.href);
        if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
        url.pathname = 'index.html';
        window.location.href = url.toString();
      }
    });
  });
};

const bindCategoryLinks = () => {
  document.querySelectorAll('.category-card').forEach((card) => {
    card.addEventListener('click', () => {
      const text = card.querySelector('h3')?.textContent.trim();
      if (!text) return;
      const url = new URL(window.location.href);
      url.pathname = 'index.html';
      url.searchParams.set('category', text);
      url.searchParams.delete('q');
      window.location.href = url.toString();
    });
  });

  document.querySelectorAll('.category-list a').forEach((link) => {
    const label = link.textContent.replace(/\d+$/, '').trim();
    const page = PAGE_CATEGORY[label];
    if (page) {
      link.setAttribute('href', `${page}?category=${encodeURIComponent(label)}`);
    }
  });

  document.querySelectorAll('.view-all').forEach((link) => {
    const relevantCategory = link.closest('.section-block')?.querySelector('h2')?.textContent.trim();
    if (relevantCategory && PAGE_CATEGORY[relevantCategory]) {
      link.setAttribute('href', `${PAGE_CATEGORY[relevantCategory]}?category=${encodeURIComponent(relevantCategory)}`);
    }
  });
};

const bindPopularLinks = () => {
  document.querySelectorAll('.popular-list a').forEach((link) => {
    const href = link.getAttribute('href') || '';
    const strongText = link.querySelector('strong')?.textContent?.trim() || '';
    const match = POSTS.find((post) => post.title === strongText);
    if (match) link.setAttribute('href', `article.html?id=${match.id}`);
    else if (href === '#' || href.includes('article.html') && !href.includes('id=')) {
      link.setAttribute('href', 'index.html');
    }
  });
};

const bindContactForm = () => {
  const form = document.getElementById('contactForm');
  const status = document.getElementById('contactStatus');
  const button = form?.querySelector('button[type="submit"]');
  if (!form || !status || !button) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = '';
    status.className = 'form-status';
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    button.disabled = true;
    button.textContent = 'Sending...';
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form)))
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'We could not send your message.');
      form.reset();
      status.textContent = 'Thank you! Your message has been sent successfully.';
      status.classList.add('is-success');
    } catch (error) {
      status.textContent = error.message;
      status.classList.add('is-error');
    } finally {
      button.disabled = false;
      button.textContent = 'Send Message';
    }
  });
};

const bindFooterLinks = () => {
  document.querySelectorAll('a[href="#"], .view-all[href="#"], .footer-links a, .footer-socials a, .article-socials a, .article-tags a, .prev-post').forEach((link) => {
    if (link.getAttribute('href') === '#') {
      const relevantCategory = link.closest('.section-block')?.querySelector('h2')?.textContent.trim();
      if (relevantCategory && PAGE_CATEGORY[relevantCategory]) {
        link.setAttribute('href', `${PAGE_CATEGORY[relevantCategory]}?category=${encodeURIComponent(relevantCategory)}`);
        return;
      }
      link.setAttribute('href', 'index.html');
    }
  });
};

const loadPublicPosts = async () => {
  const endpoints = ['/.netlify/functions/api-public-data', '/api/public-data'];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) continue;
      const data = await response.json();
      POSTS = Array.isArray(data.posts) ? data.posts : [];
      return;
    } catch (error) {
      continue;
    }
  }
  POSTS = [];
};

const refreshPublicPosts = async () => {
  await loadPublicPosts();
  if (getPageName() === 'index.html') renderHomePage();
};

const initializePage = async () => {
  await loadPublicPosts();
  bindPopularLinks();
  const pageName = getPageName();

  if (pageName === 'index.html') {
    renderHomePage();
  } else if (pageName === 'Technology.html') {
    renderCategoryPage('Technology');
  } else if (pageName === 'Business.html') {
    renderCategoryPage('Business');
  } else if (pageName === 'Home-Decor.html') {
    renderCategoryPage('Home Decor');
  } else if (pageName === 'Make-Money-Online.html') {
    renderCategoryPage('Make Money Online');
  } else if (pageName === 'article.html') {
    renderArticlePage();
  }

};

bindTheme();
bindMobileMenu();
bindSearchFocus();
bindSearchInputs();
bindCategoryLinks();
bindFooterLinks();
bindContactForm();
initializePage();

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshPublicPosts();
});
