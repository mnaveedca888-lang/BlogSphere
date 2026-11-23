const CATEGORY_PAGE_SIZE = 15;

function getCategoryPageCount(postCount) {
  return Math.max(1, Math.ceil(postCount / CATEGORY_PAGE_SIZE));
}

function getCategoryPagePath(categoryPath, page) {
  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError(`Invalid category page number: ${page}`);
  }
  const basePath = `/${String(categoryPath).split('/').filter(Boolean).join('/')}`;
  return page === 1 ? `${basePath}/` : `${basePath}/page/${page}/`;
}

function renderCategoryPagination(categoryPath, categoryName, currentPage, totalPages) {
  if (totalPages <= 1) return '';

  const pageLink = (page, label, { active = false, disabled = false, ariaLabel, className = '' } = {}) => {
    const targetPage = disabled ? currentPage : page;
    const classes = ['page-number'];
    if (className) classes.push(className);
    if (active) classes.push('active');
    if (disabled) classes.push('disabled');
    const aria = `${ariaLabel ? ` aria-label="${ariaLabel}"` : ''}${active ? ' aria-current="page"' : ''}${disabled ? ' aria-disabled="true" tabindex="-1"' : ''}`;
    return `<a class="${classes.join(' ')}" href="${getCategoryPagePath(categoryPath, targetPage)}"${aria}>${label}</a>`;
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
  return `<nav class="pagination" aria-label="${categoryName} article pagination">${
    [
      pageLink(currentPage - 1, `${previousIcon}<span class="pagination-label">Prev</span>`, {
        disabled: currentPage <= 1,
        ariaLabel: 'Previous page',
        className: 'pagination-previous'
      }),
      ...pages,
      pageLink(currentPage + 1, `<span class="pagination-label">Next</span>${nextIcon}`, {
        disabled: currentPage >= totalPages,
        ariaLabel: 'Next page',
        className: 'pagination-next'
      })
    ].join('')
  }</nav>`;
}

module.exports = {
  CATEGORY_PAGE_SIZE,
  getCategoryPageCount,
  getCategoryPagePath,
  renderCategoryPagination
};
