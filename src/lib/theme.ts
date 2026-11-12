// Visual theme: stored per browser and applied to <html data-dadofit-theme>.
// Applied at boot (main.tsx) so public pages without the app header (login,
// register, legal) also render in the chosen theme from the first paint.

export type DadoFitTheme = 'pastel' | 'light' | 'dark';

export const THEME_KEY = 'dadofit:theme:v15.8';
export const DEFAULT_THEME: DadoFitTheme = 'dark';

export function isTheme(value: unknown): value is DadoFitTheme {
  return value === 'pastel' || value === 'light' || value === 'dark';
}

export function readStoredTheme(): DadoFitTheme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    /* storage unavailable (private mode, blocked site data) */
  }
  return DEFAULT_THEME;
}

export function applyTheme(theme: DadoFitTheme, persist = true): void {
  document.documentElement.dataset.dadofitTheme = theme;
  if (!persist) return;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}
