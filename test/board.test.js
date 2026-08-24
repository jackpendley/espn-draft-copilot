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
