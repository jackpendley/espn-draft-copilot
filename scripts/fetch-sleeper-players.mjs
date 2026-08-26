#!/usr/bin/env node
// Pulls Sleeper's NFL player universe into data/cache/sleeper-players.json. It is only
// needed to build the sleeperId -> espnId map, which is what lets a Sleeper mock draft
// cross players off Joel's (ESPN-keyed) board.
//
// The dump is ~14 MB and Sleeper asks that it be fetched at most once a day, so this is a
// separate script from the build rather than something the build re-downloads.

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PLAYERS_URL } from '../src/core/sleeper-constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data/cache/sleeper-players.json');

// Everything else in the dump is roster filler we will never see in a fantasy draft.
const KEEP_POS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

async function main() {
  process.stdout.write('Fetching the Sleeper player universe (~14 MB)...\n');
  const res = await fetch(PLAYERS_URL, {
    headers: { accept: 'application/json', 'user-agent': 'espn-draft-copilot/0.1' },
  });
  if (!res.ok) throw new Error(`Sleeper returned HTTP ${res.status} ${res.statusText}`);

  const body = await res.json();
  const players = Object.values(body || {})
    .filter((p) => p && p.player_id && KEEP_POS.has(p.position))
    .map((p) => ({
      sleeperId: String(p.player_id),
      name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' '),
      pos: p.position,
      team: p.team || null,
      // Present for only ~55% of players (null even for Jaxon Smith-Njigba), so it is a
      // tiebreak, never the index. See build-dataset.mjs.
      espnId: p.espn_id ? Number(p.espn_id) : null,
      active: !!p.active,
      searchRank: p.search_rank ?? null,
    }));

  await mkdir(join(ROOT, 'data/cache'), { recursive: true });
  await writeFile(OUT, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    count: players.length,
    players,
  }, null, 2));

  const byPos = players.reduce((a, p) => { a[p.pos] = (a[p.pos] || 0) + 1; return a; }, {});
  process.stdout.write(`Wrote ${players.length} players to ${OUT}\n`);
  process.stdout.write(`  ${Object.entries(byPos).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ')}\n`);
  process.stdout.write(`  with a usable espn_id: ${players.filter((p) => p.espnId).length}\n`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
