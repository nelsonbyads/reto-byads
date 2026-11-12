// Magic-byte check for uploads (S6): the declared Content-Type must match what
// the file really is, so a file cannot be served under a type it is not.
// Only the types the buckets accept are known; anything else is rejected.

export const SNIFF_BYTES = 16;

const ascii = (bytes, offset, text) => bytes.length >= offset + text.length
  && [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));

const startsWith = (bytes, signature) => bytes.length >= signature.length
  && signature.every((value, index) => bytes[index] === value);

// ISO base media (MP4 / QuickTime): a box size, then the box type at offset 4.
const isoBox = (bytes, types) => types.some((type) => ascii(bytes, 4, type));

const CHECKS = {
  'image/jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  'image/png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/webp': (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP'),
  'video/mp4': (b) => isoBox(b, ['ftyp']),
  // Older QuickTime files may start with another top-level atom.
  'video/quicktime': (b) => isoBox(b, ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot']),
  'video/webm': (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]),
};

export function isKnownType(contentType) {
  return Object.hasOwn(CHECKS, contentType);
}

/** True when the first bytes of a file match its declared type. */
export function matchesSignature(contentType, header) {
  const check = CHECKS[contentType];
  return Boolean(check && header && check(header));
}
