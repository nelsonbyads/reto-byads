import { describe, expect, it } from 'vitest';
import { formatFileSize, formatShortDateTime } from './format';

describe('formatShortDateTime', () => {
  it('uses a dash for missing values and keeps unparsable input', () => {
    expect(formatShortDateTime(null)).toBe('—');
    expect(formatShortDateTime('')).toBe('—');
    expect(formatShortDateTime('not a date')).toBe('not a date');
  });

  it('formats day, short month and time in es-CO', () => {
    const expected = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      .format(new Date('2026-11-05T14:30:00Z'));
    expect(formatShortDateTime('2026-11-05T14:30:00Z')).toBe(expected);
  });
});

describe('formatFileSize', () => {
  it('returns an empty string for unknown or zero sizes', () => {
    expect(formatFileSize(null)).toBe('');
    expect(formatFileSize(0)).toBe('');
  });

  it('uses KB (minimum 1) below 1 MB and MB with one decimal above', () => {
    expect(formatFileSize(100)).toBe('1 KB');
    expect(formatFileSize(500 * 1024)).toBe('500 KB');
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(5.25 * 1024 * 1024)).toBe('5.3 MB');
  });
});
