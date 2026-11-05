// Progressive enhancement only: every finding is already in the static HTML.
(function () {
  var root = document.documentElement;
  root.classList.add('js');
  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      localStorage.setItem(k, v);
    } catch (e) {
      return null;
    }
    return null;
  }

  // Theme: system by default, manual override remembered per viewer.
  var themeBtns = document.querySelectorAll('[data-theme-choice]');
  function setTheme(t) {
    if (t === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', t);
    themeBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-theme-choice') === t)); });
  }
  setTheme(store('shrine-inspect-theme') || 'system');
  themeBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      var t = b.getAttribute('data-theme-choice');
      store('shrine-inspect-theme', t);
      setTheme(t);
    });
  });

  // Share-safe preview: view only; the share-safe file is the thing to share.
  var safe = document.getElementById('preview-safe');
  if (safe) {
    safe.addEventListener('click', function () {
      var on = safe.getAttribute('aria-pressed') !== 'true';
      safe.setAttribute('aria-pressed', String(on));
      root.classList.toggle('preview-safe', on);
    });
  }

  // Print shows every appendix section, not only the open ones.
  var reopen = [];
  window.addEventListener('beforeprint', function () {
    document.querySelectorAll('details:not([open])').forEach(function (d) { d.open = true; reopen.push(d); });
  });
  window.addEventListener('afterprint', function () {
    reopen.forEach(function (d) { d.open = false; });
    reopen = [];
  });

  // Tabs (ARIA tabs pattern, arrow keys).
  var tablist = document.querySelector('[role="tablist"]');
  if (!tablist) return;
  tablist.hidden = false;
  var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
  function panelOf(tab) { return document.getElementById(tab.getAttribute('aria-controls')); }
  function select(tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      panelOf(t).hidden = !on;
    });
    if (focus) tab.focus();
    var first = panelOf(tab).querySelector('.f-btn');
    if (first) show(first);
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { select(t, false); });
    t.addEventListener('keydown', function (e) {
      var n = tabs.length, j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % n;
      else if (e.key === 'ArrowLeft') j = (i - 1 + n) % n;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = n - 1;
      if (j !== null) { e.preventDefault(); select(tabs[j], true); }
    });
  });

  // Finding list: one detail at a time.
  function show(btn) {
    var panel = btn.closest('[role="tabpanel"]');
    panel.querySelectorAll('.f-btn').forEach(function (b) { b.setAttribute('aria-current', String(b === btn)); });
    panel.querySelectorAll('.detail').forEach(function (d) { d.hidden = d.id !== btn.getAttribute('data-target'); });
  }
  // A pick moves focus to the detail heading (screen readers announce it) and
  // scrolls the detail into view when it starts off screen (stacked phone layout).
  function reveal(btn) {
    var d = document.getElementById(btn.getAttribute('data-target'));
    var h = d && d.querySelector('.title');
    if (!h) return;
    h.tabIndex = -1;
    h.focus({ preventScroll: true });
    var top = d.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.75) d.scrollIntoView({ block: 'start' });
  }
  document.querySelectorAll('.f-btn').forEach(function (b) {
    b.addEventListener('click', function (e) { e.preventDefault(); show(b); reveal(b); });
  });
  var go = document.getElementById('goto');
  if (go) {
    go.addEventListener('click', function (e) {
      var id = go.getAttribute('data-target');
      var btn = document.querySelector('.f-btn[data-target="' + id + '"]');
      if (!btn) return;
      e.preventDefault();
      select(tabs.filter(function (t) { return panelOf(t).contains(btn); })[0] || tabs[0], false);
      show(btn);
      document.getElementById('explorer').scrollIntoView();
      btn.focus();
    });
  }
  var current = tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0] || tabs[0];
  select(current, false);
})();
