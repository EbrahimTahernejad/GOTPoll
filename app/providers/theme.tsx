import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useMediaQuery } from 'usehooks-ts';

type Theme = 'dark' | 'light' | 'system';
type ThemeComputed = 'dark' | 'light';

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  computedTheme: ThemeComputed;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: 'system',
  computedTheme: 'light',
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'vite-ui-theme',
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  );

  const systemThemeIsDark = useMediaQuery('(prefers-color-scheme: dark)');
  const computedTheme = useMemo<ThemeComputed>(() => {
    if (theme === 'system') {
      return systemThemeIsDark ? 'dark' : 'light';
    }
    return theme;
  }, [theme, systemThemeIsDark]);

  useEffect(() => {
    if (!window.GOTPoll) return;
    window.GOTPoll.setTheme(theme)
      .then((isDark) => {
        window.document.documentElement.classList.remove('light', 'dark');
        window.document.documentElement.classList.add(
          isDark ? 'dark' : 'light'
        );
        window.document.documentElement.setAttribute(
          'data-ag-theme-mode',
          isDark ? 'dark' : 'light'
        );
      })
      .catch(console.error);
  }, [theme]);

  useEffect(() => {
    if (window.GOTPoll) return;
    window.document.documentElement.setAttribute(
      'data-ag-theme-mode',
      computedTheme
    );
    window.document.documentElement.classList.remove('light', 'dark');
    window.document.documentElement.classList.add(computedTheme);
  }, [computedTheme]);

  const value = {
    theme,
    computedTheme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setTheme(theme);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error('useTheme must be used within a ThemeProvider');

  return context;
};
