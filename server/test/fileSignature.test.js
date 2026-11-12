import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isKnownType, matchesSignature } from '../src/fileSignature.js';

const bytes = (...parts) => Buffer.concat(parts.map((part) => (typeof part === 'string' ? Buffer.from(part, 'latin1') : Buffer.from(part))));

const SAMPLES = {
  'image/jpeg': bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF'),
  'image/png': bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  'image/webp': bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 '),
  'video/mp4': bytes([0, 0, 0, 0x20], 'ftypisom', [0, 0, 2, 0]),
  'video/quicktime': bytes([0, 0, 0, 0x14], 'ftypqt  ', [0, 0, 0, 0]),
  'video/webm': bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]),
};

describe('matchesSignature', () => {
  it('accepts each supported type with its real header', () => {
    for (const [type, header] of Object.entries(SAMPLES)) assert.equal(matchesSignature(type, header), true, type);
  });

  it('rejects a file declared as another type', () => {
    assert.equal(matchesSignature('image/png', SAMPLES['image/jpeg']), false);
    assert.equal(matchesSignature('video/mp4', SAMPLES['video/webm']), false);
  });

  it('rejects HTML or SVG disguised as an image', () => {
    assert.equal(matchesSignature('image/jpeg', bytes('<html><script>alert(1)</script>')), false);
    assert.equal(matchesSignature('image/png', bytes('<svg xmlns="http://www.w3.org/2000/svg">')), false);
  });

  it('accepts legacy QuickTime files that start with another atom', () => {
    assert.equal(matchesSignature('video/quicktime', bytes([0, 0, 0, 8], 'wide', [0, 0, 0, 0])), true);
  });

  it('rejects unknown types and empty or short headers', () => {
    assert.equal(isKnownType('image/svg+xml'), false);
    assert.equal(matchesSignature('image/svg+xml', bytes('<svg')), false);
    assert.equal(matchesSignature('image/png', Buffer.alloc(0)), false);
    assert.equal(matchesSignature('image/webp', bytes('RIFF')), false);
  });
});
