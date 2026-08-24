// ESPN fantasy football enum maps. Stable across seasons.

export const POSITION_BY_ID = {
  1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST',
};

export const PRO_TEAM_BY_ID = {
  0: 'FA',
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET',
  9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN',
  17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC',
  25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};

// The guide uses a few abbreviations that differ from ESPN's.
export const TEAM_ALIASES = {
  HST: 'HOU', BLT: 'BAL', CLV: 'CLE', ARZ: 'ARI', LA: 'LAR', JAC: 'JAX', WSH: 'WAS',
};

export function normalizeTeam(abbr) {
  if (!abbr) return null;
  const up = String(abbr).toUpperCase();
  return TEAM_ALIASES[up] || up;
}

export const SEASON = 2026;
export const READ_HOST = 'https://lm-api-reads.fantasy.espn.com';
export const PLAYER_UNIVERSE_URL =
  `${READ_HOST}/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leaguedefaults/3?view=kona_player_info`;

export function leagueUrl(leagueId, views) {
  const q = views.map((v) => `view=${v}`).join('&');
  return `${READ_HOST}/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${leagueId}?${q}`;
}
