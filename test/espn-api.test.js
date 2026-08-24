// Locks in how we read ESPN's league payloads. The settings fixture is a real 2026
// response from ESPN's public league-defaults endpoint, so the slot ids are genuine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settings = JSON.parse(readFileSync(new URL('./fixtures/league-mSettings.json', import.meta.url), 'utf8'));
const draftDetail = JSON.parse(readFileSync(new URL('./fixtures/league-mDraftDetail.json', import.meta.url), 'utf8'));

function stubFetch(payload) {
  // No ESPN tab available, so the fetcher falls through to a direct call.
  globalThis.chrome = { runtime: { lastError: null }, tabs: { query: async () => [], sendMessage: (_i, _m, cb) => cb(null) } };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => payload });
}

test('league settings map to the right roster slots and round count', async () => {
  stubFetch(settings);
  const { fetchLeague } = await import('../src/core/espn-api.js');
  const l = await fetchLeague('123');

  assert.equal(l.teams, 12);
  assert.equal(l.name, 'Keeper League');
  assert.equal(l.isKeeper, true);
  // ESPN slot ids: 0=QB 2=RB 4=WR 6=TE 16=DST 17=K 20=BE 21=IR 23=FLEX
  assert.deepEqual(l.slotCounts, { QB: 1, RB: 2, WR: 2, TE: 1, DST: 1, K: 1, BE: 7, IR: 1, FLEX: 1 });
  // Rounds = every slot except IR: 1+2+2+1+1+1+7+1
  assert.equal(l.rounds, 16);
  assert.equal(Object.keys(l.teamsById).length, 12);
  assert.equal(l.teamsById[1].name, 'Team1 X');
});

test('draft picks come back sorted by overall pick, keeper flag preserved', async () => {
  stubFetch(draftDetail);
  const { fetchDraftPicks } = await import('../src/core/espn-api.js');
  const d = await fetchDraftPicks('123');

  assert.equal(d.inProgress, true);
  assert.equal(d.drafted, false);
  assert.deepEqual(d.picks.map((p) => p.overall), [1, 2, 3]);
  assert.equal(d.picks[1].keeper, true);
  assert.equal(d.picks[1].playerId, 4430807);
  assert.equal(d.picks[2].round, 1);
});

test('a 401 surfaces actionable guidance, not a raw status', async () => {
  globalThis.chrome = { runtime: { lastError: null }, tabs: { query: async () => [], sendMessage: (_i, _m, cb) => cb(null) } };
  globalThis.fetch = async () => ({ ok: false, status: 401, statusText: 'Unauthorized' });
  const { fetchLeague } = await import('../src/core/espn-api.js');
  // This league is private, so a 401 means the cookie did not come along --
  // the fix is to be signed in with an ESPN tab open, and the message should say so.
  await assert.rejects(() => fetchLeague('123'), /not authorized.*signed in/is);
});
