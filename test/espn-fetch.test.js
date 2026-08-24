// The private-league fetch path. Covers the SameSite failure mode: a direct fetch from
// the extension origin 401s, and the request has to be relayed through an ESPN tab.

import test from 'node:test';
import assert from 'node:assert/strict';

const URL_ = 'https://lm-api-reads.fantasy.espn.com/apis/v3/x';

function setup({ tabs = [], tabReply = null, directStatus = 200, directBody = { via: 'direct' } } = {}) {
  globalThis.chrome = {
    runtime: { lastError: null },
    tabs: {
      query: async () => tabs,
      sendMessage: (_id, _msg, cb) => cb(tabReply),
    },
  };
  globalThis.fetch = async () => ({
    ok: directStatus >= 200 && directStatus < 300,
    status: directStatus,
    json: async () => directBody,
  });
}

const load = async () => (await import(`../src/core/espn-fetch.js?t=${Math.random()}`)).fetchViaPageOrDirect;

test('prefers an ESPN tab, because that request is same-site and carries the cookie', async () => {
  setup({
    tabs: [{ id: 7 }],
    tabReply: { ok: true, data: { via: 'page' } },
    directBody: { via: 'direct' },
  });
  const f = await load();
  assert.deepEqual(await f(URL_), { via: 'page' });
});

test('falls back to a direct fetch when no ESPN tab is open', async () => {
  setup({ tabs: [], directBody: { via: 'direct' } });
  const f = await load();
  assert.deepEqual(await f(URL_), { via: 'direct' });
});

test('falls back to direct when the tab has no content script listening', async () => {
  setup({ tabs: [{ id: 7 }], tabReply: undefined, directBody: { via: 'direct' } });
  const f = await load();
  assert.deepEqual(await f(URL_), { via: 'direct' });
});

test('a 401 through the page still tries direct, then reports it usefully', async () => {
  setup({ tabs: [{ id: 7 }], tabReply: { ok: false, status: 401 }, directStatus: 401 });
  const f = await load();
  await assert.rejects(() => f(URL_), /not authorized.*signed in/is);
});

test('direct 401 with no tab open also produces the sign-in guidance', async () => {
  setup({ tabs: [], directStatus: 401 });
  const f = await load();
  await assert.rejects(() => f(URL_), /not authorized/i);
});

test('a page 401 does not mask a direct fetch that works', async () => {
  setup({ tabs: [{ id: 7 }], tabReply: { ok: false, status: 401 }, directStatus: 200, directBody: { via: 'direct' } });
  const f = await load();
  assert.deepEqual(await f(URL_), { via: 'direct' });
});

test('tries every open ESPN tab before giving up', async () => {
  let calls = 0;
  globalThis.chrome = {
    runtime: { lastError: null },
    tabs: {
      query: async () => [{ id: 1 }, { id: 2 }],
      sendMessage: (id, _msg, cb) => { calls++; cb(id === 2 ? { ok: true, data: { via: 'tab2' } } : { ok: false, error: 'no-response' }); },
    },
  };
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  const f = await load();
  assert.deepEqual(await f(URL_), { via: 'tab2' });
  assert.equal(calls, 2);
});
