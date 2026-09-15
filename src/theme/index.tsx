import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Theme mechanism shared with the morgunov.tech design system:
 *  - `data-theme` on <html> carries the resolved theme (light | dark | high-contrast);
 *  - `data-theme-preference` carries the user's choice (adds `auto`);
 *  - the preference lives in localStorage under `theme-preference`.
 * The inline script in index.html stamps both attributes before first paint;
 * this provider only keeps them in sync at runtime.
 */
export type ThemePreference = 'light' | 'dark' | 'auto' | 'high-contrast';
export type ResolvedTheme = 'light' | 'dark' | 'high-contrast';

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export const THEME_STORAGE_KEY = 'theme-preference';
/** Key used by the pre-DS build of this app; values were light|dark|system|accessible. */
const LEGACY_STORAGE_KEY = 'meta-data-theme-mode';

/** Browser-chrome colour per theme — the light/dark values match the <meta name="theme-color"> tags. */
const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: '#edeae5',
  dark: '#14130f',
  'high-contrast': '#000000'
};

const PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'auto', 'high-contrast'];

function isPreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (PREFERENCES as readonly string[]).includes(value);
}

function migrateLegacy(value: string | null): ThemePreference | null {
  if (value === 'system') return 'auto';
  if (value === 'accessible') return 'high-contrast';
  return isPreference(value) ? value : null;
}

function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'auto';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isPreference(stored)) return stored;
    const legacy = migrateLegacy(window.localStorage.getItem(LEGACY_STORAGE_KEY));
    if (legacy) {
      window.localStorage.setItem(THEME_STORAGE_KEY, legacy);
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      return legacy;
    }
  } catch {
    // Storage blocked (private mode, "block all cookies"): fall through to the stamped attribute.
  }
  const stamped = document.documentElement.getAttribute('data-theme-preference');
  return isPreference(stamped) ? stamped : 'auto';
}

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolve(preference: ThemePreference): ResolvedTheme {
  return preference === 'auto' ? systemTheme() : preference;
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(preference));

  // Follow the OS while the preference is `auto`.
  useEffect(() => {
    if (preference !== 'auto') {
      setResolved(preference);
      return undefined;
    }
    setResolved(systemTheme());
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (event: MediaQueryListEvent) => setResolved(event.matches ? 'dark' : 'light');
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [preference]);

  // Stamp <html> and the browser-chrome colour.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.setAttribute('data-theme', resolved);
    root.setAttribute('data-theme-preference', preference);
    const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    metas.forEach((meta) => {
      if (preference === 'auto') {
        // Restore the per-scheme defaults so the `media` attributes take over again.
        const media = meta.getAttribute('media') ?? '';
        meta.setAttribute('content', media.includes('dark') ? THEME_COLORS.dark : THEME_COLORS.light);
      } else {
        meta.setAttribute('content', THEME_COLORS[resolved]);
      }
    });
  }, [preference, resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable — the choice still applies for this page view.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
