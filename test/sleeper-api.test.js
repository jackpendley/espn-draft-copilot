// Locks in the Sleeper adapter. The fixtures are a real completed Sleeper draft
// (1000000000000000002), so the payload shapes are genuine rather than imagined.
//
// The point of this platform is rehearsal: the panel has to behave in a Sleeper mock the
// way it will in the ESPN draft room on Sept 3. Most of these tests are really about
// that, not about Sleeper.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fetchSleeperLeague, fetchSleeperPicks, slotForUser, detectKeepers } from '../src/core/sleeper-api.js';
import { draftIdFromUrl } from '../src/core/sleeper-constants.js';
import { rosterNeeds } from '../src/core/rules.js';

const F = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const draft = F('sleeper-draft.json');
const picks = F('sleeper-draft-picks.json');

/** Sleeper is public, so the adapter is plain fetches -- route them by URL. */
function stubSleeper({ draft: d = draft, picks: p = picks } = {}) {
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => (String(url).endsWith('/picks') ? p : d),
  });
}

const pick = (over) => ({
  draft_slot: ((over - 1) % 8) + 1,
  is_keeper: null,
  metadata: {},
  pick_no: over,
  player_id: String(1000 + over),
  roster_id: ((over - 1) % 8) + 1,
  round: Math.floor((over - 1) / 8) + 1,
});

// ---- league ------------------------------------------------------------------

test('draft settings map onto the same shape ESPN produces', async () => {
  stubSleeper();
  const l = await fetchSleeperLeague('1000000000000000002');

  assert.equal(l.teams, 8);
  assert.equal(l.rounds, 15);          // explicit on Sleeper; ESPN makes us derive it
  assert.equal(l.raw.type, 'linear');
  assert.equal(l.raw.status, 'complete');
  // ESPN's slot names, not Sleeper's, because rules.js reads these keys.
  assert.deepEqual(l.slotCounts, { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, DST: 1, K: 1, BE: 5 });
});

test('the slot counts are the ones rosterNeeds() understands', async () => {
  stubSleeper();
  const l = await fetchSleeperLeague('x');
  // An empty roster should need every starting slot, and never a bench spot.
  const needs = rosterNeeds([], l.slotCounts);
  const byPos = Object.fromEntries(needs.map((n) => [n.pos, n.need]));
  assert.equal(byPos.RB, 2);
  assert.equal(byPos.QB, 1);
  assert.equal(byPos.BE, undefined);
});

test('a draft slot is read back out of the draft order', async () => {
  stubSleeper();
  const l = await fetchSleeperLeague('x');
  assert.equal(slotForUser(l, '2000000000000000006'), 4);
  assert.equal(slotForUser(l, 'nobody'), null);
  assert.equal(slotForUser(l, null), null);
});

// ---- picks -------------------------------------------------------------------

test('picks come back sorted and renumbered from 1', async () => {
  stubSleeper();
  const d = await fetchSleeperPicks('x', { idMap: {} });

  assert.equal(d.drafted, true);
  assert.equal(d.inProgress, false);
  assert.equal(d.picks.length, 120);
  assert.deepEqual(d.picks.slice(0, 4).map((p) => p.overall), [1, 2, 3, 4]);
  assert.equal(d.picks.at(-1).overall, 120);
  // Sleeper's own number is kept so the panel can reconcile against its clock.
  assert.equal(d.picks[0].sleeperPickNo, 1);
  assert.equal(d.picks[0].teamSlot, 1);
});

test('a sleeper id with no ESPN counterpart still occupies a pick', async () => {
  stubSleeper({ picks: [pick(1), pick(2), pick(3)] });
  // Only the middle player is in the map.
  const d = await fetchSleeperPicks('x', { idMap: { 1002: 4430878 } });

  assert.deepEqual(d.picks.map((p) => p.overall), [1, 2, 3]);
  assert.equal(d.picks[1].playerId, 4430878);
  // Panel.js derives the live overall pick from the COUNT of drafted ids, so an
  // unresolvable player must still take up a slot or the counter silently lags.
  assert.equal(d.picks[0].playerId, 'sl:1001');
  assert.equal(new Set(d.picks.map((p) => p.playerId)).size, 3);
});

test("a keeper Sleeper flagged is removed and the rest renumber, the way Sept 3 will", async () => {
  const raw = [pick(1), { ...pick(2), is_keeper: true }, pick(3), pick(4)];
  stubSleeper({ picks: raw });
  const d = await fetchSleeperPicks('x', { idMap: {} });

  assert.equal(d.picks.length, 3);
  assert.deepEqual(d.picks.map((p) => p.overall), [1, 2, 3]);
  // The keeper's round is burned out of the snake, so everything after it moves up one.
  assert.deepEqual(d.picks.map((p) => p.sleeperPickNo), [1, 3, 4]);
  assert.deepEqual(d.keeperPicks.map((k) => k.playerId), ['sl:1002']);
});

test('a keeper drafted BY HAND is removed too -- Sleeper never flags those', async () => {
  // This is the real workflow: the mirror league has no keeper support switched on, the
  // manager just takes their keeper in the agreed round. Only the sheet knows.
  const raw = [pick(1), pick(2), pick(3)];
  stubSleeper({ picks: raw });
  const d = await fetchSleeperPicks('x', {
    idMap: { 1002: 4430878 },
    keptIds: [4430878],
  });

  assert.equal(d.picks.length, 2);
  assert.deepEqual(d.picks.map((p) => p.overall), [1, 2]);
  assert.deepEqual(d.picks.map((p) => p.sleeperPickNo), [1, 3]);
  assert.deepEqual(d.keeperPicks, [{ playerId: 4430878, round: 1, teamSlot: 2 }]);
});

test('the keeper slot is reported from where it was actually taken', async () => {
  // The mirror league may deal a different draft order than ESPN, so the sheet's
  // hand-assigned slot can be wrong. The feed is the truth.
  const raw = [{ ...pick(6), is_keeper: true }];
  stubSleeper({ picks: raw });
  const d = await fetchSleeperPicks('x', { idMap: {} });
  assert.deepEqual(d.keeperPicks, [{ playerId: 'sl:1006', round: 1, teamSlot: 6 }]);
});

test('an empty board reads as a draft that has not started', async () => {
  stubSleeper({ draft: { ...draft, status: 'pre_draft' }, picks: [] });
  const d = await fetchSleeperPicks('x', { idMap: {} });
  assert.deepEqual(d.picks, []);
  assert.equal(d.inProgress, false);
  assert.equal(d.drafted, false);
});

test('a bad draft id says what to do about it', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 404, statusText: 'Not Found' });
  await assert.rejects(() => fetchSleeperLeague('nope'), /no draft with that ID/i);
});

test('the panel and Sleeper clocks stay exactly N apart as N keepers come off', async () => {
  // The invariant the whole rehearsal rests on. Sleeper counts the keeper picks; the panel
  // takes them out because the real draft will have burned those rounds. If the gap ever
  // drifted from "keepers taken so far", one of the two numbers would be lying.
  const raw = Array.from({ length: 24 }, (_, i) => pick(i + 1));
  const keeperAt = [2, 9, 20];
  const keptIds = keeperAt.map((n) => 5000 + n);
  for (const n of keeperAt) raw[n - 1].player_id = String(5000 + n);
  const idMap = Object.fromEntries(keptIds.map((id) => [String(id), id]));

  for (const upto of [1, 2, 5, 9, 15, 20, 24]) {
    stubSleeper({ picks: raw.slice(0, upto) });
    const d = await fetchSleeperPicks('x', { idMap, keptIds });
    const panelNow = d.picks.length + 1;          // Panel.js: draftedIds.size + 1
    const sleeperNow = d.rawPickCount + 1;
    assert.equal(sleeperNow - panelNow, keeperAt.filter((n) => n <= upto).length,
      `gap wrong after ${upto} picks`);
  }
});

// ---- keeper detection --------------------------------------------------------
//
// Sleeper flags nothing: is_keeper comes back null even on a real keeper board, and
// picked_by/roster_id are empty on any mock. So detection reads the board's shape.

const at = (pick_no) => ({ pick_no, player_id: `p${pick_no}`, round: Math.ceil(pick_no / 12) });

test('while a draft is pre_draft, everything on the board is a keeper', () => {
  // Nothing can be a live pick before the draft runs, so this is not a heuristic.
  const found = detectKeepers([at(48), at(51), at(60)], 'pre_draft');
  assert.deepEqual([...found].sort(), ['p48', 'p51', 'p60']);
});

test('a keeper sitting at pick 1 is still caught in pre_draft', () => {
  // The frontier test alone would miss this one, since pick 1 is never "above" it.
  assert.ok(detectKeepers([at(1)], 'pre_draft').has('p1'));
});

test('mid-draft, a pick above the live frontier was placed beforehand', () => {
  // Live picks fill 1,2,3... with no gaps -- nobody can pick out of turn.
  const board = [at(1), at(2), at(3), at(48), at(51)];
  const found = detectKeepers(board, 'drafting');
  assert.deepEqual([...found].sort(), ['p48', 'p51']);
});

test('a keeper stays a keeper once the draft advances past its slot', () => {
  // The whole reason the answer is remembered rather than recomputed. Pick 48 stops
  // looking special the moment picks 1-47 exist; forgetting it would quietly un-keeper
  // the player and shift every pick number after it.
  const board = Array.from({ length: 48 }, (_, i) => at(i + 1));
  assert.ok(!detectKeepers(board, 'drafting').has('p48'), 'no longer structurally visible');
  assert.ok(detectKeepers(board, 'drafting', ['p48']).has('p48'), 'but remembered');
});

test("Sleeper's own is_keeper flag is honored when it is actually set", () => {
  const board = [{ ...at(1), is_keeper: true }, at(2)];
  const found = detectKeepers(board, 'drafting');
  assert.deepEqual([...found], ['p1']);
});

test('a plain draft with no keepers detects none', () => {
  const board = Array.from({ length: 20 }, (_, i) => at(i + 1));
  assert.equal(detectKeepers(board, 'drafting').size, 0);
});

test('a pre-placed keeper board removes and renumbers end to end', async () => {
  // The real shape of Jack's mirror board: keepers sat on the grid before the draft ran.
  const board = [at(48), at(51), at(60)];
  stubSleeper({ draft: { ...draft, status: 'pre_draft' }, picks: board });
  const d = await fetchSleeperPicks('x', { idMap: {} });

  assert.equal(d.picks.length, 0);
  assert.equal(d.keeperPicks.length, 3);
  assert.deepEqual(d.detectedKeeperIds.sort(), ['p48', 'p51', 'p60']);
});

// ---- url parsing -------------------------------------------------------------

test('the draft id comes out of a draft room URL, so a mock needs no setup', () => {
  assert.equal(draftIdFromUrl('https://sleeper.com/draft/nfl/1000000000000000002'), '1000000000000000002');
  assert.equal(draftIdFromUrl('https://sleeper.com/draft/1000000000000000002'), '1000000000000000002');
  assert.equal(draftIdFromUrl('https://sleeper.com/leagues/1000000000000000001/team'), null);
  assert.equal(draftIdFromUrl('https://sleeper.com/'), null);
  assert.equal(draftIdFromUrl(''), null);
  assert.equal(draftIdFromUrl(null), null);
});
