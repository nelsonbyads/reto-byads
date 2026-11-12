import { describe, expect, it } from 'vitest';
import { normalizeWebsiteInput, safeExternalUrl } from './safeUrl';

describe('safeExternalUrl', () => {
  it('keeps http and https links', () => {
    expect(safeExternalUrl('https://dadofit.com/promo')).toBe('https://dadofit.com/promo');
    expect(safeExternalUrl('http://example.org')).toBe('http://example.org/');
  });

  it('drops script and data URLs', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeExternalUrl(' JavaScript:alert(1)')).toBeUndefined();
    expect(safeExternalUrl('data:text/html,<script>1</script>')).toBeUndefined();
    expect(safeExternalUrl('not a url')).toBeUndefined();
    expect(safeExternalUrl(null)).toBeUndefined();
  });
});

describe('normalizeWebsiteInput', () => {
  it('adds https to bare domains', () => {
    expect(normalizeWebsiteInput('marca.com')).toBe('https://marca.com/');
  });

  it('rejects unsafe schemes and keeps empty values empty', () => {
    expect(normalizeWebsiteInput('javascript:alert(1)')).toBe('');
    expect(normalizeWebsiteInput('   ')).toBe('');
  });
});
