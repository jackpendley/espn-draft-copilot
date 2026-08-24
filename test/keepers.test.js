import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseKeeperPaste, simulatePickOrder, nextPickForSlot,
  keeperAdjustedAdp, availabilityAt,
} from '../src/core/keepers.js';

test('snake order with no keepers is the plain serpentine', () => {
  const { picks } = simulatePickOrder({ teams: 12, rounds: 3, keeperSlots: [] });
  assert.equal(picks.length, 36);
  assert.equal(picks[0].teamSlot, 1);           // 1.01
  assert.equal(picks[11].teamSlot, 12);         // 1.12
  assert.equal(picks[12].teamSlot, 12);         // 2.01 turns
  assert.equal(picks[23].teamSlot, 1);          // 2.12
  assert.equal(picks[24].teamSlot, 1);          // 3.01
  // Pick 5 owns overall 5, 20, 29 in a clean 12-team snake.
  const mine = picks.filter((p) => p.teamSlot === 5).map((p) => p.overall);
  assert.deepEqual(mine, [5, 20, 29]);
});

test('a keeper burns exactly its own slot and renumbers everything after it', () => {
  const { picks } = simulatePickOrder({
    teams: 12, rounds: 3,
    keeperSlots: [{ teamSlot: 3, round: 1, player: 'Somebody' }],
  });
  assert.equal(picks.length, 35);
  // Team 3 has no round-1 pick; team 4 now picks 3rd overall.
  assert.equal(picks.find((p) => p.overall === 3).teamSlot, 4);
  assert.equal(picks.filter((p) => p.teamSlot === 3 && p.round === 1).length, 0);
  // Pick 5 slides up one because a slot ahead of them vanished.
  assert.equal(picks.find((p) => p.teamSlot === 5 && p.round === 1).overall, 4);
});

test("my real picks: 12-team, slot 5, JSN kept for the 6th", () => {
  // Only my keeper is known; everyone else's arrives later.
  const { picks } = simulatePickOrder({
    teams: 12, rounds: 15,
    keeperSlots: [{ teamSlot: 5, round: 6, player: 'Jaxon Smith-Njigba' }],
  });
  const mine = picks.filter((p) => p.teamSlot === 5);
  // 15 rounds minus the round I keep in.
  assert.equal(mine.length, 14);
  assert.equal(mine.some((p) => p.round === 6), false);
  // Rounds 1-5 are untouched by a round-6 keeper.
  assert.deepEqual(mine.slice(0, 5).map((p) => p.overall), [5, 20, 29, 44, 53]);
  // Round 7 used to be overall 77; losing my round-6 slot pulls it up by one.
  assert.equal(mine.find((p) => p.round === 7).overall, 76);
});

test('keepers spread across teams compound the shift', () => {
  const keeperSlots = [
    { teamSlot: 1, round: 1 }, { teamSlot: 2, round: 1 },
    { teamSlot: 7, round: 2 }, { teamSlot: 5, round: 6 },
  ];
  const { picks, slots } = simulatePickOrder({ teams: 12, rounds: 15, keeperSlots });
  assert.equal(slots.length, 180);
  assert.equal(picks.length, 176);
  // Two teams ahead of me have no round-1 pick, so I open at overall 3.
  assert.equal(picks.find((p) => p.teamSlot === 5 && p.round === 1).overall, 3);
});

test('nextPickForSlot reports the gap I have to survive', () => {
  const { picks } = simulatePickOrder({ teams: 12, rounds: 15, keeperSlots: [] });
  const n = nextPickForSlot(picks, 5, 6);
  assert.equal(n.pick.overall, 20);
  assert.equal(n.picksUntilNext, 14);
  assert.equal(n.pickAfter.overall, 29);
  assert.equal(n.picksBetween, 8);
});

test('keeper-adjusted ADP pulls survivors up past the players who were kept', () => {
  const players = [
    { espnId: 1, adp: 1 }, { espnId: 2, adp: 2 }, { espnId: 3, adp: 3 },
    { espnId: 4, adp: 10 }, { espnId: 5, adp: 50 },
  ];
  const adj = keeperAdjustedAdp(players, new Set([1, 3]));
  assert.equal(adj.has(1), false);            // kept players leave the pool
  assert.equal(adj.get(2), 1);                // one kept player ahead of them
  assert.equal(adj.get(4), 8);                // two ahead
  assert.equal(adj.get(5), 48);
});

test('availability falls through the pick where ADP sits', () => {
  const early = availabilityAt(20, 5);
  const at = availabilityAt(20, 20);
  const late = availabilityAt(20, 40);
  assert.ok(early > 0.95, `expected >0.95, got ${early}`);
  assert.ok(Math.abs(at - 0.5) < 0.1, `expected ~0.5, got ${at}`);
  assert.ok(late < 0.05, `expected <0.05, got ${late}`);
});

test('keeper paste reads Google Sheets TSV with a header', () => {
  const { rows, errors } = parseKeeperPaste(
    'Team\tPlayer\tRound\nJack\tJaxon Smith-Njigba\t6\nDave\tBijan Robinson\t1\n',
  );
  assert.equal(errors.length, 0);
  assert.deepEqual(rows[0], { team: 'Jack', player: 'Jaxon Smith-Njigba', round: 6 });
  assert.deepEqual(rows[1], { team: 'Dave', player: 'Bijan Robinson', round: 1 });
});

test('keeper paste handles CSV, reordered headers, and "Rd 6" style rounds', () => {
  const { rows, errors } = parseKeeperPaste(
    'Round,Player,Team\nRd 6,"Smith-Njigba, Jaxon",Jack\n3,Chase Brown,Sam\n',
  );
  assert.equal(errors.length, 0);
  assert.equal(rows[0].round, 6);
  assert.equal(rows[0].team, 'Jack');
  assert.equal(rows[1].player, 'Chase Brown');
});

test('keeper paste reports bad rows instead of dropping them silently', () => {
  const { rows, errors } = parseKeeperPaste('Team\tPlayer\tRound\nJack\tSomeone\tTBD\n');
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].reason, /could not read a round/);
});
