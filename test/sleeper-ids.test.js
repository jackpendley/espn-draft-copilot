// The sleeperId -> espnId map is built once at build time and then trusted blindly during
// a draft, so the failure modes that matter are the quiet ones: a name matched to the
// wrong player, or a guide player with no Sleeper id at all.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSleeperIdMap } from '../src/core/sleeper-ids.js';

const espn = [
  { espnId: 4430878, name: 'Jaxon Smith-Njigba', pos: 'WR', team: 'SEA', percentOwned: 99 },
  { espnId: 4429795, name: 'Jahmyr Gibbs', pos: 'RB', team: 'DET', percentOwned: 99 },
  { espnId: 4429805, name: 'Frank Gore Jr.', pos: 'RB', team: 'BUF', percentOwned: 3 },
  { espnId: 3116385, name: 'Cody White', pos: 'WR', team: 'PIT', percentOwned: 1 },
  { espnId: -16034, name: 'Texans D/ST', pos: 'DST', team: 'HOU', percentOwned: 98 },
  { espnId: -16026, name: 'Seahawks D/ST', pos: 'DST', team: 'SEA', percentOwned: 60 },
];

const sl = (o) => ({ active: true, espnId: null, ...o });

test('defenses map by team abbreviation, which is how Sleeper keys them', () => {
  const { map } = buildSleeperIdMap([
    sl({ sleeperId: 'HOU', name: 'Houston Texans', pos: 'DEF', team: 'HOU' }),
    sl({ sleeperId: 'SEA', name: 'Seattle Seahawks', pos: 'DEF', team: 'SEA' }),
  ], espn);
  // Sleeper calls them "Houston Texans"; ESPN calls them "Texans D/ST" with a negative id.
  assert.equal(map.HOU, -16034);
  assert.equal(map.SEA, -16026);
});

test("a player Sleeper has no espn_id for still maps, by name", () => {
  // Sleeper's espn_id is null for Jaxon Smith-Njigba, a top-10 pick. It cannot be the index.
  const { map, byHow } = buildSleeperIdMap([
    sl({ sleeperId: '9488', name: 'Jaxon Smith-Njigba', pos: 'WR', team: 'SEA' }),
  ], espn);
  assert.equal(map['9488'], 4430878);
  assert.equal(byHow['exact-name-pos'], 1);
});

test("Sleeper's own espn_id is used when it points at a player ESPN still carries", () => {
  const { map, byHow } = buildSleeperIdMap([
    sl({ sleeperId: '1', name: 'Jahmyr Gibbs', pos: 'RB', team: 'DET', espnId: 4429795 }),
  ], espn);
  assert.equal(map['1'], 4429795);
  assert.equal(byHow['espn-id'], 1);
});

test('near-misses are left unmapped rather than matched to the wrong player', () => {
  // Edit-distance matching over 4000+ players is confidently wrong -- it puts Roddy White
  // on Cody White's id. An unresolved pick still counts toward the pick number; a
  // MIS-resolved one crosses the wrong name off the board mid-draft.
  const { map, unmatched } = buildSleeperIdMap([
    sl({ sleeperId: '2', name: 'Roddy White', pos: 'WR', team: null }),
  ], espn);
  assert.deepEqual(map, {});
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0].name, 'Roddy White');
});

test('retired namesakes never take an active player\'s id', () => {
  // names.js strips generational suffixes, so "Frank Gore" and "Frank Gore Jr." normalize
  // to the same string. Sleeper keeps retired players forever; ESPN does not.
  const { map } = buildSleeperIdMap([
    sl({ sleeperId: 'sr', name: 'Frank Gore', pos: 'RB', team: null, active: false }),
    sl({ sleeperId: 'jr', name: 'Frank Gore', pos: 'RB', team: 'BUF' }),
  ], espn);
  assert.equal(map.jr, 4429805);
  assert.equal(map.sr, undefined);
});

test('when two active players claim one ESPN id, the rostered one wins', () => {
  const { map, collisions } = buildSleeperIdMap([
    sl({ sleeperId: 'fa', name: 'Frank Gore', pos: 'RB', team: null }),
    sl({ sleeperId: 'buf', name: 'Frank Gore', pos: 'RB', team: 'BUF' }),
  ], espn);
  assert.equal(map.buf, 4429805);
  assert.equal(map.fa, undefined);
  assert.equal(collisions.length, 1);
  // One ESPN player, one Sleeper id -- otherwise a pick could strike two names off.
  assert.equal(new Set(Object.values(map)).size, Object.keys(map).length);
});

test('the guide aliases apply here too', () => {
  const { map } = buildSleeperIdMap(
    [sl({ sleeperId: '3', name: 'Kenneth Gainwell', pos: 'RB', team: 'PIT' })],
    [...espn, { espnId: 4241478, name: 'Kenny Gainwell', pos: 'RB', team: 'PIT', percentOwned: 20 }],
    { 'kenneth gainwell': 'Kenny Gainwell' },
  );
  assert.equal(map['3'], 4241478);
});

// ---- the built artifact ------------------------------------------------------
// dist/dataset.json is gitignored (it embeds the private guide), so these checks only run
// on a machine that has built it. A fresh clone and CI skip them.

function builtDataset() {
  try { return JSON.parse(readFileSync(new URL('../dist/dataset.json', import.meta.url), 'utf8')); }
  catch { return null; }
}

test('every player on the board can be crossed off by a Sleeper pick', () => {
  // The one that matters on the night. If a guide player has no Sleeper id, someone can
  // draft them in a rehearsal and they will just sit there on the board looking available.
  const dataset = builtDataset();
  const map = dataset?.idMap?.sleeper || {};
  if (!Object.keys(map).length) return;   // no built dataset, or built without `npm run fetch:sleeper`

  const reachable = new Set(Object.values(map));
  const missing = dataset.players.filter((p) => !reachable.has(p.espnId));
  assert.deepEqual(missing.map((p) => `${p.name} (${p.pos})`), []);
});

test('the built map never points two Sleeper ids at one ESPN player', () => {
  const map = builtDataset()?.idMap?.sleeper || {};
  if (!Object.keys(map).length) return;
  assert.equal(new Set(Object.values(map)).size, Object.keys(map).length);
});
