const nav = document.querySelector('.nav');
const menuButton = document.querySelector('.menu-button');
const themeToggle = document.querySelector('.theme-toggle');

const authRecoveryParams = new URLSearchParams(window.location.hash.slice(1));
if (window.location.hostname.endsWith('.netlify.app') && authRecoveryParams.get('type') === 'recovery' && authRecoveryParams.has('access_token') && !window.location.pathname.endsWith('/admin.html')) {
  window.location.replace(`${window.location.origin}/admin.html${window.location.search}${window.location.hash}`);
}

const PAGE_SIZE = 15;

let POSTS = [];
let ARTICLE_POST = null;
let lastPublicLoadAt = 0;

const PAGE_CATEGORY = {
  Technology: 'Technology.html',
  Business: 'Business.html',
  'Home Decor': 'Home-Decor.html',
  'Make Money Online': 'Make-Money-Online.html',
  'Health & Fitness': 'Health-Fitness.html'
};

const normalize = (value = '') => value.toLowerCase().trim();
const normalizeForLookup = (value = '') => value.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

const getPageName = () => {
  const pageName = window.location.pathname.split('/').pop() || 'index.html';
  const cleanRoutes = {
    index: 'index.html',
    technology: 'Technology.html',
    business: 'Business.html',
    'home-decor': 'Home-Decor.html',
    'make-money-online': 'Make-Money-Online.html',
    'health-fitness': 'Health-Fitness.html',
    article: 'article.html'
  };
  return cleanRoutes[pageName.toLowerCase()] || pageName;
};

const findPostByTitle = (title = '') => {
  const normalizedTitle = normalizeForLookup(title);
  if (!normalizedTitle) return null;

  return POSTS.find((post) => normalizeForLookup(post.title) === normalizedTitle || normalizeForLookup(post.title).includes(normalizedTitle) || normalizedTitle.includes(normalizeForLookup(post.title))) || null;
};

const getUrlParams = () => new URLSearchParams(window.location.search);

const getArticleRequestValue = () => {
  const params = getUrlParams();
  const rawValue = params.get('id') ?? params.get('slug') ?? '';
  return decodeURIComponent(String(rawValue || '')).trim();
};

const findArticlePost = (articleId) => {
  if (!articleId) return null;
  const lookup = articleId.trim();
  const normalizedLookup = normalizeForLookup(lookup);
  const matchesLookup = (item) => {
    const itemId = String(item.id || '');
    const itemSlug = String(item.slug || '');
    const itemTitle = String(item.title || '');
    return itemId === lookup || itemSlug === lookup || normalizeForLookup(itemSlug) === normalizedLookup || normalizeForLookup(itemTitle) === normalizedLookup;
  };

  // The single-post fetch carries the full article body; prefer it.
  if (ARTICLE_POST && matchesLookup(ARTICLE_POST)) return ARTICLE_POST;

  return POSTS.find((item) => {
    if (!isPubliclyVisiblePost(item)) return false;
    return matchesLookup(item);
  }) || null;
};

const getArticleHref = (post) => `article.html?id=${encodeURIComponent(String(post.slug || post.id))}`;

const buildStoryCard = (post) => {
  const categoryClass = post.category === 'Business' ? 'business-pill' : post.category === 'Home Decor' ? 'decor-pill' : post.category === 'Make Money Online' ? 'money-pill' : post.category === 'Health & Fitness' ? 'health-pill' : '';
  return `
    <article class="story-card" data-post-id="${post.id}" data-post-url="${getArticleHref(post)}" role="link" tabindex="0">
      <div class="story-image lazy-bg" data-bg="${post.thumb}"></div>
      <div class="story-body">
        <span class="pill ${categoryClass}">${post.category}</span>
        <h3>${post.title}</h3>
        <div class="meta-row compact">
          <span class="rel-time" data-ts="${post.published_at || post.created_at || post.date || ''}">${formatPostDate(post)}</span>
          <span class="meta-divider">•</span>
          <span>${post.readTime}</span>
        </div>
      </div>
    </article>
  `;
};

const buildMiniFeature = (post) => {
  const categoryClass = post.category === 'Business' ? 'business-pill' : post.category === 'Home Decor' ? 'decor-pill' : post.category === 'Make Money Online' ? 'money-pill' : post.category === 'Health & Fitness' ? 'health-pill' : '';
  return `
    <article class="mini-feature" data-post-id="${post.id}" data-post-url="${getArticleHref(post)}" role="link" tabindex="0">
      <div class="mini-image lazy-bg" data-bg="${post.thumb}"></div>
      <div class="mini-copy">
        <span class="pill ${categoryClass}">${post.category}</span>
        <h3>${post.title}</h3>
        <div class="meta-row compact">
          <span class="rel-time" data-ts="${post.published_at || post.created_at || post.date || ''}">${formatPostDate(post)}</span>
          <span class="meta-divider">•</span>
          <span>${post.readTime}</span>
        </div>
      </div>
    </article>
  `;
};

const buildTechArticleCard = (post) => `
  <a class="tech-article" href="${getArticleHref(post)}" data-post-id="${post.id}" data-post-url="${getArticleHref(post)}">
    <div class="article-thumb lazy-bg" data-bg="${post.thumb}"></div>
    <div class="article-copy">
      <span class="article-label">${post.category}</span>
      <h3>${post.title}</h3>
      <p>${post.summary}</p>
      <div class="article-meta">
        <span class="calendar" aria-hidden="true"></span>
        <span class="rel-time" data-ts="${post.published_at || post.created_at || post.date || ''}">${formatPostDate(post)}</span>
        <span class="meta-dot" aria-hidden="true"></span>
        <span>${post.readTime}</span>
      </div>
    </div>
  </a>
`;

const buildPopularCard = (post) => `
  <li>
    <a href="${getArticleHref(post)}">
      <span class="mini-thumb lazy-bg" data-bg="${post.thumb}"></span>
      <span class="popular-copy">
        <strong>${post.title}</strong>
        <small class="rel-time" data-ts="${post.published_at || post.created_at || post.date || ''}">${formatPostDate(post)}</small>
      </span>
    </a>
  </li>
`;

const isPubliclyVisiblePost = (post) => {
  if (!post) return false;
  const status = String(post.status || '').trim().toLowerCase();
  const deletedValue = post.deleted_at ?? post.deletedAt ?? '';
  const deletedText = String(deletedValue).trim().toLowerCase();
  const isDeleted = deletedValue !== null && deletedValue !== undefined && deletedValue !== '' && deletedText !== 'null';
  return status === 'published' && !isDeleted;
};

const matchesQuery = (post, query) => {
  if (!query) return true;
  const haystacks = [post.title, post.category, post.summary, post.date, ...(post.tags || [])];
  return haystacks.some((value) => normalize(value).includes(normalize(query)));
};

const getPostTimestamp = (post) => {
  const rawValue = post?.published_at ?? post?.created_at ?? post?.date ?? '';
  const timestamp = Date.parse(rawValue);
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const sortPublishedPosts = (posts) => [...posts]
  .filter(isPubliclyVisiblePost)
  .sort((first, second) => getPostTimestamp(second) - getPostTimestamp(first) || Number(second.id) - Number(first.id));

const formatDisplayDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
};

const formatRelativeTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const diffMs = Date.now() - date.getTime();
  const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);

  if (totalMinutes < 1) return 'just now';
  if (totalMinutes === 1) return '1 min ago';
  if (totalMinutes < 60) return `${totalMinutes} mins ago`;
  if (totalHours === 1) return '1 hr ago';
  if (totalHours < 24) return `${totalHours} hrs ago`;
  if (totalDays === 1) return '1 day ago';
  return `${totalDays} days ago`;
};

const formatPostDate = (post) => formatRelativeTime(post?.published_at || post?.created_at || post?.date);

// Card thumbnails are background images, which cannot lazy-load natively, so
// they are painted only when they scroll near the viewport. Above-the-fold
// images (hero, article feature image) are loaded eagerly instead.
let lazyBgObserver = null;
const observeLazyBackgrounds = () => {
  const targets = document.querySelectorAll('.lazy-bg[data-bg]:not([data-bg-loaded])');
  if (!targets.length) return;
  if (!('IntersectionObserver' in window)) {
    targets.forEach((el) => { el.style.backgroundImage = `url('${el.dataset.bg}')`; el.dataset.bgLoaded = 'true'; });
    return;
  }
  if (!lazyBgObserver) {
    lazyBgObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        el.style.backgroundImage = `url('${el.dataset.bg}')`;
        el.dataset.bgLoaded = 'true';
        lazyBgObserver.unobserve(el);
      });
    }, { rootMargin: '200px' });
  }
  targets.forEach((el) => lazyBgObserver.observe(el));
};

// Relative times ("3 hrs ago") are refreshed in place instead of re-rendering
// whole pages, which used to rebuild the DOM and re-request images every 15s.
const updateRelativeTimes = () => {
  document.querySelectorAll('.rel-time[data-ts]').forEach((node) => {
    const value = node.getAttribute('data-ts');
    if (value) node.textContent = formatRelativeTime(value);
  });
};

// Real pagination: 15 articles per page, with working Prev / number / Next
// links that keep the category and search query in the URL.
const getCurrentPage = (totalPages) => {
  const raw = Number.parseInt(getUrlParams().get('page') || '1', 10);
  if (Number.isNaN(raw) || raw < 1) return 1;
  return Math.min(raw, Math.max(totalPages, 1));
};

const renderPagination = (container, currentPage, totalPages, buildPageUrl) => {
  if (!container) return;
  if (totalPages <= 1) {
    container.innerHTML = '';
    container.hidden = true;
    return;
  }
  container.hidden = false;
  const pageLink = (page, label, { active = false, disabled = false } = {}) => {
    const classes = ['page-number'];
    if (active) classes.push('active');
    if (disabled) classes.push('disabled');
    const aria = active ? ' aria-current="page"' : '';
    return disabled
      ? `<span class="${classes.join(' ')}" aria-disabled="true"${aria}>${label}</span>`
      : `<a class="${classes.join(' ')}" href="${buildPageUrl(page)}"${aria}>${label}</a>`;
  };
  const pages = [];
  const windowStart = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
  const windowEnd = Math.min(totalPages, windowStart + 4);
  for (let page = windowStart; page <= windowEnd; page += 1) {
    pages.push(pageLink(page, String(page), { active: page === currentPage }));
  }
  container.innerHTML = [
    pageLink(currentPage - 1, '‹ Prev', { disabled: currentPage <= 1 }),
    ...pages,
    pageLink(currentPage + 1, 'Next ›', { disabled: currentPage >= totalPages })
  ].join('');
};

const refreshRelativeTimeRender = () => {
  updateRelativeTimes();
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
  element.classList.remove('skeleton');

  element.setAttribute('data-post-id', post.id);
  element.setAttribute('aria-label', post.title);
  if (label) label.textContent = post.category;
  if (title) title.textContent = post.title;
  if (summary) summary.textContent = post.summary || post.excerpt || '';
  if (element.classList.contains('feature-card')) {
    const featureImage = element.querySelector('.feature-card-image');
    if (featureImage) {
      featureImage.src = post.image || post.thumb || '';
      featureImage.alt = post.title;
      featureImage.setAttribute('fetchpriority', 'high');
    }
    element.style.backgroundImage = '';
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
  const miniFeatureList = document.querySelector('.hero-grid .stacked-feature-list');
  const featuredPosts = sortPublishedPosts(POSTS).slice(0, 4);

  if (!heroGrid || !featureCard) return;

  const hasPosts = featuredPosts.length > 0;
  heroGrid.hidden = !hasPosts;
  if (emptyState) emptyState.hidden = hasPosts;

  setFeaturedPostContent(featureCard, featuredPosts[0]);
  if (miniFeatureList) miniFeatureList.innerHTML = featuredPosts.slice(1).map(buildMiniFeature).join('');
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
    const explicitUrl = element.getAttribute('data-post-url');
    const post = explicitPostId ? POSTS.find((item) => String(item.id) === String(explicitPostId)) : findPostByTitle(element.querySelector('h3')?.textContent || element.textContent || '');
    if (!post && !explicitUrl) return;

    if (!explicitPostId && post) {
      element.setAttribute('data-post-id', post.id);
    }

    const targetUrl = explicitUrl || getArticleHref(post);
    if (element.tagName === 'A') {
      element.setAttribute('href', targetUrl);
      return;
    }

    const navigate = () => {
      window.location.href = targetUrl;
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

const renderPopularList = (selector, posts, max = 5) => {
  const list = document.querySelector(selector);
  if (!list) return;

  const visiblePosts = posts.filter(isPubliclyVisiblePost).slice(0, max);
  list.innerHTML = visiblePosts.length ? visiblePosts.map(buildPopularCard).join('') : '<li class="empty-state">No published articles available.</li>';
  observeLazyBackgrounds();
};

const renderHomePage = () => {
  renderFeaturedPosts();
  const query = getUrlParams().get('q') || '';
  const selectedCategory = getUrlParams().get('category') || 'All';
  const blocks = document.querySelectorAll('.section-block');
  const categories = ['Technology', 'Business', 'Home Decor', 'Make Money Online', 'Health & Fitness'];
  const hasSinglePost = sortPublishedPosts(POSTS).length === 1;

  const popularCard = document.querySelector('.sidebar .popular-card');
  if (popularCard) popularCard.hidden = hasSinglePost;
  if (!hasSinglePost) renderPopularList('.sidebar .popular-list', POSTS, 5);

  const heroStat = document.getElementById('hero-stat-articles');
  if (heroStat) heroStat.textContent = String(sortPublishedPosts(POSTS).length);

  // "Fresh off the press": the newest articles across all categories.
  const latestGrid = document.querySelector('.latest-grid');
  if (latestGrid) {
    const latest = sortPublishedPosts(POSTS).filter((post) => matchesQuery(post, query)).slice(0, 6);
    latestGrid.innerHTML = latest.length
      ? latest.map(buildStoryCard).join('')
      : '<div class="empty-state">No published articles available.</div>';
    const latestBlock = latestGrid.closest('.latest-block');
    if (latestBlock) latestBlock.hidden = hasSinglePost;
  }

  blocks.forEach((block, index) => {
    if (hasSinglePost) {
      block.hidden = true;
      return;
    }
    block.hidden = false;

    const category = categories[index];
    const row = block.querySelector('.article-row');
    if (!row) return;

    const visible = selectedCategory === 'All' || selectedCategory === category;
    block.style.display = visible ? '' : 'none';

    if (!visible) return;

    row.innerHTML = '';
    const posts = POSTS.filter((post) => isPubliclyVisiblePost(post) && post.category === category && matchesQuery(post, query));
    if (!posts.length) {
      row.innerHTML = '<div class="empty-state">No published articles available in this category.</div>';
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
  observeLazyBackgrounds();
};

const renderCategoryPage = (category) => {
  const list = document.querySelector('.article-list');
  const query = getUrlParams().get('q') || '';
  if (!list) return;

  list.innerHTML = '';
  const matches = POSTS.filter((post) => isPubliclyVisiblePost(post) && post.category === category && matchesQuery(post, query));
  const totalPages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const currentPage = getCurrentPage(totalPages);
  const pagePosts = matches.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  if (!matches.length) {
    list.innerHTML = '<div class="empty-state">No published articles available in this category.</div>';
  } else {
    list.innerHTML = pagePosts.map(buildTechArticleCard).join('');
  }

  const pagination = document.querySelector('.pagination');
  renderPagination(pagination, currentPage, totalPages, (page) => {
    const url = new URL(window.location.href);
    url.searchParams.set('category', category);
    if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
    if (page > 1) url.searchParams.set('page', String(page)); else url.searchParams.delete('page');
    return `${url.pathname}${url.search}`;
  });

  const popularList = document.querySelector('.tech-sidebar .popular-list');
  if (popularList) {
    const popularCard = popularList.closest('.side-card');
    if (popularCard) popularCard.hidden = matches.length <= 1;
    const popularPosts = POSTS.filter((post) => isPubliclyVisiblePost(post) && post.category === category).slice(0, 5);
    popularList.innerHTML = matches.length > 1 && popularPosts.length ? popularPosts.map(buildPopularCard).join('') : '';
  }

  document.querySelectorAll('.category-list a').forEach((link) => {
    const categoryText = link.textContent.replace(/\d+$/, '').trim();
    const page = PAGE_CATEGORY[categoryText];
    if (page) link.setAttribute('href', `${page}?category=${encodeURIComponent(categoryText)}`);
  });

  updateCategoryCounts();
  attachArticleNavigation();
  observeLazyBackgrounds();
};

const buildArticleContent = (post) => {
  if (!post) return '<p>This post is unavailable.</p>';
  if (post.content && /<(?:h[1-6]|p|ul|ol|blockquote|img)\b/i.test(post.content)) {
    // The page template already shows the title as its H1; drop the body's
    // duplicate opening H1 so the page has a single top-level heading.
    return post.content.replace(/^\s*<h1[^>]*>.*?<\/h1>/is, '');
  }
  if (post.content && post.content.trim()) return post.content;
  return '<p>This post is unavailable.</p>';
};

const renderArticlePage = () => {
  const articleId = getArticleRequestValue();
  const post = articleId ? findArticlePost(articleId) : null;

  const article = document.querySelector('.article-card');
  if (!post) {
    if (article) {
      article.innerHTML = '<div class="empty-state" style="padding: 32px 20px;">This post is unavailable.</div>';
    }
    const sidebar = document.querySelector('.article-sidebar');
    if (sidebar) sidebar.hidden = true;
    return;
  }

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

  if (featureImage) {
    const featureSrc = post.image || post.thumb;
    if (featureSrc) {
      featureImage.src = featureSrc;
      featureImage.alt = `Featured image for ${post.title}`;
      featureImage.style.aspectRatio = 'auto';
      featureImage.onerror = () => { featureImage.style.display = 'none'; };
    } else {
      featureImage.style.display = 'none';
    }
  }
  if (titleNode) titleNode.textContent = post.title;
  if (summaryNode) summaryNode.textContent = post.summary;
  if (categoryNode) categoryNode.textContent = post.category;
  if (dateNode) dateNode.textContent = formatPostDate(post);
  const readTimeNode = document.getElementById('article-readtime');
  if (readTimeNode) readTimeNode.textContent = post.readTime || '5 min read';
  if (contentNode) contentNode.innerHTML = buildArticleContent(post);
  updateArticleMeta(post);
  bindArticleShare(post);

  // "Previous Post" goes to the next older article in the same category.
  const prevPostLink = document.querySelector('.prev-post');
  if (prevPostLink) {
    const sameCategory = sortPublishedPosts(POSTS).filter((item) => item.category === post.category);
    const index = sameCategory.findIndex((item) => String(item.id) === String(post.id));
    const previous = index >= 0 ? sameCategory[index + 1] : null;
    if (previous) {
      prevPostLink.setAttribute('href', getArticleHref(previous));
      prevPostLink.textContent = `← ${previous.title}`;
    } else {
      prevPostLink.setAttribute('href', PAGE_CATEGORY[post.category] || 'index.html');
      prevPostLink.textContent = `← All ${post.category} Articles`;
    }
  }
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

  // Sidebar tag card shows this article's own tags, not a fixed Technology list.
  const sidebarTagList = document.querySelector('.article-sidebar-card.tags-card .tag-list');
  if (sidebarTagList && post.tags && post.tags.length) {
    sidebarTagList.innerHTML = post.tags.map((tag) => `<a class="tag" href="index.html?q=${encodeURIComponent(tag)}">${tag}</a>`).join('');
  }

  if (popularList) {
    let popularPosts = POSTS.filter((item) => isPubliclyVisiblePost(item) && item.category === post.category && item.id !== post.id);
    if (!popularPosts.length) popularPosts = sortPublishedPosts(POSTS).filter((item) => item.id !== post.id);
    renderPopularList('.article-sidebar .popular-list', popularPosts, 5);
  }

  if (relatedList) {
    const relatedPosts = POSTS.filter((item) => isPubliclyVisiblePost(item) && item.category === post.category && item.id !== post.id).slice(0, 4);
    const relatedWrap = document.querySelector('.related-wrap');
    if (relatedPosts.length) {
      relatedList.innerHTML = relatedPosts.map((item) => `
      <li>
        <span class="related-thumb lazy-bg" data-bg="${item.thumb}"></span>
        <a href="${getArticleHref(item)}">${item.title}</a>
        <span class="related-arrow">›</span>
      </li>
    `).join('');
      observeLazyBackgrounds();
    } else if (relatedWrap) {
      relatedWrap.style.display = 'none';
    }
  }

  document.querySelectorAll('.article-sidebar .category-list a').forEach((link) => {
    const label = link.textContent.replace(/\d+$/, '').trim();
    const page = PAGE_CATEGORY[label];
    if (page) link.setAttribute('href', `${page}?category=${encodeURIComponent(label)}`);
  });

  updateCategoryCounts();
  attachArticleNavigation();
  loadArticleComments(post.id);
  bindArticleCommentForm(post.id);
};

const updateArticleMeta = (post) => {
  const title = post.meta_title || post.title;
  const description = post.meta_description || post.excerpt || post.summary || '';
  const url = `${window.location.origin}/article.html?id=${encodeURIComponent(String(post.slug || post.id))}`;
  const image = post.image || post.thumb || '';
  document.title = `${title} | BlogSphere`;
  const setMeta = (selector, value) => {
    const node = document.querySelector(selector);
    if (node && value) node.setAttribute('content', value);
  };
  setMeta('meta[name="description"]', description);
  setMeta('meta[property="og:title"]', title);
  setMeta('meta[property="og:description"]', description);
  setMeta('meta[property="og:url"]', url);
  setMeta('meta[property="og:image"]', image);
  setMeta('meta[name="twitter:title"]', title);
  setMeta('meta[name="twitter:description"]', description);
  setMeta('meta[name="twitter:image"]', image);
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    document.head.appendChild(canonical);
  }
  canonical.setAttribute('href', url);
};

const bindArticleShare = (post) => {
  const url = `${window.location.origin}/article.html?id=${encodeURIComponent(String(post.slug || post.id))}`;
  const text = encodeURIComponent(post.title);
  const encodedUrl = encodeURIComponent(url);
  const links = {
    'share-facebook': `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    'share-x': `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${text}`,
    'share-linkedin': `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    'share-pinterest': `https://pinterest.com/pin/create/button/?url=${encodedUrl}&media=${encodeURIComponent(post.image || '')}&description=${text}`
  };
  Object.entries(links).forEach(([id, href]) => {
    const node = document.getElementById(id);
    if (node) {
      node.setAttribute('href', href);
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener');
    }
  });
};

const escapeCommentText = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[character]));

const loadArticleComments = async (postId) => {
  const container = document.getElementById('article-comments');
  if (!container) return;
  container.textContent = 'Loading comments…';
  try {
    const response = await fetch(`/api/comments?post_id=${encodeURIComponent(postId)}`, {
      headers: { Accept: 'application/json' }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Comments could not be loaded (${response.status}).`);
    if (!Array.isArray(data)) throw new Error('The comments service returned an invalid response.');
    container.innerHTML = data.map((comment) => `
      <article class="public-comment" style="padding:12px 0;border-bottom:1px solid #e2e8f0">
        <strong>${escapeCommentText(comment.name)}</strong>
        <small style="margin-left:8px;color:#64748b">${escapeCommentText(formatDisplayDate(comment.created_at))}</small>
        <p style="white-space:pre-wrap">${escapeCommentText(comment.body)}</p>
        ${comment.reply ? `<div class="public-comment-reply" style="margin:8px 0 0 16px;padding:10px;border-left:3px solid #2563eb"><strong>Admin reply</strong><p style="white-space:pre-wrap">${escapeCommentText(comment.reply)}</p></div>` : ''}
      </article>
    `).join('') || '<p>No approved comments yet.</p>';
  } catch (error) {
    container.textContent = error.message;
  }
};

const bindArticleCommentForm = (postId) => {
  const form = document.getElementById('comment-form');
  if (!form || form.dataset.bound === 'true') return;
  form.dataset.bound = 'true';
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = document.getElementById('comment-status');
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    status.textContent = 'Submitting comment…';
    try {
      const response = await fetch(`/api/comments?post_id=${encodeURIComponent(postId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('comment-name').value.trim(),
          email: document.getElementById('comment-email').value.trim(),
          website_url: document.getElementById('comment-website').value.trim(),
          website: document.getElementById('comment-website-check').value,
          body: document.getElementById('comment-body').value.trim()
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Comment submission failed (${response.status}).`);
      status.textContent = data.message || 'Your comment is awaiting moderation.';
      form.reset();
      await loadArticleComments(postId);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
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
  const searchInput = document.querySelector('.hero-search input, .sidebar-search-input, .search-box input');
  if (!triggerButton || !searchInput) return;

  triggerButton.addEventListener('click', () => {
    searchInput.focus();
    searchInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
};

const bindSearchInputs = () => {
  const inputs = document.querySelectorAll('.hero-search input, .sidebar-search-input, .search-box input');
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
  // Category cards on the homepage go to the category page.
  document.querySelectorAll('.category-card').forEach((card) => {
    card.addEventListener('click', () => {
      const text = card.querySelector('h3')?.textContent.trim();
      if (!text || !PAGE_CATEGORY[text]) return;
      window.location.href = `${PAGE_CATEGORY[text]}?category=${encodeURIComponent(text)}`;
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
    if (match) link.setAttribute('href', getArticleHref(match));
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

      const contentType = response.headers.get('content-type') || '';
      const rawText = await response.text();
      let result = {};
      if (rawText) {
        const trimmed = rawText.trim();
        if (trimmed) {
          try {
            result = JSON.parse(trimmed);
          } catch {
            throw new Error(trimmed.length > 180 ? 'Unable to send your message.' : trimmed);
          }
        }
      }

      if (!response.ok || result.ok === false) {
        const message = result && typeof result.message === 'string' && result.message.trim() ? result.message : 'Unable to send your message.';
        throw new Error(message);
      }

      if (!contentType.includes('application/json') && !result.ok) {
        throw new Error('Unable to send your message.');
      }

      form.reset();
      status.textContent = result.message || 'Thank you! Your message has been sent successfully.';
      status.classList.add('is-success');
    } catch (error) {
      status.textContent = error.message || 'Unable to send your message.';
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

let relativeTimeRefreshTimer = null;

const clearRelativeTimeRefreshTimer = () => {
  if (relativeTimeRefreshTimer) {
    clearInterval(relativeTimeRefreshTimer);
    relativeTimeRefreshTimer = null;
  }
};

const loadPublicPosts = async () => {
  const endpoints = ['/api/public-data?lite=1'];
  for (const endpoint of endpoints) {
    try {
      // Lite list: no article bodies, so the payload is ~70KB instead of ~590KB.
      // The response is cacheable (60s) instead of cache-busted on every load.
      const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
      if (!response.ok) continue;
      const data = await response.json();
      POSTS = Array.isArray(data.posts) ? data.posts.filter(isPubliclyVisiblePost) : [];
      lastPublicLoadAt = Date.now();
      return;
    } catch (error) {
      continue;
    }
  }
  POSTS = [];
};

// Article pages fetch the single full post (with its body) by id or slug.
const loadArticlePost = async (articleId) => {
  if (!articleId) return;
  for (const endpoint of ['/api/public-data']) {
    try {
      const response = await fetch(`${endpoint}?id=${encodeURIComponent(articleId)}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) continue;
      const data = await response.json();
      if (data.post) {
        ARTICLE_POST = data.post;
        return;
      }
    } catch (error) {
      continue;
    }
  }
  ARTICLE_POST = null;
};

const refreshPublicPosts = async () => {
  await loadPublicPosts();
  if (getPageName() === 'index.html') renderHomePage();
};

const initializePage = async () => {
  const pageName = getPageName();
  if (pageName === 'article.html') {
    // Article pages need the lite list (related posts, categories) and the
    // single full post (body + meta) in parallel.
    const articleId = getArticleRequestValue();
    await Promise.all([loadPublicPosts(), loadArticlePost(articleId)]);
  } else {
    await loadPublicPosts();
  }
  bindPopularLinks();
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
  } else if (pageName === 'Health-Fitness.html') {
    renderCategoryPage('Health & Fitness');
  } else if (pageName === 'article.html') {
    renderArticlePage();
  }

  clearRelativeTimeRefreshTimer();
  // Relative times update in place once a minute; the page is never rebuilt.
  relativeTimeRefreshTimer = setInterval(() => {
    if (document.hidden) return;
    refreshRelativeTimeRender();
  }, 60000);
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
  if (!document.hidden) {
    // Refetch at most every 5 minutes when the tab regains focus; the list
    // response is cached for 60s, so this is cheap.
    if (Date.now() - lastPublicLoadAt > 5 * 60 * 1000) refreshPublicPosts();
    refreshRelativeTimeRender();
  }
});

window.addEventListener('beforeunload', clearRelativeTimeRefreshTimer);
