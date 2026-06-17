/**
 * useTheme — Light / Dark / System theme management hook.
 */
import { useState, useCallback, useEffect } from 'react';

const THEME_KEY = 'cbm-theme';

export function useTheme() {
  const [mode, setMode] = useState(
    () => localStorage.getItem(THEME_KEY) || 'system'
  );

  // Resolve the effective dark flag
  const getEffectiveDark = useCallback((m) => {
    if (m === 'dark') return true;
    if (m === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }, []);

  const [isDark, setIsDark] = useState(() => getEffectiveDark(mode));

  // Apply to <html> and <body>
  useEffect(() => {
    const apply = (dark) => {
      document.documentElement.classList.toggle('dark', dark);
      document.body.classList.toggle('dark', dark);
      setIsDark(dark);
    };
    apply(getEffectiveDark(mode));

    // Listen for OS preference changes when in System mode
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => {
      if (mode === 'system') apply(mq.matches);
    };
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, [mode, getEffectiveDark]);

  const setTheme = useCallback((newMode) => {
    // Briefly add the transition class so the color change animates smoothly,
    // then remove it so normal interactions are not slowed down.
    document.documentElement.classList.add('theme-transition');
    localStorage.setItem(THEME_KEY, newMode);
    setMode(newMode);
    setTimeout(() => {
      document.documentElement.classList.remove('theme-transition');
    }, 400);
  }, []);

  return { mode, isDark, setTheme };
}
