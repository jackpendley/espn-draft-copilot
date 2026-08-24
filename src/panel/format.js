// Small display helpers shared by the panel and the in-page badges.

export const TAG_COLOR = {
  target: '#1f9d4d', pass: '#c99700', avoid: '#c62828', neutral: '#8a8f98',
};
export const TAG_LABEL = { target: 'TARGET', pass: "PASS", avoid: 'AVOID', neutral: '' };

export const SEV_COLOR = {
  block: '#c62828', warn: '#c99700', note: '#5a6270', good: '#1f9d4d',
};

export const pct = (v) => (v == null ? '--' : `${Math.round(v * 100)}%`);
export const one = (v) => (v == null ? '--' : Number(v).toFixed(1));

/** Signed number with an explicit +, for value deltas. */
export const signed = (v, digits = 0) =>
  (v == null ? '--' : `${v > 0 ? '+' : ''}${Number(v).toFixed(digits)}`);

export const INJURY_SHORT = {
  ACTIVE: null, QUESTIONABLE: 'Q', DOUBTFUL: 'D', OUT: 'OUT',
  INJURY_RESERVE: 'IR', SUSPENSION: 'SUSP', DAY_TO_DAY: 'DTD',
};

/** Ordinal round label for a pick: 3.07 style. */
export const pickLabel = (round, roundPick) =>
  `${round}.${String(roundPick).padStart(2, '0')}`;

export const GAMESCRIPT_LABEL = {
  shootout: 'Shootout', 'shootout-lite': 'Shootout lean', balanced: 'Balanced',
  'chew-clock': 'Chews clock', slugfest: 'Slugfest', 'passing-garbage-time': 'Passing/garbage time',
};

export const GOLD_MINE_LABEL = {
  'gold-standard': 'Gold Standard', 'gold-diggers': 'Gold Digger',
  'silver-lining': 'Silver Lining', 'fools-gold': "Fool's Gold",
};

export const OL_TREND_LABEL = { up2: '↑↑', up: '↑', flat: '–', down: '↓', down2: '↓↓' };
