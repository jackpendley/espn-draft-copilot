import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard, sortBoard, filterBoard, tierStatus, positionRuns } from '../src/core/board.js';

const mk = (espnId, name, pos, joelRank, posRank, tier, adp, tag = 'neutral') => ({
  espnId, name, pos, team: 'XXX',
  espn: { adp, percentOwned: 90, injuryStatus: 'ACTIVE' },
  joel: { pprRank: joelRank, halfRank: joelRank, posRank, tier, tag, stats: [] },
});

const dataset = {
  players: [
    mk(1, 'Stud RB', 'RB', 1, 1, 1, 1.5, 'target'),
    mk(2, 'Kept WR', 'WR', 8, 4, 2, 6.0),
    mk(3, 'Mid WR', 'WR', 20, 9, 4, 25.0),
    mk(4, 'Faller TE', 'TE', 24, 2, 1, 30.0, 'avoid'),
    mk(5, 'Late RB', 'RB', 90, 35, 8, 110.0),
    mk(6, 'Gone RB', 'RB', 12, 6, 3, 14.0),
  ],
};

test('kept and drafted players never appear on the board', () => {
  const rows = buildBoard(dataset, {
    keptIds: new Set([2]), draftedIds: new Set([6]),
    currentOverall: 10, myNextOverall: 20,
  });
  const names = rows.map((r) => r.name);
  assert.ok(!names.includes('Kept WR'));
  assert.ok(!names.includes('Gone RB'));
  assert.equal(rows.length, 4);
});

test('adjusted ADP accounts for the kept player ahead of them', () => {
  const rows = buildBoard(dataset, { keptIds: new Set([2]), currentOverall: 1, myNextOverall: 5 });
  // Kept WR had ADP 6.0, so everyone drafted after them moves up one.
  assert.equal(rows.find((r) => r.name === 'Mid WR').adjAdp, 24);
  assert.equal(rows.find((r) => r.name === 'Late RB').adjAdp, 109);
  // Stud RB went ahead of the kept player, so is unaffected.
  assert.equal(rows.find((r) => r.name === 'Stud RB').adjAdp, 1.5);
});

test('reach is positive when you would be taking someone early', () => {
  const rows = buildBoard(dataset, { currentOverall: 30, myNextOverall: 45 });
  const late = rows.find((r) => r.name === 'Late RB');
  assert.ok(late.reach > 70, `expected a big reach, got ${late.reach}`);
  const faller = rows.find((r) => r.name === 'Faller TE');
  assert.equal(faller.reach, 0);   // ADP 30, on the clock at 30
});

test('takeNow demotes a stud who is certain to still be there next turn', () => {
  // On the clock at 100 with my next pick at 101: everyone left is going to last.
  const rows = buildBoard(dataset, { currentOverall: 100, myNextOverall: 101, draftedIds: new Set([1, 2, 3, 4, 6]) });
  const late = rows.find((r) => r.name === 'Late RB');
  assert.ok(late.availNext > 0.5);
  assert.ok(late.takeNow < Math.max(0, 220 - 90));
});

test('value sort puts the urgent stud above a safe late-rounder', () => {
  const rows = buildBoard(dataset, { currentOverall: 1, myNextOverall: 20 });
  const sorted = sortBoard(rows, 'value');
  assert.equal(sorted[0].name, 'Stud RB');
  assert.equal(sorted[sorted.length - 1].name, 'Late RB');
});

test('joel sort is pure board order', () => {
  const rows = buildBoard(dataset, { currentOverall: 1, myNextOverall: 20 });
  assert.deepEqual(sortBoard(rows, 'joel').map((r) => r.joelRank), [1, 8, 12, 20, 24, 90]);
});

test('filters stack', () => {
  const rows = buildBoard(dataset, { currentOverall: 1, myNextOverall: 20 });
  assert.equal(filterBoard(rows, { positions: ['RB'] }).length, 3);
  assert.equal(filterBoard(rows, { hideAvoid: true }).length, 5);
  assert.equal(filterBoard(rows, { targetsOnly: true }).length, 1);
  assert.equal(filterBoard(rows, { search: 'stud' })[0].name, 'Stud RB');
});

test('tierStatus counts what is left and flags a breaking tier', () => {
  const rows = buildBoard(dataset, { currentOverall: 1, myNextOverall: 20 });
  const wr4 = tierStatus(rows).find((t) => t.pos === 'WR' && t.tier === 4);
  assert.equal(wr4.remaining, 1);
  assert.equal(wr4.breaking, true);
});

test('positionRuns flags a run and ignores a balanced window', () => {
  const runOn = [...Array(5)].map(() => ({ pos: 'RB' })).concat([{ pos: 'WR' }, { pos: 'QB' }, { pos: 'WR' }]);
  const runs = positionRuns(runOn, 8);
  assert.equal(runs[0].pos, 'RB');
  assert.equal(runs[0].count, 5);

  const balanced = [{ pos: 'RB' }, { pos: 'WR' }, { pos: 'QB' }, { pos: 'TE' }, { pos: 'RB' }, { pos: 'WR' }];
  assert.equal(positionRuns(balanced, 8).length, 0);
});

test('a short window is not enough evidence for a run', () => {
  assert.equal(positionRuns([{ pos: 'RB' }, { pos: 'RB' }, { pos: 'RB' }], 8).length, 0);
});

test('a 15-round plan maps onto a 16-round league with D/ST and K last', async () => {
  const { roundPlanFor } = await import('../src/core/board.js');
  const guide = [
    { round: 1, target: 'RB' }, { round: 2, target: 'RB' }, { round: 3, target: 'WR' },
    { round: 4, target: 'BPA' }, { round: 5, target: 'WR' }, { round: 6, target: 'BPA' },
    { round: 7, target: 'BPA' }, { round: 8, target: 'QB' }, { round: 9, target: 'Upside WR' },
    { round: 10, target: 'Punt TE' }, { round: 11, target: 'Top Handcuff' },
    { round: 12, target: 'Upside QB' }, { round: 13, target: 'Favorite Deep Sleeper' },
    { round: 14, target: 'D/ST' }, { round: 15, target: 'Kicker/IR player' },
  ];
  const p16 = roundPlanFor(guide, 16);
  assert.equal(p16.length, 16);
  assert.equal(p16[0].target, 'RB');                 // early rounds untouched
  assert.equal(p16[7].target, 'QB');                 // his round 8 QB stays at 8
  assert.equal(p16[12].target, 'Favorite Deep Sleeper');
  assert.equal(p16[13].target, 'BPA / Upside');      // the extra round
  assert.equal(p16[13].extra, true);
  assert.equal(p16[14].target, 'D/ST');              // anchored to second-to-last
  assert.equal(p16[15].target, 'Kicker/IR player');
});

test('an identical round count passes the plan through unchanged', async () => {
  const { roundPlanFor } = await import('../src/core/board.js');
  const guide = Array.from({ length: 15 }, (_, i) => ({ round: i + 1, target: `T${i + 1}` }));
  assert.deepEqual(roundPlanFor(guide, 15).map((p) => p.target), guide.map((p) => p.target));
});

test('a shorter league still ends on D/ST then Kicker', async () => {
  const { roundPlanFor } = await import('../src/core/board.js');
  const guide = Array.from({ length: 15 }, (_, i) => ({ round: i + 1, target: `T${i + 1}` }));
  const p13 = roundPlanFor(guide, 13);
  assert.equal(p13.length, 13);
  assert.equal(p13[11].target, 'T14');   // D/ST slot
  assert.equal(p13[12].target, 'T15');   // Kicker slot
});

test("D/ST picks count as drafted even though ESPN gives them negative ids", async () => {
  const { buildBoard } = await import('../src/core/board.js');
  const ds = {
    players: [
      { espnId: 4429795, name: 'A Back', pos: 'RB', team: 'DET',
        espn: { adp: 1.5 }, joel: { pprRank: 1, posRank: 1, tier: 1, tag: 'neutral', stats: [] } },
      { espnId: -16034, name: 'Texans D/ST', pos: 'DST', team: 'HOU',
        espn: { adp: 140 }, joel: { pprRank: null, posRank: null, tier: null, tag: 'neutral', stats: [] } },
      { espnId: -16007, name: 'Broncos D/ST', pos: 'DST', team: 'DEN',
        espn: { adp: 145 }, joel: { pprRank: null, posRank: null, tier: null, tag: 'neutral', stats: [] } },
    ],
  };
  // Houston's defense is gone; Denver's is not.
  const rows = buildBoard(ds, { draftedIds: new Set([-16034]), currentOverall: 150, myNextOverall: 160 });
  const names = rows.map((r) => r.name);
  assert.ok(!names.includes('Texans D/ST'), 'a drafted D/ST must leave the board');
  assert.ok(names.includes('Broncos D/ST'));
});

test('the drafted-set filter keeps negative ids and drops only playerId 0', () => {
  // Mirrors the filter in Panel.js: `draft.picks.filter((p) => p.playerId)`.
  const picks = [
    { playerId: 4429795 },   // a normal player
    { playerId: -16034 },    // a D/ST
    { playerId: 0 },         // ESPN's "no selection"
  ];
  const kept = picks.filter((p) => p.playerId).map((p) => p.playerId);
  assert.deepEqual(kept, [4429795, -16034]);
});
