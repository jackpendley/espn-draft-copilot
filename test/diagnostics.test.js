import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeEspnPicks, summarizeSleeperPicks, resolveKeeperRows } from '../src/options/diagnostics.js';
import { buildIndex } from '../src/core/names.js';

const players = [{ espnId: 1, name: 'Rico Runner', pos: 'RB', team: 'AAA' }, { espnId: -5, name: 'Gap D/ST', pos: 'DST', team: 'GAP' }];

test('ESPN summary separates resolved, unresolved, D/ST and empty picks', () => {
  const picks = [
    { overall: 1, round: 1, teamId: 1, playerId: 1, keeper: true },
    { overall: 2, round: 1, teamId: 2, playerId: -5 },
    { overall: 3, round: 2, teamId: 3, playerId: 999 },
    { overall: 4, round: 2, teamId: 4, playerId: 0 },
  ];
  const s = summarizeEspnPicks(picks, 2025, players);
  assert.equal(s.total, 4);
  assert.equal(s.resolved, 2);
  assert.equal(s.unresolved, 1);
  assert.equal(s.dst, 1);
  assert.equal(s.skipped, 1);
  assert.equal(s.keepers, 1);
  assert.equal(s.rounds, 2);
  assert.equal(s.teams, 4);
  assert.equal(s.sample[2].name, '(id 999)');
});

test('Sleeper summary reports keepers, unmapped ids and the raw pick count', () => {
  const response = {
    rawPickCount: 5,
    picks: [{ overall: 1, round: 1, teamSlot: 1, playerId: 1 }, { overall: 2, round: 1, teamSlot: 2, playerId: 'sl-9', sleeperId: '9' }],
    keeperPicks: [{ playerId: 1, round: 4, teamSlot: 3 }, { playerId: -5, round: 2, teamSlot: 1 }],
  };
  const s = summarizeSleeperPicks(response, 'abc', players, [{}, {}, {}]);
  assert.equal(s.total, 5);
  assert.equal(s.unmapped, 1);
  assert.equal(s.keepersConfigured, 3);
  assert.deepEqual(s.keeperRows.map((k) => k.round), [2, 4]);
  assert.equal(s.sample[1].name, '(sleeper id 9)');
});

test('keeper rows resolve to dataset players and keep the sheet owner separate', () => {
  const index = buildIndex(players);
  const [row, miss] = resolveKeeperRows([
    { team: 'Team A', player: 'Rico Runner', round: 4 },
    { team: 'Team B', player: 'Nobody Atall', round: 5 },
  ], index);
  assert.equal(row.espnId, 1);
  assert.equal(row.team, 'Team A');
  assert.equal(row.nflTeam, 'AAA');
  assert.equal(miss.espnId, null);
});
