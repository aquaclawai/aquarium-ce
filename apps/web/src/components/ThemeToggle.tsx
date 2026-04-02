import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'openclaw-theme';

function getInitialTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return 'light';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);

  const applyTheme = useCallback((t: 'light' | 'dark') => {
    document.documentElement.classList.toggle('dark', t === 'dark');
    localStorage.setItem(STORAGE_KEY, t);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme, applyTheme]);

  const toggle = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
    >
      {theme === 'light' ? '\u263E' : '\u2600'}
    </button>
  );
}
