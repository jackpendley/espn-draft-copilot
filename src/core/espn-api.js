// ESPN reads. The player universe is public; league views need the user's cookies,
// which we get for free from host_permissions + credentials: 'include'.

import { leagueUrl, POSITION_BY_ID, PRO_TEAM_BY_ID } from './espn-constants.js';
import { fetchViaPageOrDirect } from './espn-fetch.js';

// Private-league reads need the user's cookies; see espn-fetch.js for why this is
// not a plain fetch.
const getJson = (url, extraHeaders = {}) => fetchViaPageOrDirect(url, extraHeaders);

/** League settings + teams: size, roster slots, scoring, and who owns which draft slot. */
export async function fetchLeague(leagueId) {
  const data = await getJson(leagueUrl(leagueId, ['mSettings', 'mTeam']));
  const s = data.settings || {};
  const draft = s.draftSettings || {};
  const roster = s.rosterSettings || {};

  const slotCounts = {};
  for (const [slotId, count] of Object.entries(roster.lineupSlotCounts || {})) {
    if (!count) continue;
    slotCounts[LINEUP_SLOT[slotId] || `SLOT${slotId}`] = count;
  }

  return {
    leagueId,
    name: s.name || `League ${leagueId}`,
    teams: (data.teams || []).length || s.size || 12,
    rounds: countRounds(slotCounts),
    slotCounts,
    isKeeper: !!(draft.keeperCount || draft.keeperCountFuture),
    keeperCount: draft.keeperCount ?? 0,
    draftOrder: draft.pickOrder || [],
    teamsById: Object.fromEntries((data.teams || []).map((t) => [
      t.id, { id: t.id, name: [t.location, t.nickname].filter(Boolean).join(' ').trim() || t.name || `Team ${t.id}` },
    ])),
    raw: { draftSettings: draft },
  };
}

/** Live draft picks. Poll this during the draft. */
export async function fetchDraftPicks(leagueId) {
  const data = await getJson(leagueUrl(leagueId, ['mDraftDetail']));
  const dd = data.draftDetail || {};
  return {
    drafted: !!dd.drafted,
    inProgress: !!dd.inProgress,
    picks: (dd.picks || []).map((p) => ({
      overall: p.overallPickNumber,
      round: p.roundId,
      roundPick: p.roundPickNumber,
      teamId: p.teamId,
      playerId: p.playerId,
      keeper: !!p.keeper,
      autoDraft: !!p.autoDraftTypeId,
    })).sort((a, b) => a.overall - b.overall),
  };
}

const LINEUP_SLOT = {
  0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 16: 'DST', 17: 'K',
  23: 'FLEX', 20: 'BE', 21: 'IR', 7: 'OP',
};

function countRounds(slotCounts) {
  return Object.entries(slotCounts)
    .filter(([k]) => k !== 'IR')
    .reduce((n, [, c]) => n + c, 0) || 15;
}

export { POSITION_BY_ID, PRO_TEAM_BY_ID };
