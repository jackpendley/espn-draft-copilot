import { readFileSync } from 'node:fs';
import { simulatePickOrder, nextPickForSlot } from '../src/core/keepers.js';
import { buildBoard, sortBoard, tierStatus } from '../src/core/board.js';
import { evaluate, worstSeverity } from '../src/core/rules.js';

const d = JSON.parse(readFileSync('dist/dataset.json', 'utf8'));
const byName = (n) => d.players.find((p) => p.name === n);

// A plausible keeper set: mine is real, the rest are placeholders to exercise the math.
const keepers = [
  { team: 'Jack',  player: 'Jaxon Smith-Njigba', round: 6, teamSlot: 5 },
  { team: 'Dave',  player: 'Bijan Robinson',     round: 1, teamSlot: 2 },
  { team: 'Sam',   player: 'Chase Brown',        round: 4, teamSlot: 9 },
  { team: 'Alex',  player: 'Puka Nacua',         round: 2, teamSlot: 11 },
  { team: 'Chris', player: 'Brock Bowers',       round: 3, teamSlot: 7 },
];
const keptIds = new Set(keepers.map((k) => byName(k.player).espnId));

const { picks } = simulatePickOrder({ teams: 12, rounds: 15, keeperSlots: keepers });
const me = 5;
const mine = picks.filter((p) => p.teamSlot === me);
console.log('My picks (12-team, slot 5, with those keepers):');
console.log('  ' + mine.slice(0, 8).map((p) => `R${p.round}#${p.overall}`).join('  '));
console.log(`  (${mine.length} picks; no R6 -- JSN is kept there)\n`);

const currentOverall = mine[0].overall;
const nxt = nextPickForSlot(picks, me, currentOverall + 1);
console.log(`On the clock at overall ${currentOverall}. Next pick after this: ${nxt.pick.overall} (${nxt.picksUntilNext} picks away)\n`);

const rows = buildBoard(d, { keptIds, draftedIds: new Set(), currentOverall, myNextOverall: nxt.pick.overall });

const fmt = (r) => {
  const w = evaluate(r, { round: 1, currentOverall, totalRounds: 15, myRoster: [], planTarget: 'RB' });
  const sev = worstSeverity(w) || '-';
  return `  ${String(r.joelRank).padStart(3)}. ${r.name.padEnd(22)} ${r.pos}-${r.team.padEnd(3)} `
    + `adjADP ${String(r.adjAdp?.toFixed(1) ?? '-').padStart(5)}  `
    + `avail@${nxt.pick.overall} ${(r.availNext * 100).toFixed(0).padStart(3)}%  `
    + `takeNow ${r.takeNow.toFixed(0).padStart(3)}  ${r.tag.padEnd(7)} ${sev}`;
};

console.log('TOP 8 BY "BEST VALUE" (take-now score):');
sortBoard(rows, 'value').slice(0, 8).forEach((r) => console.log(fmt(r)));
console.log('\nTOP 8 BY JOEL RANK:');
sortBoard(rows, 'joel').slice(0, 8).forEach((r) => console.log(fmt(r)));

console.log('\nTIERS BREAKING (2 or fewer left):');
tierStatus(rows).filter((t) => t.breaking).slice(0, 6)
  .forEach((t) => console.log(`  ${t.pos} tier ${t.tier}: ${t.remaining} left -- ${t.players.map((p) => p.name).join(', ')}`));
