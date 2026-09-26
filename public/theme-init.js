(function () {
  var d = document.documentElement;
  var p = 'auto';
  try {
    p = localStorage.getItem('theme-preference');
    if (!p) {
      var legacy = localStorage.getItem('meta-data-theme-mode');
      p = legacy === 'system' ? 'auto' : legacy === 'accessible' ? 'high-contrast' : legacy;
      if (p) { localStorage.setItem('theme-preference', p); localStorage.removeItem('meta-data-theme-mode'); }
    }
    if (['light', 'dark', 'auto', 'high-contrast'].indexOf(p) === -1) p = 'auto';
  } catch (e) { p = 'auto'; }
  var t = p === 'auto' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : p;
  d.setAttribute('data-theme', t);
  d.setAttribute('data-theme-preference', p);
  if (p !== 'auto') {
    var c = t === 'dark' ? '#14130f' : t === 'high-contrast' ? '#000000' : '#edeae5';
    var m = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < m.length; i++) m[i].setAttribute('content', c);
  }
  // Language: the address names it — / is the Russian page, /en/ and /uz/ the other two
  // (src/i18n/locale.ts, keep the two in step). On / a saved choice of another language goes
  // to that page before anything paints; a crawler has no storage and stays where it is. Off
  // the three pages (the 404 page) the saved choice, else the browser's list, decides the
  // `lang` attribute: the first of uz / ru / en the browser names, else ru for kk / ky / tg / be,
  // else en — the same rule as `initialLanguage` in src/i18n/index.tsx.
  var path = location.pathname;
  var fromPath = path === '/' || path === '/index.html' ? 'ru' : /^\/en(\/|$)/.test(path) ? 'en' : /^\/uz(\/|$)/.test(path) ? 'uz' : null;
  var l = null;
  try { l = localStorage.getItem('meta-data-lang'); } catch (e) { /* storage unavailable */ }
  if (l !== 'ru' && l !== 'en' && l !== 'uz') l = null;
  if (fromPath === 'ru' && l && l !== 'ru') {
    location.replace('/' + l + '/' + location.search + location.hash);
  }
  if (fromPath) {
    l = fromPath;
  } else if (!l) {
    var tags = navigator.languages || [navigator.language];
    var bases = [];
    for (var j = 0; j < tags.length; j++) { var b = String(tags[j] || '').toLowerCase().split('-')[0]; if (b) bases.push(b); }
    for (var k = 0; k < bases.length && !l; k++) { if (bases[k] === 'uz' || bases[k] === 'ru' || bases[k] === 'en') l = bases[k]; }
    if (!l) {
      for (var q = 0; q < bases.length && !l; q++) { if (bases[q] === 'kk' || bases[q] === 'ky' || bases[q] === 'tg' || bases[q] === 'be') l = 'ru'; }
    }
    if (!l) l = bases.length > 0 ? 'en' : 'ru';
  }
  d.lang = l;
})();
