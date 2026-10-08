// Pure summaries behind the options page's "replay a finished draft" diagnostics and the
// keeper-sheet matcher, split out of options.js so they can be tested without a DOM.

import { resolve } from '../core/names.js';

const byIdMap = (players) => new Map((players || []).map((p) => [p.espnId, p]));

/** Match each parsed keeper-sheet row to a dataset player. */
export function resolveKeeperRows(rows, index) {
  return rows.map((r) => {
    const m = resolve(index, r.player, null, {});
    return {
      ...r,
      espnId: m.player?.espnId ?? null,
      matchedName: m.player?.name ?? null,
      pos: m.player?.pos ?? null,
      nflTeam: m.player?.team ?? null,   // keep separate: r.team is the OWNER from the sheet
      how: m.how ?? m.reason,
    };
  });
}

/** Summarise a replayed ESPN draft (picks as returned by the 'picks' message). */
export function summarizeEspnPicks(rawPicks, season, players) {
  const byId = byIdMap(players);
  const picks = rawPicks || [];
  const withPlayers = picks.filter((p) => p.playerId);   // D/ST ids are negative; 0 is no selection
  const dstPicks = withPlayers.filter((p) => p.playerId < 0);
  const resolved = withPlayers.filter((p) => byId.has(p.playerId));
  return {
    platform: 'espn',
    season,
    total: picks.length,
    keepers: picks.filter((p) => p.keeper).length,
    resolved: resolved.length,
    unresolved: withPlayers.length - resolved.length,
    dst: dstPicks.length,
    skipped: picks.length - withPlayers.length,
    rounds: picks.length ? Math.max(...picks.map((p) => p.round)) : 0,
    teams: new Set(picks.map((p) => p.teamId)).size,
    sample: picks.slice(0, 6).map((p) => ({
      overall: p.overall, round: p.round, teamId: p.teamId, keeper: p.keeper,
      name: byId.get(p.playerId)?.name || `(id ${p.playerId})`,
    })),
  };
}

/** Summarise a replayed Sleeper draft (the full 'picks' response). */
export function summarizeSleeperPicks(response, draftId, players, configuredKeepers) {
  const byId = byIdMap(players);
  const picks = response.picks || [];
  const unmapped = picks.filter((p) => typeof p.playerId === 'string');
  const resolved = picks.filter((p) => byId.has(p.playerId));
  return {
    platform: 'sleeper',
    season: draftId,
    total: response.rawPickCount ?? picks.length,
    keepers: (response.keeperPicks || []).length,
    keepersConfigured: (configuredKeepers || []).length,
    keeperRows: (response.keeperPicks || []).map((k) => ({
      name: byId.get(k.playerId)?.name || String(k.playerId),
      round: k.round, slot: k.teamSlot,
    })).sort((a, b) => a.round - b.round || a.slot - b.slot),
    resolved: resolved.length,
    // Two different failures: an id Sleeper has that ESPN doesn't, versus a real ESPN
    // player who simply isn't on the guide's board. Only the first is a worry.
    unresolved: picks.length - resolved.length,
    unmapped: unmapped.length,
    dst: picks.filter((p) => typeof p.playerId === 'number' && p.playerId < 0).length,
    skipped: 0,
    rounds: picks.length ? Math.max(...picks.map((p) => p.round)) : 0,
    teams: new Set(picks.map((p) => p.teamSlot)).size,
    sample: picks.slice(0, 6).map((p) => ({
      overall: p.overall, round: p.round, teamId: p.teamSlot, keeper: false,
      name: byId.get(p.playerId)?.name || `(sleeper id ${p.sleeperId})`,
    })),
  };
}
