// Orphaning: after an extension reload the old content script keeps running with dead
// chrome.* handles. Nothing here may throw -- it must degrade to a clean "stale" state.

import test from 'node:test';
import assert from 'node:assert/strict';

const load = async () => import(`../src/core/runtime.js?t=${Math.random()}`);

function alive() {
  globalThis.chrome = {
    runtime: { id: 'abc123', lastError: null },
    storage: {
      local: { get: async () => ({ a: 1 }), set: async () => {} },
      onChanged: { addListener() {}, removeListener() {} },
    },
  };
}

function orphaned() {
  const boom = () => { throw new Error('Extension context invalidated.'); };
  globalThis.chrome = {
    runtime: { get id() { return undefined; }, lastError: null },
    storage: {
      local: { get: boom, set: boom },
      onChanged: { addListener: boom, removeListener() {} },
    },
  };
}

test('extensionAlive tracks whether runtime.id survives', async () => {
  const m = await load();
  alive();    assert.equal(m.extensionAlive(), true);
  orphaned(); assert.equal(m.extensionAlive(), false);
});

test('extensionAlive is false when touching chrome.runtime itself throws', async () => {
  const m = await load();
  globalThis.chrome = { get runtime() { throw new Error('Extension context invalidated.'); } };
  assert.equal(m.extensionAlive(), false);
});

test('safeGet returns the fallback instead of rejecting once orphaned', async () => {
  const m = await load();
  orphaned();
  assert.deepEqual(await m.safeGet(null, { fallback: true }), { fallback: true });
  assert.deepEqual(await m.safeGet(null), {});
});

test('safeGet still reads normally while alive', async () => {
  const m = await load();
  alive();
  assert.deepEqual(await m.safeGet(null), { a: 1 });
});

test('safeSet reports failure rather than throwing once orphaned', async () => {
  const m = await load();
  orphaned();
  assert.equal(await m.safeSet({ x: 1 }), false);
  alive();
  assert.equal(await m.safeSet({ x: 1 }), true);
});

test('a non-invalidation storage error is not swallowed', async () => {
  const m = await load();
  globalThis.chrome = {
    runtime: { id: 'abc' },
    storage: { local: { get: async () => { throw new Error('QUOTA_BYTES exceeded'); } } },
  };
  await assert.rejects(() => m.safeGet(null), /QUOTA_BYTES/);
});

test('onStorageLocal is inert once orphaned and returns a no-op detach', async () => {
  const m = await load();
  orphaned();
  const off = m.onStorageLocal(() => { throw new Error('must not run'); });
  assert.equal(typeof off, 'function');
  off();
});

test('send() short-circuits to an invalidated result without calling chrome', async () => {
  orphaned();
  const { send } = await import(`../src/core/messaging.js?t=${Math.random()}`);
  const r = await send({ type: 'picks' });
  assert.equal(r.ok, false);
  assert.equal(r.invalidated, true);
});

test('isInvalidated recognizes the Chrome message and ignores unrelated errors', async () => {
  const m = await load();
  assert.equal(m.isInvalidated(new Error('Extension context invalidated.')), true);
  assert.equal(m.isInvalidated('Extension context invalidated.'), true);
  assert.equal(m.isInvalidated(new Error('ESPN 401')), false);
  assert.equal(m.isInvalidated(null), false);
});
