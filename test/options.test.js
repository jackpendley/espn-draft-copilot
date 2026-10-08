// The options page carries the most hand-written UI and drives everything the panel
// reads, so at minimum it must render on both feeds without throwing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { h } from 'preact';
import renderToString from 'preact-render-to-string';

const dataset = JSON.parse(readFileSync(new URL('./fixtures/sample-dataset.json', import.meta.url), 'utf8'));

function stubChrome(config) {
  globalThis.chrome = {
    runtime: {
      sendMessage: (msg, cb) => cb(msg.type === 'dataset' ? { ok: true, dataset } : { ok: true }),
      openOptionsPage: () => {}, getURL: (p) => p, lastError: null,
    },
    storage: {
      local: { get: async () => config, set: async () => {} },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  };
}

const CONFIG = {
  platform: 'espn', leagueId: '123', myTeamSlot: 5, teams: 12, rounds: 16,
  sleeperDraftId: '1000000000000000002', sleeperUsername: 'testuser', sleeperSlot: 4,
  keepers: [{ team: 'Jack', player: 'Wes Wideout', round: 6, espnId: 9000002, teamSlot: 5 }],
  manualDrafted: [], manualUndrafted: [],
};

test('options renders the whole page on the ESPN feed', async () => {
  stubChrome(CONFIG);
  const { App } = await import('../src/options/options.js');
  const html = renderToString(h(App, { initialConfig: CONFIG }));

  assert.match(html, /ESPN League ID/);
  assert.match(html, /Replay 2025 ESPN draft/);
  // Both feeds are always offered; the toggle only decides which one the standalone
  // board and the diagnostics use.
  assert.match(html, /Sleeper practice draft/);
  assert.match(html, /Your real picks from slot 5/);
});

test('options renders on the Sleeper feed with the keeper sheet intact', async () => {
  stubChrome(CONFIG);
  const { App } = await import('../src/options/options.js');
  const html = renderToString(h(App, { initialConfig: { ...CONFIG, platform: 'sleeper' } }));

  assert.match(html, /Sleeper draft ID/);
  assert.match(html, /1000000000000000002/);
  assert.match(html, /Replay the Sleeper draft/);
  // The keeper sheet is shared: the same rounds burn on both platforms, which is the
  // entire reason Sleeper can stand in for the real draft.
  assert.match(html, /Wes Wideout/);
});
