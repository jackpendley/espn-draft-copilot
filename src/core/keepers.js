// Keeper handling: parsing the commissioner's sheet, simulating the real pick order
// once keeper slots are burned, and adjusting ADP for the players who never hit the pool.
//
// League rule (2026): keeping a player costs you THAT ROUND'S PICK. The cost escalates
// each year you keep the same player (8th -> 7th -> 6th), but only the round consumed
// this year matters to the draft math.

/**
 * Parse a paste from Google Sheets (TSV) or a CSV export.
 * Expected columns, in any order, matched case-insensitively by header:
 *   Team, Player, Round
 * A header row is detected and skipped; without one we assume Team, Player, Round order.
 */
export function parseKeeperPaste(text) {
  const rows = [];
  const errors = [];
  const lines = String(text || '').split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '');
  if (!lines.length) return { rows, errors };

  const split = (l) => (l.includes('\t') ? l.split('\t') : splitCsv(l)).map((c) => c.trim());

  let cols = { team: 0, player: 1, round: 2 };
  let start = 0;
  const first = split(lines[0]).map((c) => c.toLowerCase());
  const looksLikeHeader = first.some((c) => ['team', 'owner', 'manager'].includes(c))
    && first.some((c) => ['player', 'keeper', 'name'].includes(c));
  if (looksLikeHeader) {
    cols = {
      team: first.findIndex((c) => ['team', 'owner', 'manager'].includes(c)),
      player: first.findIndex((c) => ['player', 'keeper', 'name'].includes(c)),
      round: first.findIndex((c) => ['round', 'rd', 'cost', 'pick'].includes(c)),
    };
    start = 1;
  }

  for (let i = start; i < lines.length; i++) {
    const c = split(lines[i]);
    const team = c[cols.team] ?? '';
    const player = c[cols.player] ?? '';
    const roundRaw = c[cols.round] ?? '';
    if (!team && !player) continue;
    const round = parseInt(String(roundRaw).replace(/[^0-9]/g, ''), 10);
    if (!player) { errors.push({ line: i + 1, text: lines[i], reason: 'no player name' }); continue; }
    if (!Number.isFinite(round) || round < 1) {
      errors.push({ line: i + 1, text: lines[i], reason: `could not read a round from "${roundRaw}"` });
      continue;
    }
    rows.push({ team: team || '(unassigned)', player, round });
  }
  return { rows, errors };
}

function splitCsv(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Build the snake slot grid, then remove the slots consumed by keepers.
 *
 * @param teams        number of teams (12)
 * @param rounds       number of rounds (15)
 * @param keeperSlots  [{ teamSlot, round, player }] -- teamSlot is the 1-based draft position
 * @returns {
 *   slots:  every (round, teamSlot) in snake order, each flagged if a keeper burned it
 *   picks:  the live pick sequence, renumbered 1..N with keeper slots removed
 * }
 */
export function simulatePickOrder({ teams, rounds, keeperSlots = [] }) {
  const burned = new Map(); // "round:teamSlot" -> keeper
  for (const k of keeperSlots) burned.set(`${k.round}:${k.teamSlot}`, k);

  const slots = [];
  for (let round = 1; round <= rounds; round++) {
    const order = [];
    for (let i = 1; i <= teams; i++) order.push(i);
    if (round % 2 === 0) order.reverse();          // snake
    for (const teamSlot of order) {
      const keeper = burned.get(`${round}:${teamSlot}`) || null;
      slots.push({ round, teamSlot, keeper, isKeeper: !!keeper });
    }
  }

  const picks = [];
  for (const s of slots) {
    if (s.isKeeper) continue;
    picks.push({ overall: picks.length + 1, round: s.round, teamSlot: s.teamSlot });
  }
  return { slots, picks };
}

/** The live picks belonging to one draft slot, in order. */
export function picksForSlot(picks, teamSlot) {
  return picks.filter((p) => p.teamSlot === teamSlot);
}

/**
 * Your next pick at or after `currentOverall`, and how many picks until it.
 * Returns null once your picks are exhausted.
 */
export function nextPickForSlot(picks, teamSlot, currentOverall) {
  const mine = picks.filter((p) => p.teamSlot === teamSlot && p.overall >= currentOverall);
  if (!mine.length) return null;
  const next = mine[0];
  const after = mine[1] || null;
  return {
    pick: next,
    pickAfter: after,
    picksUntilNext: Math.max(0, next.overall - currentOverall),
    picksBetween: after ? after.overall - next.overall - 1 : null,
  };
}

/**
 * ESPN's ADP is a national average that assumes nobody was kept. In a keeper league the
 * kept players never enter the pool, so everyone below them effectively moves up.
 * Shift each remaining player up by the number of kept players ahead of them.
 *
 * @param players    [{ espnId, adp }]
 * @param keptIds    Set of espnIds that are kept
 */
export function keeperAdjustedAdp(players, keptIds) {
  const keptAdps = players
    .filter((p) => keptIds.has(p.espnId) && Number.isFinite(p.adp))
    .map((p) => p.adp)
    .sort((a, b) => a - b);

  const out = new Map();
  for (const p of players) {
    if (keptIds.has(p.espnId) || !Number.isFinite(p.adp)) continue;
    let ahead = 0;
    while (ahead < keptAdps.length && keptAdps[ahead] < p.adp) ahead++;
    out.set(p.espnId, Math.max(1, p.adp - ahead));
  }
  return out;
}

// --- availability ------------------------------------------------------------

/** Abramowitz & Stegun 7.1.26 approximation of erf. */
function erf(x) {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

const normalCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

/**
 * Spread of where a player actually goes, around their ADP. Later picks are noisier
 * in absolute terms, so scale with ADP but keep a floor for the top of the draft.
 */
export function adpStdDev(adp) {
  return Math.max(3.5, 0.22 * adp);
}

/**
 * Probability a player is still on the board when pick `targetOverall` arrives.
 * Uses the 0.5 continuity correction so "ADP exactly equals the pick" reads as ~50%.
 */
export function availabilityAt(adjAdp, targetOverall) {
  if (!Number.isFinite(adjAdp)) return null;
  const sd = adpStdDev(adjAdp);
  return 1 - normalCdf((targetOverall - 0.5 - adjAdp) / sd);
}
