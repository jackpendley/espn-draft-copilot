import test from 'node:test';
import assert from 'node:assert/strict';
import { isRateLimited, isUnauthorized, rateLimited } from '../src/core/errors.js';

test('rateLimited errors are recognised, from an Error or a bare string', () => {
  assert.ok(isRateLimited(rateLimited('ESPN')));
  assert.ok(isRateLimited('Sleeper 429: rate limited'));
  assert.ok(!isRateLimited(new Error('ESPN 401')));
  assert.ok(!isRateLimited(undefined));
});

test('401 detection ignores numbers that merely contain 401', () => {
  assert.ok(isUnauthorized('ESPN 401: You are not authorized'));
  assert.ok(!isUnauthorized('league 14012 not found'));
  assert.ok(!isUnauthorized(null));
});
