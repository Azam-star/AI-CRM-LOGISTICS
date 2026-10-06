import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionToken, getAuthConfig, verifySessionToken } from './auth';

const config = {
  email: 'admin@example.com',
  password: 'a-long-test-password',
  secret: 'a-test-secret-that-is-at-least-32-characters',
  secureCookie: false,
};

test('requires configured admin credentials and a strong session secret', () => {
  assert.throws(() => getAuthConfig({}), /ADMIN_EMAIL, ADMIN_PASSWORD, and AUTH_SECRET/);
  assert.throws(
    () => getAuthConfig({ ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'short', AUTH_SECRET: config.secret }),
    /at least 12 characters/,
  );
  assert.throws(
    () => getAuthConfig({ ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: config.password, AUTH_SECRET: 'too-short' }),
    /at least 32 characters/,
  );
});

test('accepts a valid unexpired session token', () => {
  const now = 1_800_000_000_000;
  const token = createSessionToken(config.email, config.secret, now);
  assert.equal(verifySessionToken(token, config, now + 1000), true);
});

test('rejects expired, modified, and wrong-user session tokens', () => {
  const now = 1_800_000_000_000;
  const token = createSessionToken(config.email, config.secret, now);
  assert.equal(verifySessionToken(token, config, now + 8 * 60 * 60 * 1000), false);
  assert.equal(verifySessionToken(`${token}x`, config, now), false);
  assert.equal(verifySessionToken(createSessionToken('other@example.com', config.secret, now), config, now), false);
});
