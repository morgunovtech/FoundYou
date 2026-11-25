/* morgunov.tech design system — v1 — chrome.js
   The behaviour of the family chrome: the theme (four themes, the
   «theme-preference» key), one dropdown controller for the mobile nav, the
   language menu and the theme menu, and the anchor navigation of .v4-bar-mid.
   Markup and rules: ds/v1/USAGE.md, «Service chrome».
   GENERATED from /script.js by scripts/build-chrome.mjs — edit script.js,
   then run the script with --write. */
(() => {
  const root = document.documentElement;
  const body = document.body;

  /* Stamp «JS is running» — components.css keeps a :focus-within fallback
     that opens the dropdown panels without JavaScript until this attribute
     lands (progressive enhancement for the language switch and mobile nav). */
  root.setAttribute('data-js', '');

  const themeButtons = Array.from(document.querySelectorAll('.v4-theme-btn'));
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const THEME_PREFERENCE_KEY = 'theme-preference';

  /* localStorage access itself throws (SecurityError) when storage is
     blocked — Chrome/Firefox «block all cookies», some embedded webviews.
     The preference then simply doesn't persist; the page keeps working. */
  const storage = {
    get() {
      try { return localStorage.getItem(THEME_PREFERENCE_KEY); } catch (e) { return null; }
    },
    set(value) {
      try { localStorage.setItem(THEME_PREFERENCE_KEY, value); } catch (e) { /* not persisted */ }
    },
  };

  /* Safari ≤13 MediaQueryList implements addListener only — addEventListener
     throws there and would take the rest of the IIFE down with it. */
  const onMediaChange = (mql, handler) => {
    try { mql.addEventListener('change', handler); }
    catch (e) { if (mql.addListener) mql.addListener(handler); }
  };

  /* Browser-chrome colour follows the applied theme. The two static
     <meta name="theme-color"> tags cover `auto` via their media attributes;
     an explicit choice overrides both with the theme's background. */
  const THEME_COLORS = { light: '#edeae5', dark: '#14130f', 'high-contrast': '#000000' };
  const themeColorMetas = Array.from(document.querySelectorAll('meta[name="theme-color"]'));
  const syncThemeColorMeta = (preference, resolved) => {
    themeColorMetas.forEach((meta) => {
      const media = meta.getAttribute('media') || '';
      meta.setAttribute(
        'content',
        preference === 'auto'
          ? (media.indexOf('dark') !== -1 ? THEME_COLORS.dark : THEME_COLORS.light)
          : (THEME_COLORS[resolved] || THEME_COLORS.light)
      );
    });
  };

  /* Remove no-transition only after load — the stylesheets define the theme
     transitions, and enabling them on the first frames would animate every
     surface from its initial state. The guard rule itself is in the inline
     critical CSS, so it holds from the very first frame. */
  const enableTransitions = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        body.classList.remove('no-transition');
      });
    });
  };
  if (document.readyState === 'complete') {
    enableTransitions();
  } else {
    window.addEventListener('load', enableTransitions);
  }

  /* --- Theme --- */

  /* Menu items are role="menuitemradio" — the selected state is aria-checked
     (aria-pressed belongs to toggle buttons, not radio menu items). */
  const setThemeChecked = (value) => {
    themeButtons.forEach((btn) =>
      btn.setAttribute('aria-checked', btn.dataset.themeValue === value ? 'true' : 'false')
    );
  };

  const resolveTheme = (preference) => {
    if (preference === 'auto') return prefersDark.matches ? 'dark' : 'light';
    return preference;
  };

  const applyTheme = (preference) => {
    const resolved = resolveTheme(preference);
    root.setAttribute('data-theme', resolved);
    root.setAttribute('data-theme-preference', preference);
    storage.set(preference);
    syncThemeColorMeta(preference, resolved);
    setThemeChecked(preference);
  };

  /* Inline script in <head> already applied the theme to <html>.
     Only sync the menu's aria-checked state here, without redundant DOM/storage writes. */
  /* With storage blocked the explicit choice lives only in the DOM — the
     inline head script and applyTheme both stamp data-theme-preference on
     <html>, so it is the fallback source of truth after storage. */
  const currentPreference = () =>
    storage.get() || root.getAttribute('data-theme-preference') || 'auto';

  setThemeChecked(currentPreference());

  /* --- Dropdowns: language menu, theme menu, mobile section nav ---
     One mechanism for all three. A .v4-dropdown container holds a toggle
     button ([aria-controls]) and the panel it points at; JS toggles .is-open
     on the container and aria-expanded on the toggle. Only one dropdown is
     open at a time. The <nav> is a dropdown too, but its toggle is hidden on
     desktop (links render inline there), so it is only ever opened on
     mobile. */

  const dropdowns = Array.from(document.querySelectorAll('.v4-dropdown'))
    .map((el) => {
      const toggle = el.querySelector(':scope > [aria-controls]');
      const panel = toggle && document.getElementById(toggle.getAttribute('aria-controls'));
      if (!toggle || !panel) return null;
      return { root: el, toggle, panel, isMenu: panel.getAttribute('role') === 'menu' };
    })
    .filter(Boolean);

  /* The script itself puts focus on a toggle: after a pointer click opens the
     menu (so Escape and the arrows work) and when a menu closes. Chrome then
     paints the keyboard focus ring around a button the visitor has just
     clicked with the mouse. A focus that follows a pointer action is marked
     with data-pointer-focus, and components.css draws no ring on it; any key
     press removes the mark, so keyboard navigation keeps its ring. */
  let byPointer = false;
  document.addEventListener('pointerdown', () => { byPointer = true; }, true);
  document.addEventListener('keydown', () => {
    byPointer = false;
    dropdowns.forEach((d) => d.toggle.removeAttribute('data-pointer-focus'));
  }, true);
  const focusToggle = (d, options) => {
    if (byPointer) d.toggle.setAttribute('data-pointer-focus', '');
    d.toggle.focus(options);
  };

  const setOpen = (d, open) => {
    d.root.classList.toggle('is-open', open);
    d.toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  const closeDropdowns = (except) => {
    dropdowns.forEach((d) => { if (d !== except) setOpen(d, false); });
  };
  const openDropdown = () => dropdowns.find((d) => d.root.classList.contains('is-open'));

  dropdowns.forEach((d) => {
    d.toggle.setAttribute('aria-expanded', 'false');
    d.toggle.addEventListener('blur', () => d.toggle.removeAttribute('data-pointer-focus'));
    /* Safari/Firefox on macOS don't focus a <button> on mousedown — the
       press only BLURS the current focus, so the focusout handler below
       would close the menu before the click ever lands on the item.
       Suppressing the default mousedown focus transfer on the toggle and
       inside an OPEN panel keeps focus where it is; click still fires.
       Scoped that way so the inline desktop nav (never "open") keeps normal
       focus behaviour for its links. */
    d.root.addEventListener('mousedown', (event) => {
      if (d.root.classList.contains('is-open') || d.toggle.contains(event.target)) {
        event.preventDefault();
      }
    });
    d.toggle.addEventListener('click', (event) => {
      const willOpen = !d.root.classList.contains('is-open');
      closeDropdowns(d);
      setOpen(d, willOpen);
      /* Move focus to the first item when opened via keyboard (Enter/Space).
         event.detail === 0 means a synthesised keyboard activation; pointer
         activation reports a positive click count. */
      if (willOpen && event.detail === 0) {
        d.panel.querySelector('button, a')?.focus();
      } else if (willOpen && !d.root.contains(document.activeElement)) {
        /* Pointer open: the mousedown above kept focus where it was (possibly
           on <body>). Park it on the toggle so Escape, arrows and the
           focusout-close work; browsers don't paint :focus-visible after a
           pointer activation, so nothing changes visually. */
        focusToggle(d, { preventScroll: true });
      }
    });
    d.panel.addEventListener('click', (event) => {
      if (!event.target.closest('a, button')) return;
      setOpen(d, false);
      /* Menus (theme, language) hand focus back to their toggle. The mobile
         nav must not: its links move focus to the target section themselves
         (anchor handler below) and refocusing the toggle would yank the
         viewport back up to the header. */
      if (d.isMenu) focusToggle(d);
    });
    /* Tab out of the open dropdown → close it. relatedTarget is the element
       receiving focus; null (e.g. focus left the document) also closes. */
    d.root.addEventListener('focusout', (event) => {
      if (!d.root.contains(event.relatedTarget)) setOpen(d, false);
    });
    d.root.addEventListener('keydown', (event) => {
      if (!d.root.classList.contains('is-open')) return;
      const items = Array.from(d.panel.querySelectorAll('button, a'));
      if (!items.length) return;
      const i = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        items[(i + 1 + items.length) % items.length].focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        items[(i - 1 + items.length) % items.length].focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        items[0].focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        items[items.length - 1].focus();
      }
    });
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.v4-dropdown')) closeDropdowns();
  });

  /* The mobile nav panel only exists ≤640px: crossing that boundary with a
     panel open (rotation, window resize) would leave the hidden toggle at
     aria-expanded="true" and the inline links under the open-panel handlers. */
  onMediaChange(window.matchMedia('(max-width: 640px)'), () => closeDropdowns());

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = openDropdown();
    if (!open) return;
    /* Only restore focus to the toggle if focus was inside the dropdown —
       otherwise Escape on the page background shouldn't yank focus around. */
    const focusInside = open.root.contains(document.activeElement);
    closeDropdowns();
    if (focusInside) focusToggle(open);
  });

  /* --- Theme buttons --- */

  themeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      applyTheme(button.dataset.themeValue);
    });
  });

  /* Default preference is `auto` even when nothing is stored yet — a visitor
     who never touched the switcher must still follow OS theme changes. */
  onMediaChange(prefersDark, () => {
    if (currentPreference() === 'auto') {
      applyTheme('auto');
    }
  });

  /* Theme changed in another tab → storage event; page restored from
     bfcache → pageshow. Both re-apply so data-theme/aria stay fresh. */
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_PREFERENCE_KEY) applyTheme(event.newValue || 'auto');
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) applyTheme(currentPreference());
  });

  /* --- Anchor navigation (handles repeated clicks on same anchor) --- */

  const navLinks = Array.from(document.querySelectorAll('.v4-bar-mid a[href^="#"]'));

  navLinks.forEach((link) => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        /* Native fragment navigation (suppressed by preventDefault) moves
           the sequential focus point to the target — replicate that so Tab
           continues from the section, not from the header link. Focus FIRST
           (preventScroll), then start the scroll: focusing after
           scrollIntoView cancels the smooth-scroll animation in Chrome. */
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
        /* Read reduced-motion at click time — the preference can change
           mid-session. */
        target.scrollIntoView({ behavior: prefersReducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
        /* Intentionally NOT writing the fragment to the URL: a hash sticks
           in the address bar and on next visit the browser auto-scrolls to
           that section. Anchor sharing still works for inbound links — the
           browser handles those on initial paint without our help. */
      }
    });
  });
})();
