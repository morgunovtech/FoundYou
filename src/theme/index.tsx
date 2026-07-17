import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type Theme = 'light' | 'dark' | 'accessible';
export type ThemeMode = 'light' | 'dark' | 'system' | 'accessible';

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: Theme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const STORAGE_KEY = 'meta-data-theme-mode';

function getSystemTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredMode(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'system';
  }
  // Заблокированное хранилище (политики приватности) не должно ронять всё
  // приложение: провайдер монтируется выше ErrorBoundary.
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system' || stored === 'accessible') {
      return stored;
    }
  } catch (error) {
    console.warn('theme-storage-read', error);
  }
  return 'system';
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>(() => getStoredMode());
  const [resolved, setResolved] = useState<Theme>(() => (mode === 'system' ? getSystemTheme() : (mode as Theme)));

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.dataset.themeMode = mode;
    const colorScheme = resolved === 'dark' ? 'dark' : 'light';
    root.style.colorScheme = colorScheme;
  }, [mode, resolved]);

  useEffect(() => {
    if (mode === 'system') {
      const apply = () => setResolved(getSystemTheme());
      apply();
      if (typeof window !== 'undefined') {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const listener = () => setResolved(media.matches ? 'dark' : 'light');
        media.addEventListener('change', listener);
        return () => media.removeEventListener('change', listener);
      }
    } else {
      setResolved(mode as Theme);
    }
    return undefined;
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch (error) {
        console.warn('theme-storage-write', error);
      }
    }
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
