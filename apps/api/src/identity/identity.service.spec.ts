import { csrfToken, hashAuthSecret } from './identity.service';

describe('identity cryptographic boundaries', () => {
  const secret = 'test-auth-secret-that-is-long-enough-for-validation';

  it('creates deterministic keyed hashes without retaining the source value', () => {
    expect(hashAuthSecret(secret, 'session-secret')).toBe(hashAuthSecret(secret, 'session-secret'));
    expect(hashAuthSecret(secret, 'session-secret')).not.toContain('session-secret');
    expect(hashAuthSecret(secret, 'session-secret')).not.toBe(
      hashAuthSecret(secret, 'different-secret'),
    );
  });

  it('binds a CSRF token to its session secret', () => {
    expect(csrfToken(secret, 'session-one')).toBe(csrfToken(secret, 'session-one'));
    expect(csrfToken(secret, 'session-one')).not.toBe(csrfToken(secret, 'session-two'));
  });
});
