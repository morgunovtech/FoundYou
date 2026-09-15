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
  try {
    var l = localStorage.getItem('meta-data-lang');
    if (l === 'ru' || l === 'en' || l === 'uz') d.lang = l;
  } catch (e) { /* storage unavailable: keep the html lang attribute */ }
})();
