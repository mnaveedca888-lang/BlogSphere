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
  Technology: '/Technology',
  Business: '/Business',
  'Home Decor': '/Home-Decor',
  'Make Money Online': '/Make-Money-Online',
  'Health & Fitness': '/Health-Fitness'
};

const getCategoryPageInfo = () => {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  for (const [category, basePath] of Object.entries(PAGE_CATEGORY)) {
    if (pathname.toLowerCase() === basePath.toLowerCase()) {
      return { category, page: 1 };
    }
    const pageMatch = pathname.match(/\/page\/(\d+)$/i);
    if (pageMatch && pathname.slice(0, pageMatch.index).toLowerCase() === basePath.toLowerCase()) {
      return { category, page: Number.parseInt(pageMatch[1], 10) };
    }
  }
  return null;
};

const normalize = (value = '') => value.toLowerCase().trim();
const normalizeForLookup = (value = '') => value.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

const getPageName = () => {
  const categoryPage = getCategoryPageInfo();
  if (categoryPage) return `${PAGE_CATEGORY[categoryPage.category].slice(1)}.html`;

  // Clean article URL /<slug>/ — the static article page is the only page
  // carrying #article-content (about/contact/health-tools share the
  // article-page body class, so the body class alone is not a marker).
  const segments = window.location.pathname.split('/').filter(Boolean);
  if (segments.length === 1 && document.getElementById('article-content')) return 'article.html';
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
  if (String(rawValue || '').trim()) return decodeURIComponent(String(rawValue)).trim();
  // Clean article URL: /<slug>/ (no query string).
  const segments = window.location.pathname.split('/').filter(Boolean);
  if (segments.length === 1 && document.getElementById('article-content')) {
    return decodeURIComponent(segments[0]);
  }
  return '';
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

const getArticleHref = (post) => `/${String(post.slug || post.id)}/`;

// Perf (17 Nov 2026): card slots display thumbs at ~180px tall / ~350px
// wide, so request Pexels thumbs at w=800 instead of the desktop
// w=1260&h=750&dpr=1 (measured: same photo 151,872 B -> 80,445 B, -47%).
// Hero/featured images and OG images keep the original URL. Supabase
// thumbs are left untouched: image transformation is not enabled on that
// bucket (tested 17 Nov 2026 — transform params return the original file
// unchanged), so rewriting them would only add a useless query string.
const cardThumbUrl = (url) => {
  if (typeof url !== 'string' || !url.includes('images.pexels.com')) return url;
  return url.replace(/^([^?]+)\?.*$/, '$1?auto=compress&cs=tinysrgb&w=800');
};

const buildStoryCard = (post) => {
  const categoryClass = post.category === 'Business' ? 'business-pill' : post.category === 'Home Decor' ? 'decor-pill' : post.category === 'Make Money Online' ? 'money-pill' : post.category === 'Health & Fitness' ? 'health-pill' : '';
  return `
    <article class="story-card" data-post-id="${post.id}" data-post-url="${getArticleHref(post)}" role="link" tabindex="0">
      <div class="story-image lazy-bg" data-bg="${cardThumbUrl(post.thumb)}"></div>
      <div class="story-body">
        <span class="pill ${categoryClass}">${post.category}</span>
        <h3><a href="${getArticleHref(post)}">${post.title}</a></h3>
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
      <div class="mini-image lazy-bg" data-bg="${cardThumbUrl(post.thumb)}"></div>
      <div class="mini-copy">
        <span class="pill ${categoryClass}">${post.category}</span>
        <h3><a href="${getArticleHref(post)}">${post.title}</a></h3>
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
    <div class="article-thumb lazy-bg" data-bg="${cardThumbUrl(post.thumb)}"></div>
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
      <span class="mini-thumb lazy-bg" data-bg="${cardThumbUrl(post.thumb)}"></span>
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
  const pathPage = getCategoryPageInfo()?.page || 1;
  const raw = Number.parseInt(getUrlParams().get('page') || String(pathPage), 10);
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
  container.setAttribute('role', 'navigation');
  const pageLink = (page, label, { active = false, disabled = false, ariaLabel, className = '' } = {}) => {
    const classes = ['page-number'];
    if (className) classes.push(className);
    if (active) classes.push('active');
    if (disabled) classes.push('disabled');
    const aria = `${ariaLabel ? ` aria-label="${ariaLabel}"` : ''}${active ? ' aria-current="page"' : ''}${disabled ? ' aria-disabled="true" tabindex="-1"' : ''}`;
    return `<a class="${classes.join(' ')}" href="${buildPageUrl(page)}"${aria}>${label}</a>`;
  };
  const pages = [];
  const addPage = (page, edge = false) => {
    pages.push(pageLink(page, String(page), {
      active: page === currentPage,
      ariaLabel: `Page ${page}`,
      className: `pagination-page${edge ? ' pagination-page--edge' : ''}`
    }));
  };
  const addEllipsis = () => {
    pages.push('<span class="pagination-ellipsis" aria-hidden="true">…</span>');
  };

  if (totalPages <= 7) {
    for (let page = 1; page <= totalPages; page += 1) {
      addPage(page, page === 1 || page === totalPages);
    }
  } else if (currentPage <= 3) {
    for (let page = 1; page <= 4; page += 1) addPage(page, page === 1);
    addEllipsis();
    addPage(totalPages, true);
  } else if (currentPage >= totalPages - 2) {
    addPage(1, true);
    addEllipsis();
    for (let page = totalPages - 3; page <= totalPages; page += 1) {
      addPage(page, page === totalPages);
    }
  } else {
    addPage(1, true);
    addEllipsis();
    for (let page = currentPage - 1; page <= currentPage + 1; page += 1) addPage(page);
    addEllipsis();
    addPage(totalPages, true);
  }

  const previousIcon = '<svg class="pagination-chevron" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="m12 4-6 6 6 6"/></svg>';
  const nextIcon = '<svg class="pagination-chevron" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="m8 4 6 6-6 6"/></svg>';
  container.innerHTML = [
    pageLink(Math.max(1, currentPage - 1), `${previousIcon}<span class="pagination-label">Prev</span>`, {
      disabled: currentPage <= 1,
      ariaLabel: 'Previous page',
      className: 'pagination-previous'
    }),
    ...pages,
    pageLink(Math.min(totalPages, currentPage + 1), `<span class="pagination-label">Next</span>${nextIcon}`, {
      disabled: currentPage >= totalPages,
      ariaLabel: 'Next page',
      className: 'pagination-next'
    })
  ].join('');
};

const refreshRelativeTimeRender = () => {
  updateRelativeTimes();
};

const setFeaturedPostContent = (element, post) => {
  const label = element.querySelector('.pill');
  const title = element.querySelector('h2, h3');
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
  element.setAttribute('data-post-url', getArticleHref(post));
  element.setAttribute('aria-label', post.title);
  if (label) label.textContent = post.category;
  if (title) {
    const titleLink = title.querySelector('a');
    if (titleLink) {
      titleLink.textContent = post.title;
      titleLink.href = getArticleHref(post);
    } else {
      title.textContent = post.title;
    }
  }
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
      link.setAttribute('href', page);
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
    const categoryPath = PAGE_CATEGORY[category];
    if (query) {
      url.pathname = `${categoryPath}/`;
      url.searchParams.set('category', category);
      url.searchParams.set('q', query);
      if (page > 1) url.searchParams.set('page', String(page)); else url.searchParams.delete('page');
    } else {
      url.pathname = page === 1 ? `${categoryPath}/` : `${categoryPath}/page/${page}/`;
      url.searchParams.delete('category');
      url.searchParams.delete('q');
      url.searchParams.delete('page');
    }
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
    if (page) link.setAttribute('href', page);
  });

  updateCategoryCounts();
  attachArticleNavigation();
  observeLazyBackgrounds();
};

// SEO (23 Nov 2026): the same title/description rules the build-time
// static generator uses, so client-side hydration never undoes them.
// Titles are capped at 60 chars at a word boundary, with no site suffix;
// descriptions use the stored meta_description only when it is 120-155
// chars, otherwise they are derived from the excerpt/summary/content.
const truncateAtWord = (text, max) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
};

const plainTextFromHtml = (html) => {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  return (div.textContent || '').replace(/\s+/g, ' ').trim();
};

const articleDescription = (post) => {
  const stored = String(post.meta_description || '').trim();
  if (stored.length >= 120 && stored.length <= 155) return stored;
  const derived = String(post.excerpt || post.summary || '').trim()
    || plainTextFromHtml(post.content || '')
    || stored;
  return truncateAtWord(derived, 155);
};

// Rewrite old internal link forms to the clean URL form, mirroring the
// build-time generator: /article?id=X and /article.html?id=X become /X/,
// *.html category/static links become their clean paths, index.html -> /.
// External links and the old Netlify host are left alone except that the
// Netlify article links are re-pointed at the canonical domain.
const rewriteInternalLinks = (html) => String(html || '')
  .replace(/href="https?:\/\/blogggsphere\.netlify\.app\/article(?:\.html)?\?id=([^"&\s]+)/gi, 'href="https://blogsphere.info/$1/"')
  .replace(/href="https?:\/\/blogsphere\.info\/article(?:\.html)?\?id=([^"&\s]+)/gi, 'href="https://blogsphere.info/$1/"')
  .replace(/href="\/?article(?:\.html)?\?id=([^"&\s]+)/gi, 'href="/$1/"')
  .replace(/href="https?:\/\/blogsphere\.info\/(Technology|Business|Home-Decor|Make-Money-Online|Health-Fitness|about|contact|privacy-policy|terms-and-conditions|disclaimer|editorial-policy)\.html(\?[^"]*)?"/gi, 'href="https://blogsphere.info/$1"')
  .replace(/href="\/(Technology|Business|Home-Decor|Make-Money-Online|Health-Fitness|about|contact|privacy-policy|terms-and-conditions|disclaimer|editorial-policy)\.html(\?[^"]*)?"/gi, 'href="/$1"')
  .replace(/href="\/?index\.html(\?[^"]*)?"/gi, (match, query) => `href="/${query || ''}"`);

const buildArticleContent = (post) => {
  if (!post) return '<p>This post is unavailable.</p>';
  if (post.content && /<(?:h[1-6]|p|ul|ol|blockquote|img)\b/i.test(post.content)) {
    // The page template already shows the title as its H1; drop the body's
    // duplicate opening H1 so the page has a single top-level heading.
    return rewriteInternalLinks(decorateArticleImages(post.content.replace(/^\s*<h1[^>]*>.*?<\/h1>/is, '')));
  }
  if (post.content && post.content.trim()) return rewriteInternalLinks(decorateArticleImages(post.content));
  return '<p>This post is unavailable.</p>';
};

// Perf (17 Nov 2026): decorate stored post-body images at render time.
// Stored HTML has bare <img> tags, so lazy-load every image after the
// first, and add width/height from the image URL's own w/h params when
// present (Pexels thumbs carry them). The 3/2 .article-content img CSS
// box already reserves layout space; these attributes are audit hygiene
// and a pre-CSS fallback, not the layout mechanism. Stored post bodies
// are never edited — this runs on the rendered HTML only.
const decorateArticleImages = (html) => {
  let seen = 0;
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    seen += 1;
    let out = tag;
    if (seen > 1 && !/\bloading\s*=/.test(out)) {
      out = out.replace(/<img\b/i, '<img loading="lazy"');
    }
    if (!/\bwidth\s*=/.test(out) || !/\bheight\s*=/.test(out)) {
      const src = out.match(/\bsrc\s*=\s*"([^"]*)"/i);
      if (src) {
        const w = src[1].match(/[?&;]w=(\d+)/);
        const h = src[1].match(/[?&;]h=(\d+)/);
        if (w && h) {
          if (!/\bwidth\s*=/.test(out)) out = out.replace(/<img\b/i, `<img width="${w[1]}"`);
          if (!/\bheight\s*=/.test(out)) out = out.replace(/<img\b/i, `<img height="${h[1]}"`);
        }
      }
    }
    return out;
  });
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
      prevPostLink.setAttribute('href', PAGE_CATEGORY[post.category] || '/');
      prevPostLink.textContent = `← All ${post.category} Articles`;
    }
  }
  if (breadcrumbs) {
    breadcrumbs.innerHTML = `
      <a href="/">Home</a>
      <span>›</span>
      <a href="${PAGE_CATEGORY[post.category] || '/'}">${post.category}</a>
      <span>›</span>
      <span>${post.title}</span>
    `;
  }
  if (tagNode) {
    tagNode.innerHTML = '<span>Tags:</span> ' + post.tags.map((tag) => `<a href="/?q=${encodeURIComponent(tag)}">${tag}</a>`).join(' ');
  }

  // Sidebar tag card shows this article's own tags, not a fixed Technology list.
  const sidebarTagList = document.querySelector('.article-sidebar-card.tags-card .tag-list');
  if (sidebarTagList && post.tags && post.tags.length) {
    sidebarTagList.innerHTML = post.tags.map((tag) => `<a class="tag" href="/?q=${encodeURIComponent(tag)}">${tag}</a>`).join('');
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
        <span class="related-thumb lazy-bg" data-bg="${cardThumbUrl(item.thumb)}"></span>
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
    if (page) link.setAttribute('href', page);
  });

  updateCategoryCounts();
  attachArticleNavigation();
  loadArticleComments(post.id);
  bindArticleCommentForm(post.id);
};

const updateArticleMeta = (post) => {
  const title = truncateAtWord(post.meta_title || post.title, 60);
  const description = articleDescription(post);
  const url = `${window.location.origin}/${encodeURIComponent(String(post.slug || post.id))}/`;
  const image = post.image || post.thumb || '';
  document.title = title;
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
  const url = `${window.location.origin}/${encodeURIComponent(String(post.slug || post.id))}/`;
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

const bindHomeFaqAccordion = () => {
  const accordion = document.querySelector('.home-faq-list');
  if (!accordion) return;

  const setExpanded = (button, expanded) => {
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    if (!panel) return;

    button.setAttribute('aria-expanded', String(expanded));
    panel.setAttribute('aria-hidden', String(!expanded));
    panel.toggleAttribute('inert', !expanded);
    button.closest('.home-faq-item')?.classList.toggle('is-open', expanded);

    const icon = button.querySelector('.home-faq-toggle');
    if (icon) icon.textContent = expanded ? '−' : '+';

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (expanded) {
      if (reduceMotion) {
        panel.style.height = 'auto';
        return;
      }

      panel.style.height = `${panel.scrollHeight}px`;
      panel.addEventListener('transitionend', (event) => {
        if (event.target === panel && event.propertyName === 'height' && button.getAttribute('aria-expanded') === 'true') {
          panel.style.height = 'auto';
        }
      }, { once: true });
      return;
    }

    if (reduceMotion) {
      panel.style.height = '0px';
      return;
    }

    panel.style.height = `${panel.getBoundingClientRect().height}px`;
    panel.getBoundingClientRect();
    window.requestAnimationFrame(() => {
      if (button.getAttribute('aria-expanded') === 'false') panel.style.height = '0px';
    });
  };

  accordion.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('.home-faq-question') : null;
    if (!button || !accordion.contains(button)) return;

    const shouldExpand = button.getAttribute('aria-expanded') !== 'true';
    accordion.querySelectorAll('.home-faq-question[aria-expanded="true"]').forEach((openButton) => {
      setExpanded(openButton, false);
    });
    if (shouldExpand) setExpanded(button, true);
  });
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
      const category = Object.keys(PAGE_CATEGORY).find((name) => `${PAGE_CATEGORY[name].slice(1)}.html` === currentPage);
      const params = getUrlParams();
      if (query) params.set('q', query); else params.delete('q');

      if (currentPage === 'index.html') {
        const url = new URL(window.location.href);
        if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
        window.history.replaceState({}, '', url);
        renderHomePage();
      } else if (category) {
        const url = new URL(window.location.href);
        url.pathname = `${PAGE_CATEGORY[category]}/`;
        if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
        url.searchParams.set('category', category);
        url.searchParams.delete('page');
        window.history.replaceState({}, '', url);
        renderCategoryPage(category);
      } else if (currentPage === 'article.html') {
        const url = new URL(window.location.href);
        if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
        url.pathname = '/';
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
      window.location.href = PAGE_CATEGORY[text];
    });
  });

  document.querySelectorAll('.category-list a').forEach((link) => {
    const label = link.textContent.replace(/\d+$/, '').trim();
    const page = PAGE_CATEGORY[label];
    if (page) {
      link.setAttribute('href', page);
    }
  });

  document.querySelectorAll('.view-all').forEach((link) => {
    const relevantCategory = link.closest('.section-block')?.querySelector('h2')?.textContent.trim();
    if (relevantCategory && PAGE_CATEGORY[relevantCategory]) {
      link.setAttribute('href', PAGE_CATEGORY[relevantCategory]);
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
      link.setAttribute('href', '/');
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
        link.setAttribute('href', PAGE_CATEGORY[relevantCategory]);
        return;
      }
      link.setAttribute('href', '/');
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
  // /api/public-data works on every host (Netlify redirects it to the
  // function, the local server defines it, Cloudflare serves it), so try
  // it first and keep the direct function path only as a fallback.
  const endpoints = ['/api/public-data?lite=1', '/.netlify/functions/api-public-data?lite=1'];
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
  const base = '/api/public-data';
  const fallback = '/.netlify/functions/api-public-data';
  for (const endpoint of [base, fallback]) {
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


// SEO (16 Nov 2026): set the article canonical as soon as the page loads,
// before the API call returns, so crawlers see the correct canonical even
// if the post data is slow. updateArticleMeta() refines it (title, og tags)
// once the post arrives.
const setEarlyArticleCanonical = () => {
  if (getPageName() !== 'article.html') return;
  const slug = getArticleRequestValue();
  if (!slug) return;
  const url = `${window.location.origin}/${encodeURIComponent(slug)}/`;
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    document.head.appendChild(canonical);
  }
  canonical.setAttribute('href', url);
  const ogUrl = document.querySelector('meta[property="og:url"]');
  if (ogUrl) ogUrl.setAttribute('content', url);
};
setEarlyArticleCanonical();

bindTheme();
bindHomeFaqAccordion();
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

// ---------------------------------------------------------------------------
// Cookie consent — Consent Mode v2 (23 Nov 2026, Phase 2 item 9).
//
// The <head> snippet sets analytics_storage and ad_storage (plus
// ad_user_data and ad_personalization) to 'denied' by default. This manager
// only loads Google Tag Manager (GTM-PRLHQP2K, which carries Google
// Analytics 4, G-YNTT3H5B9Y) and Ahrefs Analytics after the visitor grants
// consent, and it stores the choice in localStorage under
// 'blogsphere-consent-v1'. The banner is shown only when no choice is
// stored; the "Cookie Settings" link in the footer re-opens it.
//
// To replace this custom banner with a Google-certified CMP (required for
// AdSense in the UK/EEA), keep the default-deny <head> snippet and have the
// CMP call window.BlogSphereConsent.update({ analytics, advertising })
// instead of this banner. The CMP script can then remove the banner markup.
// ---------------------------------------------------------------------------
(function initCookieConsent() {
  const STORAGE_KEY = 'blogsphere-consent-v1';
  const GTM_ID = 'GTM-PRLHQP2K';
  const AHREFS_KEY = 'z4g0h2To6z0bXQHI2IPnjg';
  const banner = document.getElementById('cookie-banner');
  if (!banner) return;
  const preferences = document.getElementById('cookie-preferences');
  const manageButtons = document.querySelectorAll('[data-consent-action="manage"]');
  const loaded = { gtm: false, ahrefs: false };

  function loadScript(src, attrs) {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) script.setAttribute(key, value);
    }
    document.head.appendChild(script);
  }

  function loadTracking(consent) {
    // Consent updates go first so GTM initialises with the granted state.
    if (window.gtag) {
      if (consent.analytics) window.gtag('consent', 'update', { analytics_storage: 'granted' });
      if (consent.advertising) {
        window.gtag('consent', 'update', {
          ad_storage: 'granted',
          ad_user_data: 'granted',
          ad_personalization: 'granted'
        });
      }
    }
    // GTM carries both analytics and advertising tags, so it loads when
    // either category is granted. Ahrefs is analytics-only.
    if ((consent.analytics || consent.advertising) && !loaded.gtm) {
      loaded.gtm = true;
      loadScript(`https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`);
    }
    if (consent.analytics && !loaded.ahrefs) {
      loaded.ahrefs = true;
      loadScript('https://analytics.ahrefs.com/analytics.js', { 'data-key': AHREFS_KEY });
    }
  }

  function storeConsent(consent) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
    } catch (err) {
      // Storage unavailable (private mode); the banner will show again.
    }
  }

  function readStoredConsent() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.analytics === 'boolean' && typeof parsed.advertising === 'boolean') return parsed;
      return null;
    } catch (err) {
      return null;
    }
  }

  function hideBanner() {
    banner.hidden = true;
    if (preferences) preferences.hidden = true;
    manageButtons.forEach((button) => button.setAttribute('aria-expanded', 'false'));
  }

  function showBanner(openPreferences) {
    banner.hidden = false;
    if (openPreferences && preferences) {
      syncCheckboxes(readStoredConsent());
      preferences.hidden = false;
      manageButtons.forEach((button) => button.setAttribute('aria-expanded', 'true'));
    }
  }

  function syncCheckboxes(consent) {
    const analyticsBox = banner.querySelector('[data-consent-category="analytics"]');
    const advertisingBox = banner.querySelector('[data-consent-category="advertising"]');
    if (analyticsBox) analyticsBox.checked = Boolean(consent && consent.analytics);
    if (advertisingBox) advertisingBox.checked = Boolean(consent && consent.advertising);
  }

  function applyConsent(consent) {
    storeConsent(consent);
    loadTracking(consent);
    hideBanner();
  }

  function readPreferencesForm() {
    const analyticsBox = banner.querySelector('[data-consent-category="analytics"]');
    const advertisingBox = banner.querySelector('[data-consent-category="advertising"]');
    return {
      analytics: Boolean(analyticsBox && analyticsBox.checked),
      advertising: Boolean(advertisingBox && advertisingBox.checked)
    };
  }

  // One document-level handler covers the banner buttons and the footer
  // "Cookie Settings" button (both use data-consent-action).
  document.addEventListener('click', (event) => {
    const button = event.target && event.target.closest ? event.target.closest('[data-consent-action]') : null;
    if (!button) return;
    const action = button.getAttribute('data-consent-action');
    if (action === 'accept-all') {
      applyConsent({ analytics: true, advertising: true });
    } else if (action === 'reject-all') {
      applyConsent({ analytics: false, advertising: false });
    } else if (action === 'manage') {
      if (banner.hidden) {
        showBanner(true);
      } else if (preferences) {
        const opening = preferences.hidden;
        if (opening) syncCheckboxes(readStoredConsent());
        preferences.hidden = !opening;
        manageButtons.forEach((item) => item.setAttribute('aria-expanded', String(opening)));
      }
    } else if (action === 'save') {
      applyConsent(readPreferencesForm());
    }
  });

  // Apply a stored choice silently; otherwise show the banner.
  const stored = readStoredConsent();
  if (stored) {
    loadTracking(stored);
  } else {
    showBanner(false);
  }

  // Hook for a future Google-certified CMP: it can apply consent directly
  // and hide this banner (see the <head> comment).
  window.BlogSphereConsent = {
    update(consent) {
      applyConsent({
        analytics: Boolean(consent && consent.analytics),
        advertising: Boolean(consent && consent.advertising)
      });
    },
    show() {
      showBanner(true);
    }
  };
})();
