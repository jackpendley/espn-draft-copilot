// Builds the sleeperId -> espnId map that lets a Sleeper draft cross players off an
// ESPN-keyed board. Runs at BUILD time, like every other name match in this project, so
// draft-day code never guesses (see names.js).
//
// Sleeper does publish an `espn_id` field, but it is null for roughly half of all active
// players -- including Jaxon Smith-Njigba, a top-10 pick -- so it cannot be the index.
// Measured against the real feeds: when espn_id IS present it agrees with a name match
// 111 times out of 112, which makes it a good tiebreak and a bad primary key.
//
// Two deliberate restrictions, both because this map is built in bulk over 4000+ players
// with nobody reviewing the result the way a human reviews the guide's unmatched report:
//
//   * NO FUZZY MATCHING. Edit-distance matching over a list this size is confidently
//     wrong -- it maps Roddy White onto Cody White and Calvin Johnson onto Collin Johnson.
//     A mis-mapped id crosses the WRONG player off the board mid-draft, which is worse
//     than leaving the pick unresolved (an unresolved pick still counts, it just doesn't
//     strike anyone). Only exact name+position, Sleeper's own espn_id, and defenses.
//   * RETIRED PLAYERS ARE SKIPPED. Sleeper's dump keeps everyone forever, and a retired
//     namesake will happily claim an active player's id (Frank Gore -> Frank Gore Jr).

import { buildIndex, resolve } from './names.js';

/**
 * @param sleeperPlayers  [{ sleeperId, name, pos, team, espnId, active }]
 * @param espnPlayers     [{ espnId, name, pos, team, percentOwned }]
 * @param aliases         data/overrides/aliases.json
 * @returns { map, matched, unmatched, byHow, collisions }
 */
export function buildSleeperIdMap(sleeperPlayers, espnPlayers, aliases = {}) {
  const index = buildIndex(espnPlayers);
  const espnById = new Map(espnPlayers.map((p) => [p.espnId, p]));
  // Sleeper keys defenses by team abbreviation ("HOU"); ESPN gives them negative ids.
  const dstByTeam = new Map(espnPlayers.filter((p) => p.pos === 'DST').map((p) => [p.team, p]));

  const claims = new Map();   // espnId -> [{ sleeperId, how, player }]
  const unmatched = [];
  const byHow = {};
  const note = (how) => { byHow[how] = (byHow[how] || 0) + 1; };
  const claim = (espnId, s, how) => {
    if (!claims.has(espnId)) claims.set(espnId, []);
    claims.get(espnId).push({ sleeperId: s.sleeperId, how, player: s });
  };

  for (const s of sleeperPlayers) {
    if (s.pos === 'DEF') {
      const d = dstByTeam.get(s.team || s.sleeperId);
      if (d) { claim(d.espnId, s, 'dst-team'); continue; }
      unmatched.push(pick(s));
      continue;
    }

    if (s.active === false) continue;   // retired: not draftable, and a namesake hazard

    if (s.espnId && espnById.has(s.espnId)) { claim(s.espnId, s, 'espn-id'); continue; }

    const r = resolve(index, s.name, s.pos, aliases);
    if (r.player && !r.fuzzy) { claim(r.player.espnId, s, r.how); continue; }

    unmatched.push(pick(s));
  }

  // One ESPN player, one Sleeper id. Where several still claim the same id, keep the one
  // on an NFL roster -- that is the one who can actually be drafted.
  const map = {};
  const collisions = [];
  for (const [espnId, cs] of claims) {
    const winner = cs.length === 1 ? cs[0] : [...cs].sort(rank)[0];
    map[winner.sleeperId] = espnId;
    note(winner.how);
    if (cs.length > 1) {
      collisions.push({
        espnId,
        kept: `${winner.player.name} (${winner.player.team || 'FA'})`,
        dropped: cs.filter((c) => c !== winner).map((c) => `${c.player.name} (${c.player.team || 'FA'})`),
      });
      for (const c of cs) if (c !== winner) unmatched.push(pick(c.player));
    }
  }

  return { map, matched: Object.keys(map).length, unmatched, byHow, collisions };
}

// Prefer a rostered player, then one Sleeper still lists as active, then an exact match.
function rank(a, b) {
  return (b.player.team ? 1 : 0) - (a.player.team ? 1 : 0)
      || (b.player.active ? 1 : 0) - (a.player.active ? 1 : 0)
      || (a.how === 'espn-id' ? -1 : 0) - (b.how === 'espn-id' ? -1 : 0);
}

const pick = (s) => ({ sleeperId: s.sleeperId, name: s.name, pos: s.pos, team: s.team });
