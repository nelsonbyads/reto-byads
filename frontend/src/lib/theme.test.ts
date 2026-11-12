import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, isTheme, readStoredTheme, THEME_KEY } from './theme';

// Minimal browser stand-ins (the suite runs in Node).
const store = new Map<string, string>();
const dataset: Record<string, string | undefined> = {};
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  clear: () => store.clear(),
});
vi.stubGlobal('document', { documentElement: { dataset } });

describe('theme', () => {
  beforeEach(() => {
    store.clear();
    delete dataset.dadofitTheme;
  });

  it('defaults to dark and ignores unknown stored values', () => {
    expect(readStoredTheme()).toBe('dark');
    store.set(THEME_KEY, 'neon');
    expect(readStoredTheme()).toBe('dark');
  });

  it('applies and persists the chosen theme', () => {
    applyTheme('pastel');
    expect(dataset.dadofitTheme).toBe('pastel');
    expect(readStoredTheme()).toBe('pastel');
  });

  it('can apply without persisting', () => {
    applyTheme('light', false);
    expect(dataset.dadofitTheme).toBe('light');
    expect(store.has(THEME_KEY)).toBe(false);
  });

  it('recognises only the three themes', () => {
    expect(['dark', 'light', 'pastel'].every(isTheme)).toBe(true);
    expect(isTheme('Dark')).toBe(false);
  });
});
