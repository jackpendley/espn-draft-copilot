// Board assembly: merge the guide dataset with live draft state, score value, and
// derive the tier/run signals. Pure functions -- no DOM, no chrome.*.

import { keeperAdjustedAdp, availabilityAt } from './keepers.js';

export const TAG_ORDER = { target: 0, neutral: 1, pass: 2, avoid: 3 };
export const TAG_LABEL = { target: 'Target', neutral: '', pass: "I'll Pass", avoid: 'Avoiding' };

/**
 * @param dataset      dist/dataset.json
 * @param state {
 *   draftedIds:  Set of espnIds already taken
 *   keptIds:     Set of espnIds kept (never enter the pool)
 *   currentOverall: the live overall pick number
 *   myNextOverall:  overall number of my next pick (null if none left)
 * }
 */
export function buildBoard(dataset, state) {
  const {
    draftedIds = new Set(), keptIds = new Set(),
    currentOverall = 1, myNextOverall = null,
  } = state;

  const adjAdp = keeperAdjustedAdp(
    dataset.players.map((p) => ({ espnId: p.espnId, adp: p.espn.adp })),
    keptIds,
  );

  const rows = [];
  for (const p of dataset.players) {
    if (keptIds.has(p.espnId) || draftedIds.has(p.espnId)) continue;
    const a = adjAdp.get(p.espnId) ?? null;
    const joelRank = p.joel.pprRank;

    // Chance this player is gone before my next turn.
    const availNext = myNextOverall != null ? availabilityAt(a, myNextOverall) : null;
    const urgency = availNext == null ? null : 1 - availNext;

    // How many picks early I'd be taking them relative to the adjusted market.
    const reach = a == null ? null : a - currentOverall;
    // How far Joel is ahead of the market on them (positive = he likes them more).
    const edge = (a == null || joelRank == null) ? null : a - joelRank;

    // "Take now" value: how good they are, weighted by how likely they vanish.
    // A stud certain to last is a bad pick NOW; a stud certain to be gone is urgent.
    const baseValue = joelRank == null ? 0 : Math.max(0, 220 - joelRank);
    const takeNow = urgency == null ? baseValue : baseValue * urgency;

    rows.push({
      espnId: p.espnId, name: p.name, pos: p.pos, team: p.team,
      joelRank, halfRank: p.joel.halfRank, posRank: p.joel.posRank,
      tier: p.joel.tier, tag: p.joel.tag,
      adp: p.espn.adp, adjAdp: a, injuryStatus: p.espn.injuryStatus,
      reach, edge, availNext, takeNow,
      joel: p.joel,
    });
  }
  return rows;
}

export const SORTS = {
  joel: (a, b) => (a.joelRank ?? 9999) - (b.joelRank ?? 9999),
  value: (a, b) => b.takeNow - a.takeNow,
  adp: (a, b) => (a.adjAdp ?? 9999) - (b.adjAdp ?? 9999),
  edge: (a, b) => (b.edge ?? -9999) - (a.edge ?? -9999),
};

export function sortBoard(rows, mode = 'value') {
  return [...rows].sort(SORTS[mode] || SORTS.value);
}

export function filterBoard(rows, { positions, hideAvoid, targetsOnly, search } = {}) {
  let out = rows;
  if (positions && positions.length) out = out.filter((r) => positions.includes(r.pos));
  if (hideAvoid) out = out.filter((r) => r.tag !== 'avoid');
  if (targetsOnly) out = out.filter((r) => r.tag === 'target');
  if (search) {
    const q = search.toLowerCase();
    out = out.filter((r) => r.name.toLowerCase().includes(q) || r.team.toLowerCase().includes(q));
  }
  return out;
}

/**
 * How many players remain in each (position, tier), and which tiers are about to break.
 * Tiers come from the gold underlines in the guide's positional rankings.
 */
export function tierStatus(rows) {
  const byPosTier = new Map();
  for (const r of rows) {
    if (r.tier == null) continue;
    const k = `${r.pos}|${r.tier}`;
    if (!byPosTier.has(k)) byPosTier.set(k, []);
    byPosTier.get(k).push(r);
  }
  const out = [];
  for (const [k, players] of byPosTier) {
    const [pos, tier] = k.split('|');
    out.push({
      pos, tier: Number(tier), remaining: players.length,
      players: players.sort((a, b) => (a.posRank ?? 999) - (b.posRank ?? 999)),
      breaking: players.length <= 2,
    });
  }
  return out.sort((a, b) => a.pos.localeCompare(b.pos) || a.tier - b.tier);
}

/**
 * Positional run detection over the last N picks.
 * @param recentPicks [{ pos }] most recent last
 */
export function positionRuns(recentPicks, windowSize = 8) {
  const w = recentPicks.slice(-windowSize);
  if (w.length < 4) return [];
  const counts = {};
  for (const p of w) counts[p.pos] = (counts[p.pos] || 0) + 1;
  return Object.entries(counts)
    .filter(([, n]) => n / w.length >= 0.5 && n >= 3)
    .map(([pos, n]) => ({ pos, count: n, of: w.length }))
    .sort((a, b) => b.count - a.count);
}
