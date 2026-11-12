import { describe, expect, it } from 'vitest';
import { readAuthLinkToken } from './authLinkToken';

describe('readAuthLinkToken', () => {
  it('reads the token from the URL fragment and removes it', () => {
    expect(readAuthLinkToken('https://app.test/reset-password#token=abc', 'token')).toEqual({
      token: 'abc',
      cleanedUrl: '/reset-password',
    });
  });

  it('still accepts legacy links with the token in the query string', () => {
    expect(readAuthLinkToken('https://app.test/login?confirm=xyz&next=%2F', 'confirm')).toEqual({
      token: 'xyz',
      cleanedUrl: '/login?next=%2F',
    });
  });

  it('keeps unrelated fragment parameters', () => {
    expect(readAuthLinkToken('https://app.test/login#confirm=t1&tab=2', 'confirm')).toEqual({
      token: 't1',
      cleanedUrl: '/login#tab=2',
    });
  });

  it('returns null when there is no token', () => {
    expect(readAuthLinkToken('https://app.test/login', 'confirm')).toEqual({ token: null, cleanedUrl: '/login' });
  });
});
