// Sleeper reads. This exists so the real ESPN draft can be rehearsed somewhere the
// keepers actually occupy their rounds -- ESPN mocks can't do that, because this league
// tracks keepers in a spreadsheet rather than in ESPN.
//
// Everything here returns the SAME two shapes as espn-api.js, keyed by espnId, so that
// board.js / rules.js / keepers.js / Panel.js cannot tell the two platforms apart.
// Sleeper's API is public and CORS-open, so these are plain fetches -- no tab relay.

import { rateLimited } from './errors.js';
import { draftUrl, draftPicksUrl, userUrl } from './sleeper-constants.js';

async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } });
  } catch (err) {
    throw new Error(`Could not reach Sleeper: ${err.message || err}`);
  }
  if (res.status === 404) throw new Error('Sleeper has no draft with that ID. Check the ID from the draft room URL.');
  // Tagged distinctly so the poll loop can back off hard instead of just retrying fast.
  if (res.status === 429) throw rateLimited('Sleeper');
  if (!res.ok) throw new Error(`Sleeper returned HTTP ${res.status}.`);
  const body = await res.json();
  if (body == null) throw new Error('Sleeper returned an empty response for that ID.');
  return body;
}

/**
 * Draft settings, shaped like espn-api.js fetchLeague() so the panel can use either.
 * Note `rounds` is explicit here; ESPN makes us derive it from the roster slots.
 */
export async function fetchSleeperLeague(draftId) {
  const d = await getJson(draftUrl(draftId));
  const s = d.settings || {};

  // rules.js rosterNeeds() reads these keys, so use ESPN's names, not Sleeper's.
  const slotCounts = {};
  const put = (name, n) => { if (n) slotCounts[name] = n; };
  put('QB', s.slots_qb); put('RB', s.slots_rb); put('WR', s.slots_wr); put('TE', s.slots_te);
  put('FLEX', s.slots_flex); put('DST', s.slots_def); put('K', s.slots_k);
  put('SUPER_FLEX', s.slots_super_flex); put('BE', s.slots_bn); put('IR', s.slots_reserve);

  return {
    leagueId: draftId,
    name: d.metadata?.name || `Sleeper draft ${draftId}`,
    teams: s.teams || 12,
    rounds: s.rounds || 15,
    slotCounts,
    isKeeper: false,          // Sleeper is the practice platform; keepers come from the sheet
    keeperCount: 0,
    draftOrder: d.draft_order || {},
    teamsById: {},            // filled from slot_to_roster_id below, for parity with ESPN
    raw: {
      type: d.type || 'snake',
      status: d.status || 'pre_draft',
      reversalRound: s.reversal_round || 0,
      slotToRosterId: d.slot_to_roster_id || {},
      sleeperLeagueId: d.league_id || null,
      season: d.season || null,
    },
  };
}

/**
 * Live draft picks, shaped like espn-api.js fetchDraftPicks().
 *
 * Two translations matter:
 *
 * 1. Sleeper ids are strings ("9488", and the team abbrev "HOU" for defenses). They are
 *    mapped to espnIds through the build-time map in dataset.idMap.sleeper. A player ESPN
 *    doesn't carry gets the key `sl:<id>`: it resolves to nothing downstream, but it still
 *    OCCUPIES A SLOT, which matters because Panel.js counts drafted ids to find the live
 *    overall pick. Dropping it would make the counter silently lag.
 *
 * 2. Keeper picks are removed and the survivors renumbered 1..N. On draft day the keeper
 *    rounds are burned out of the snake (see simulatePickOrder), so a rehearsal where the
 *    keepers are drafted by hand has to have them taken back out again -- otherwise every
 *    overall number after the first keeper is one too high. `sleeperPickNo` keeps the raw
 *    number so the panel can reconcile against the number Sleeper's own clock shows.
 *
 * @param draftId
 * @param opts.idMap           { [sleeperId]: espnId } from dataset.idMap.sleeper
 * @param opts.keptIds         espnIds from the keeper sheet
 * @param opts.knownKeeperIds  sleeper ids already established as keepers for this draft,
 *                             remembered across polls -- see detectKeepers() below
 */
export async function fetchSleeperPicks(draftId, { idMap = {}, keptIds = [], knownKeeperIds = [] } = {}) {
  const [d, raw] = await Promise.all([getJson(draftUrl(draftId)), getJson(draftPicksUrl(draftId))]);
  const kept = keptIds instanceof Set ? keptIds : new Set(keptIds);

  const ordered = [...(raw || [])]
    .filter((p) => p.player_id)                       // an empty cell on the board
    .sort((a, b) => (a.pick_no || 0) - (b.pick_no || 0));

  const keeperIds = detectKeepers(ordered, d.status, knownKeeperIds);

  const picks = [];
  const keeperPicks = [];
  for (const p of ordered) {
    // One unexpected record shape must cost that one pick, never the whole poll -- a fast
    // draft can't afford the board freezing over a single row.
    try {
      const playerId = idMap[p.player_id] ?? `sl:${p.player_id}`;
      const row = {
        overall: picks.length + 1,                      // renumbered after keeper removal
        sleeperPickNo: p.pick_no,
        round: p.round,
        roundPick: pickInRound(p, d),
        teamId: p.roster_id ?? null,
        teamSlot: p.draft_slot ?? null,                 // Sleeper gives this; ESPN does not
        playerId,
        sleeperId: p.player_id,
        keeper: keeperIds.has(String(p.player_id)) || kept.has(playerId),
        autoDraft: false,                               // Sleeper's payload doesn't say
      };
      if (row.keeper) { keeperPicks.push({ playerId, round: p.round, teamSlot: p.draft_slot ?? null }); continue; }
      picks.push(row);
    } catch (err) {
      console.warn('[Draft Copilot] skipped an unparseable Sleeper pick:', err, p);
    }
  }

  return {
    drafted: d.status === 'complete',
    inProgress: d.status === 'drafting',
    status: d.status || 'pre_draft',
    picks,
    keeperPicks,
    rawPickCount: ordered.length,
    // Hand back everything now known to be a keeper so the caller can remember it: the
    // structural evidence below expires as the draft advances past each keeper's slot.
    detectedKeeperIds: [...keeperIds],
  };
}

/**
 * Which picks on the board were placed before the draft ran.
 *
 * Sleeper gives us nothing to go on directly -- `is_keeper` comes back null even on a real
 * keeper board, and `picked_by`/`roster_id` are empty on any mock. So this reads the shape
 * of the board instead, which cannot lie:
 *
 *   * Nothing can be a live pick while the draft is still `pre_draft`. Every pick sitting
 *     there is a keeper, full stop.
 *   * Once drafting, live picks fill 1, 2, 3 ... with no gaps, because a manager cannot
 *     pick out of turn. So a pick above that contiguous frontier was placed beforehand.
 *
 * The second test goes blind once the draft advances past a keeper's slot (pick 48 stops
 * looking special once picks 1-47 exist), which is why the answer is accumulated rather
 * than recomputed: `known` carries forward what earlier polls proved.
 */
export function detectKeepers(orderedPicks, status, knownKeeperIds = []) {
  const keepers = new Set((knownKeeperIds || []).map(String));

  // Nothing has been drafted yet, so everything on the board was put there.
  if (!status || status === 'pre_draft') {
    for (const p of orderedPicks) keepers.add(String(p.player_id));
    return keepers;
  }

  const present = new Set(orderedPicks.map((p) => p.pick_no));
  let frontier = 0;
  while (present.has(frontier + 1)) frontier += 1;

  for (const p of orderedPicks) {
    if (p.is_keeper === true || p.pick_no > frontier) keepers.add(String(p.player_id));
  }
  return keepers;
}

function pickInRound(p, d) {
  const teams = d.settings?.teams || 12;
  return p.pick_no ? ((p.pick_no - 1) % teams) + 1 : null;
}

/** Resolve a Sleeper display name to a user_id, so the draft slot can be derived. */
export async function fetchSleeperUser(username) {
  const u = await getJson(userUrl(username));
  if (!u?.user_id) throw new Error(`Sleeper has no user called "${username}".`);
  return { userId: u.user_id, displayName: u.display_name || username };
}

/** The 1-based draft slot a user_id was dealt, or null if they're not in this draft. */
export function slotForUser(league, userId) {
  if (!userId) return null;
  const n = league?.draftOrder?.[userId];
  return Number.isFinite(n) ? n : null;
}
