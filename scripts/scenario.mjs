#!/usr/bin/env node
// Prints a simulated draft situation against the built dataset: your pick numbers with a
// handful of placeholder keepers, the best-value and guide-order boards, and breaking tiers.
//
//   node scripts/scenario.mjs [--slot 5] [--teams 12] [--rounds 15]
//
// Defaults come from data/local/config.json when present. Needs dist/dataset.json
// (`npm run build:data`) and uses top-tier player names, so adjust KEEPERS if the guide
// year changes.

import { readFileSync, existsSync } from 'node:fs';
import { simulatePickOrder, nextPickForSlot } from '../src/core/keepers.js';
import { buildBoard, sortBoard, tierStatus } from '../src/core/board.js';
import { evaluate, worstSeverity } from '../src/core/rules.js';

const local = existsSync('data/local/config.json') ? JSON.parse(readFileSync('data/local/config.json', 'utf8')) : {};
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const me = Number(args.slot ?? local.myTeamSlot ?? 1);
const TEAMS = Number(args.teams ?? local.teams ?? 12);
const ROUNDS = Number(args.rounds ?? local.rounds ?? 15);

const d = JSON.parse(readFileSync('dist/dataset.json', 'utf8'));
const byName = (n) => d.players.find((p) => p.name === n);

// Placeholder keepers to exercise the pick-order math. Edit freely.
const KEEPERS = [
  { team: 'A', player: 'Bijan Robinson', round: 1, teamSlot: 2 },
  { team: 'B', player: 'Chase Brown',    round: 4, teamSlot: 9 },
  { team: 'C', player: 'Puka Nacua',     round: 2, teamSlot: 11 },
  { team: 'D', player: 'Brock Bowers',   round: 3, teamSlot: 7 },
].filter((k) => byName(k.player));
const keptIds = new Set(KEEPERS.map((k) => byName(k.player).espnId));

const { picks } = simulatePickOrder({ teams: TEAMS, rounds: ROUNDS, keeperSlots: KEEPERS });
const mine = picks.filter((p) => p.teamSlot === me);
console.log(`My picks (${TEAMS}-team, slot ${me}, ${KEEPERS.length} placeholder keepers):`);
console.log('  ' + mine.slice(0, 8).map((p) => `R${p.round}#${p.overall}`).join('  '));
console.log(`  (${mine.length} picks)\n`);

const currentOverall = mine[0].overall;
const nxt = nextPickForSlot(picks, me, currentOverall + 1);
console.log(`On the clock at overall ${currentOverall}. Next pick after this: ${nxt.pick.overall} (${nxt.picksUntilNext} picks away)\n`);

const rows = buildBoard(d, { keptIds, draftedIds: new Set(), currentOverall, myNextOverall: nxt.pick.overall });

const fmt = (r) => {
  const w = evaluate(r, { round: 1, currentOverall, totalRounds: ROUNDS, myRoster: [], planTarget: 'RB' });
  const sev = worstSeverity(w) || '-';
  return `  ${String(r.joelRank).padStart(3)}. ${r.name.padEnd(22)} ${r.pos}-${r.team.padEnd(3)} `
    + `adjADP ${String(r.adjAdp?.toFixed(1) ?? '-').padStart(5)}  `
    + `avail@${nxt.pick.overall} ${(r.availNext * 100).toFixed(0).padStart(3)}%  `
    + `takeNow ${r.takeNow.toFixed(0).padStart(3)}  ${r.tag.padEnd(7)} ${sev}`;
};

console.log('TOP 8 BY "BEST VALUE" (take-now score):');
sortBoard(rows, 'value').slice(0, 8).forEach((r) => console.log(fmt(r)));
console.log('\nTOP 8 BY GUIDE RANK:');
sortBoard(rows, 'joel').slice(0, 8).forEach((r) => console.log(fmt(r)));

console.log('\nTIERS BREAKING (2 or fewer left):');
tierStatus(rows).filter((t) => t.breaking).slice(0, 6)
  .forEach((t) => console.log(`  ${t.pos} tier ${t.tier}: ${t.remaining} left -- ${t.players.map((p) => p.name).join(', ')}`));
