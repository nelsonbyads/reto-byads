import { describe, expect, it } from 'vitest';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, validateNewPassword, validatePasswordConfirmation } from './passwordRules';

describe('password rules', () => {
  it('rejects passwords shorter than the DadoFit minimum', () => {
    expect(validateNewPassword('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toContain(`${PASSWORD_MIN_LENGTH}`);
  });

  it('accepts passwords inside the supported range', () => {
    expect(validateNewPassword('dadofit-2026')).toBeNull();
  });

  it('rejects passwords longer than the supported maximum', () => {
    expect(validateNewPassword('a'.repeat(PASSWORD_MAX_LENGTH + 1))).toContain(`${PASSWORD_MAX_LENGTH}`);
  });

  it('requires confirmation to match exactly', () => {
    expect(validatePasswordConfirmation('dadofit-2026', 'Dadofit-2026')).toBe('Las contraseñas no coinciden.');
    expect(validatePasswordConfirmation('dadofit-2026', 'dadofit-2026')).toBeNull();
  });
});
