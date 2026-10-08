#!/usr/bin/env node
// Joins the hand-transcribed guide files against the cached ESPN player universe and
// emits dist/dataset.json. Exits non-zero if any guide name fails to resolve, so a
// transcription typo can never reach draft day silently.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as P from './parse-guide.mjs';
import { buildIndex, resolve, normalizeName } from '../src/core/names.js';
import { buildSleeperIdMap } from '../src/core/sleeper-ids.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const G = (f) => join(ROOT, 'data/guide', f);
const CACHE = join(ROOT, 'data/cache/espn-players.json');
const SLEEPER_CACHE = join(ROOT, 'data/cache/sleeper-players.json');

if (!existsSync(CACHE)) {
  console.error('Missing data/cache/espn-players.json -- run `npm run fetch:players` first.');
  process.exit(1);
}

const espn = JSON.parse(readFileSync(CACHE, 'utf8'));
const index = buildIndex(espn.players);
const aliases = JSON.parse(readFileSync(join(ROOT, 'data/overrides/aliases.json'), 'utf8')).aliases;

const unmatched = [];
const fuzzy = [];

/** Resolve or record. Returns the ESPN player or null. */
function look(name, pos, source) {
  const r = resolve(index, name, pos, aliases);
  if (!r.player) { unmatched.push({ source, name, pos: pos || '?', candidates: r.candidates }); return null; }
  if (r.fuzzy || r.how === 'name-most-owned') {
    fuzzy.push({ source, name, pos: pos || '?', matched: r.player.name, how: r.how });
  }
  return r.player;
}

// ---- load every guide section -------------------------------------------------
const pprBoard   = P.parseBigBoard(G('big-board-ppr.txt'));
const halfBoard  = P.parseBigBoard(G('big-board-half.txt'));
const positional = P.parsePositional(G('positional-ppr.txt'));
const adjPpg     = P.parseAdjustedPpg(G('adjusted-ppg.txt'));
const luck       = P.parseLuck(G('luck-metric.txt'));
const rbVolume   = P.parseRbVolume(G('rb-volume.txt'));
const pprLean    = P.parsePprLean(G('ppr-lean.txt'));
const goldMine   = P.parseGoldMine(G('rb-gold-mine.txt'));
const teams      = P.parseTeams(G('teams.txt'));
const playcaller = P.parsePlaycallers(G('playcallers.txt'));
const dst        = P.parseDst(G('dst.txt'));
const kickers    = P.parseKickers(G('kickers.txt'));
const strategy   = JSON.parse(readFileSync(G('strategy.json'), 'utf8'));
const top50      = JSON.parse(readFileSync(G('top50-stats.json'), 'utf8'));
const profiles   = JSON.parse(readFileSync(G('profiles.json'), 'utf8'));

// ---- structural validation before we join anything ----------------------------
const problems = [];
function checkSequence(rows, key, label, expected) {
  const got = rows.map((r) => r[key]);
  for (let i = 0; i < expected; i++) {
    if (got[i] !== i + 1) { problems.push(`${label}: expected ${key} ${i + 1} at row ${i + 1}, got ${got[i]}`); break; }
  }
  if (rows.length !== expected) problems.push(`${label}: expected ${expected} rows, got ${rows.length}`);
}
checkSequence(pprBoard, 'rank', 'big-board-ppr', 150);
checkSequence(halfBoard, 'rank', 'big-board-half', 150);
for (const [pos, n] of [['QB', 32], ['RB', 60], ['WR', 60], ['TE', 32]]) {
  checkSequence(positional.filter((r) => r.pos === pos), 'posRank', `positional ${pos}`, n);
}
// The two boards must name the same 150 players.
const setP = new Set(pprBoard.map((r) => normalizeName(r.name)));
const setH = new Set(halfBoard.map((r) => normalizeName(r.name)));
for (const n of setP) if (!setH.has(n)) problems.push(`in PPR board but not Half board: ${n}`);
for (const n of setH) if (!setP.has(n)) problems.push(`in Half board but not PPR board: ${n}`);

// ---- build the per-player records ---------------------------------------------
const players = new Map(); // espnId -> record

function rec(espnPlayer) {
  if (!players.has(espnPlayer.espnId)) {
    players.set(espnPlayer.espnId, {
      espnId: espnPlayer.espnId,
      name: espnPlayer.name,
      pos: espnPlayer.pos,
      team: espnPlayer.team,
      espn: {
        adp: espnPlayer.adp,
        adpChange: espnPlayer.adpChange,
        percentOwned: espnPlayer.percentOwned,
        auctionValue: espnPlayer.auctionValue,
        pprRank: espnPlayer.espnPprRank,
        injuryStatus: espnPlayer.injuryStatus,
        seasonOutlook: espnPlayer.seasonOutlook,
      },
      joel: {
        pprRank: null, halfRank: null, posRank: null, tier: null, tag: 'neutral',
        adjPpg25: null, adjPpgRank: null, adjPpgNote: null,
        luck: null, pprLean: null, rbVolume: null, goldMine: null,
        stats: [], profile: null,
      },
    });
  }
  return players.get(espnPlayer.espnId);
}

for (const r of pprBoard)  { const p = look(r.name, r.pos, 'big-board-ppr');  if (p) { const x = rec(p); x.joel.pprRank = r.rank; x.joel.tag = r.tag; } }
for (const r of halfBoard) { const p = look(r.name, r.pos, 'big-board-half'); if (p) rec(p).joel.halfRank = r.rank; }
for (const r of positional) {
  const p = look(r.name, r.pos, 'positional-ppr');
  if (p) { const x = rec(p); x.joel.posRank = r.posRank; x.joel.tier = r.tier; if (x.joel.tag === 'neutral') x.joel.tag = r.tag; }
}
for (const r of adjPpg) {
  const p = look(r.name, r.pos, 'adjusted-ppg');
  if (p) { const x = rec(p); x.joel.adjPpg25 = r.adjPpg; x.joel.adjPpgRank = r.rank; x.joel.adjPpgNote = r.reason; }
}
for (const r of luck)     { const p = look(r.name, null, 'luck-metric');  if (p) rec(p).joel.luck = { totalLost: r.totalLost, pctLost: r.pctLost }; }
for (const r of rbVolume) { const p = look(r.name, 'RB', 'rb-volume');    if (p) rec(p).joel.rbVolume = { projVolumeRank: r.projVolumeRank, adjVolume25: r.adjVolume25, confidence: r.confidence, smallSample: r.smallSample }; }
for (const r of pprLean)  { const p = look(r.name, r.pos, 'ppr-lean');    if (p) rec(p).joel.pprLean = { pctViaRec: r.pctViaRec, lean: r.lean }; }
for (const r of goldMine) { const p = look(r.name, 'RB', 'rb-gold-mine'); if (p) rec(p).joel.goldMine = { bucket: r.bucket, borderline: r.borderline }; }
for (const r of kickers)  { const p = look(r.name, 'K', 'kickers');       if (p) { const x = rec(p); x.joel.kicker = r; } }

for (const s of top50.stats) {
  for (const n of s.players) { const p = look(n, null, `top50-stat-${s.n}`); if (p) rec(p).joel.stats.push(s.n); }
}
for (const pr of profiles.profiles) {
  const p = look(pr.name, pr.pos, 'profiles');
  if (p) rec(p).joel.profile = pr;
}

// D/ST records are team-level; attach to the ESPN D/ST player entries.
const dstByTeam = Object.fromEntries(dst.map((d) => [d.team, d]));
for (const p of espn.players.filter((x) => x.pos === 'DST')) {
  const d = dstByTeam[p.team];
  if (d) { const x = rec(p); x.joel.dst = d; }
}

// ---- team context -------------------------------------------------------------
const teamCtx = {};
for (const t of teams) teamCtx[t.team] = { ...t };
for (const pc of playcaller) {
  teamCtx[pc.team] = { ...(teamCtx[pc.team] || { team: pc.team }), playcaller: pc };
}

// ---- sleeper id map -----------------------------------------------------------
// Lets a Sleeper mock draft cross players off this (ESPN-keyed) board. Optional: someone
// who only ever drafts on ESPN can build without it, and the Sleeper feed then simply
// resolves nothing. Never fails the build -- unlike a guide name, an unmatched Sleeper
// player is expected (their dump carries 4000+ players; ESPN carries ~1000).
let sleeperIds = { map: {}, matched: 0, unmatched: [], byHow: {}, collisions: [] };
if (existsSync(SLEEPER_CACHE)) {
  const slCache = JSON.parse(readFileSync(SLEEPER_CACHE, 'utf8'));
  sleeperIds = buildSleeperIdMap(slCache.players, espn.players, aliases);

  // Years of NFL experience (0 = rookie), via the same id map -- flags young keeper-league
  // targets in the panel. Best-effort: only covers players the Sleeper map reaches.
  const expBySleeperId = new Map(slCache.players.map((p) => [p.sleeperId, p.yearsExp]));
  for (const [sleeperId, espnId] of Object.entries(sleeperIds.map)) {
    const exp = expBySleeperId.get(sleeperId);
    if (exp != null && players.has(espnId)) players.get(espnId).yearsExp = exp;
  }
} else {
  console.warn('No data/cache/sleeper-players.json -- run `npm run fetch:sleeper` to enable Sleeper drafts.');
}

// The number that actually matters: every player on Joel's board must be reachable from a
// Sleeper pick, or a rehearsal would leave them sitting there after someone took them.
const mappedEspnIds = new Set(Object.values(sleeperIds.map));

// ---- report -------------------------------------------------------------------
const out = {
  builtAt: new Date().toISOString(),
  espnFetchedAt: espn.fetchedAt,
  source: "Joel Smyth's Draft Guide 2026 (last update August 23rd)",
  scoring: 'PPR',
  idMap: { sleeper: sleeperIds.map },
  strategy,
  top50: top50.stats,
  teamCtx,
  dst,
  kickers,
  players: [...players.values()].sort((a, b) => (a.joel.pprRank ?? 999) - (b.joel.pprRank ?? 999)),
};

const reportLines = [];
if (problems.length) {
  reportLines.push('STRUCTURAL PROBLEMS:', ...problems.map((p) => `  ${p}`), '');
}
if (fuzzy.length) {
  reportLines.push('FUZZY / AMBIGUOUS MATCHES (review these):');
  for (const f of fuzzy) reportLines.push(`  [${f.source}] "${f.name}" (${f.pos}) -> ${f.matched}  via ${f.how}`);
  reportLines.push('');
}
if (unmatched.length) {
  reportLines.push('UNMATCHED (add to data/overrides/aliases.json):');
  for (const u of unmatched) reportLines.push(`  [${u.source}] "${u.name}" (${u.pos})  nearest: ${u.candidates.join(', ') || 'none'}`);
}

// Sleeper's dump carries four times as many players as ESPN does, so most of its misses
// are simply people ESPN has no row for. Only the guide's own players matter.
const boardUnreachable = out.players.filter((p) => !mappedEspnIds.has(p.espnId));
if (Object.keys(sleeperIds.map).length) {
  reportLines.push('', '## sleeper id map', `  mapped ${sleeperIds.matched} sleeper ids`
    + `  (${Object.entries(sleeperIds.byHow).map(([k, v]) => `${k}:${v}`).join(' ')})`);
  if (sleeperIds.collisions.length) {
    reportLines.push('  same-name collisions, rostered player kept:');
    for (const c of sleeperIds.collisions) reportLines.push(`    ${c.kept}  over  ${c.dropped.join(', ')}`);
  }
  if (boardUnreachable.length) {
    reportLines.push('  GUIDE PLAYERS WITH NO SLEEPER ID (they will not be crossed off in a Sleeper mock):');
    for (const p of boardUnreachable) reportLines.push(`    ${p.name} (${p.pos} ${p.team})`);
  }
}

writeFileSync(join(ROOT, 'data/overrides/unmatched-report.txt'),
  reportLines.join('\n') || 'Clean build: every guide name resolved to an ESPN id.\n');

console.log(`players: ${out.players.length}`);
console.log(`  with a PPR board rank: ${out.players.filter((p) => p.joel.pprRank).length}`);
console.log(`  with adjusted PPG:     ${out.players.filter((p) => p.joel.adjPpg25 != null).length}`);
console.log(`  with luck metric:      ${out.players.filter((p) => p.joel.luck).length}`);
console.log(`  with a profile card:   ${out.players.filter((p) => p.joel.profile).length}`);
console.log(`sleeper ids mapped: ${sleeperIds.matched}`
  + (boardUnreachable.length ? `  -- ${boardUnreachable.length} guide players NOT reachable from Sleeper` : '  (every guide player reachable)'));
console.log(`structural problems: ${problems.length}`);
console.log(`fuzzy matches: ${fuzzy.length}   unmatched: ${unmatched.length}`);
if (problems.length || unmatched.length) {
  console.error('\nBuild FAILED. See data/overrides/unmatched-report.txt');
  process.exit(1);
}
writeFileSync(join(ROOT, 'dist/dataset.json'), JSON.stringify(out));
console.log(`\nWrote dist/dataset.json (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
