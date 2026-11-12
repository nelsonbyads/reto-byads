import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import bcrypt from 'bcryptjs';

// Passwords imported from Supabase (GoTrue) are bcrypt hashes ($2a$/$2b$/$2y$).
// They are verified as-is and transparently re-hashed with argon2id on the next
// successful login (decision D6).

const ARGON_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export async function hashPassword(password) {
  return argonHash(password, ARGON_OPTIONS);
}

export function isLegacyHash(storedHash) {
  return typeof storedHash === 'string' && /^\$2[aby]\$/.test(storedHash);
}

export async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string' || !storedHash) return false;
  if (isLegacyHash(storedHash)) return bcrypt.compare(password, storedHash);
  if (storedHash.startsWith('$argon2')) {
    try {
      return await argonVerify(storedHash, password);
    } catch {
      return false;
    }
  }
  return false;
}

// Dummy hash so unknown e-mails take the same time as wrong passwords.
let dummyHash;
export async function burnPasswordCheck(password) {
  dummyHash ??= await hashPassword('dadofit-timing-equalizer');
  await verifyPassword(password, dummyHash);
}

/** Server-side password policy (SEC-08). Returns an error message or null. */
export function validatePasswordPolicy(password, minLength) {
  if (typeof password !== 'string') return 'La contraseña es obligatoria.';
  if (password.length < minLength) return `La contraseña debe tener mínimo ${minLength} caracteres.`;
  if (password.length > 72) return 'La contraseña no puede superar 72 caracteres.';
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'La contraseña debe combinar letras y números.';
  }
  return null;
}
