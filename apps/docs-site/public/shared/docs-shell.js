(function () {
  var pages = Array.prototype.slice.call(document.querySelectorAll('.page'));
  var sidebarLinks = Array.prototype.slice.call(document.querySelectorAll('.sb-link'));
  // Default page is whichever page's own sidebar link comes first in this module's nav —
  // keeps this script generic across every module's doc page rather than hardcoding one id.
  var DEFAULT_PAGE = sidebarLinks.length ? sidebarLinks[0].dataset.page : '';
  var contentEl = document.getElementById('content');
  var breadcrumbEl = document.getElementById('breadcrumb');
  var tocNav = document.getElementById('tocNav');

  var trackNames = { client: 'Client', admin: 'Super Admin', dev: 'Developer' };

  // Explicit hash -> element-id map, built from the sidebar links themselves,
  // so page ids never have to match the shape of their hash path.
  var hashToId = {};
  var idToHash = {};
  sidebarLinks.forEach(function (a) {
    var hash = a.getAttribute('href').replace(/^#\/?/, '');
    hashToId[hash] = 'page-' + a.dataset.page;
    idToHash[a.dataset.page] = hash;
  });

  function buildToc(article) {
    tocNav.innerHTML = '';
    var heads = article.querySelectorAll('h2[id], h3[id]');
    if (!heads.length) {
      tocNav.innerHTML = '<p style="color:var(--text-faint);font-size:.8rem;">No subsections</p>';
      return;
    }
    heads.forEach(function (h) {
      var a = document.createElement('a');
      a.href = '#';
      a.textContent = h.textContent;
      a.className = h.tagName.toLowerCase() === 'h3' ? 'h3' : '';
      a.addEventListener('click', function (e) {
        e.preventDefault();
        h.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
          block: 'start',
        });
      });
      tocNav.appendChild(a);
    });
  }

  function render() {
    var hash = location.hash.replace(/^#\/?/, '');
    var id = hashToId[hash] || 'page-' + DEFAULT_PAGE;
    var target = document.getElementById(id) || document.getElementById('page-' + DEFAULT_PAGE);
    pages.forEach(function (p) {
      p.classList.toggle('active', p === target);
    });
    sidebarLinks.forEach(function (a) {
      a.classList.toggle('active', a.dataset.page === target.id.replace('page-', ''));
    });

    var track = target.dataset.track;
    var title = target.dataset.title;
    var moduleName = document.body.dataset.module || '';
    breadcrumbEl.innerHTML =
      moduleName +
      ' <span class="sep">/</span> ' +
      (trackNames[track] || '') +
      ' <span class="sep">/</span> ' +
      title;

    buildToc(target);
    contentEl.scrollTop = 0;
    window.scrollTo(0, 0);
    if (document.getElementById('sidebar').classList.contains('open')) {
      document.getElementById('sidebar').classList.remove('open');
    }
  }

  window.addEventListener('hashchange', render);
  render();

  // ---- Theme toggle ----
  var themeBtn = document.getElementById('themeToggle');
  function currentTheme() {
    try {
      return localStorage.getItem('erp-docs-theme');
    } catch (e) {
      return null;
    }
  }
  var stored = currentTheme();
  if (stored) {
    document.documentElement.setAttribute('data-theme', stored);
  }
  themeBtn.addEventListener('click', function () {
    var isDark = getComputedStyle(document.documentElement).colorScheme.indexOf('dark') !== -1;
    var next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('erp-docs-theme', next);
    } catch (e) {}
  });

  // ---- Print ----
  document.getElementById('printBtn').addEventListener('click', function () {
    window.print();
  });

  // ---- Nav toggle (mobile) ----
  document.getElementById('navToggle').addEventListener('click', function () {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // ---- Search ----
  var index = pages.map(function (p) {
    return {
      id: p.id.replace('page-', ''),
      title: p.dataset.title,
      track: p.dataset.track,
      text: p.textContent.replace(/\s+/g, ' ').toLowerCase(),
    };
  });
  var input = document.getElementById('searchInput');
  var results = document.getElementById('searchResults');

  function snippet(text, q) {
    var i = text.indexOf(q);
    if (i < 0) return text.slice(0, 90) + '…';
    var start = Math.max(0, i - 40);
    return (start > 0 ? '…' : '') + text.slice(start, i + 70) + '…';
  }

  input.addEventListener('input', function () {
    var q = input.value.trim().toLowerCase();
    if (!q) {
      results.classList.remove('open');
      results.innerHTML = '';
      return;
    }
    var matches = index
      .filter(function (p) {
        return p.text.indexOf(q) !== -1 || p.title.toLowerCase().indexOf(q) !== -1;
      })
      .slice(0, 8);
    if (!matches.length) {
      results.innerHTML = '<div class="search-empty">No matches in this module\'s docs.</div>';
    } else {
      results.innerHTML = matches
        .map(function (m) {
          var hash = '#' + (idToHash[m.id] || '');
          return (
            '<a href="' +
            hash +
            '"><div class="r-track">' +
            (trackNames[m.track] || '') +
            '</div><div class="r-title">' +
            m.title +
            '</div><div class="r-snip">' +
            snippet(m.text, q) +
            '</div></a>'
          );
        })
        .join('');
    }
    results.classList.add('open');
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      results.classList.remove('open');
      input.blur();
    }
  });
  results.addEventListener('click', function () {
    results.classList.remove('open');
    input.value = '';
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.searchwrap')) results.classList.remove('open');
  });
})();
