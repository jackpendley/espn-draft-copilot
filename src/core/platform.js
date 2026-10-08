// Which draft site are we on, and what does it look like there.
//
// The panel runs on two platforms: ESPN, where the real draft happens, and Sleeper, which
// exists purely so the thing can be rehearsed with keepers in their proper slots. Only the
// pick feed and the page markup differ -- board.js, rules.js and keepers.js never learn
// that there is more than one.

export const ESPN = 'espn';
export const SLEEPER = 'sleeper';

export const PLATFORMS = {
  [ESPN]: {
    id: ESPN,
    label: 'ESPN',
    host: /(^|\.)espn\.com$/,
    // ESPN has used several table shells over the years; try them broadly and bail quietly.
    rowSelectors: [
      '.Table__TR',
      'tr[class*="Table__TR"]',
      '[class*="playerTableRow"]',
      '[class*="PlayerRow"]',
    ],
    nameSelectors: [
      '.player-column__athlete .AnchorLink',
      '.player-column__bio .AnchorLink',
      'a[href*="/football/player/"]',
      '[class*="playerinfo__playername"]',
    ],
    isDraftRoom(loc = location, doc = document) {
      return /\/football\/(draft|mockdraft|mockdraftlobby)/.test(loc.pathname)
        || doc.querySelector('.draft-columns, [class*="draftContainer"], [class*="PlayerTable"]') != null;
    },
  },

  [SLEEPER]: {
    id: SLEEPER,
    label: 'Sleeper',
    host: /(^|\.)sleeper\.(com|app)$/,
    // Sleeper's board is a virtualised React grid with hashed class names, so match on the
    // stable-ish structural prefixes and let the fail-closed wrapper in badges.js absorb
    // the rest. No badges is an acceptable outcome; a thrown error is not.
    rowSelectors: [
      '[class*="player-rank-item"]',
      '[class*="draft-board-player"]',
      '[class*="player-list-item"]',
      '[class*="playerListItem"]',
      'li[class*="player"]',
    ],
    nameSelectors: [
      '[class*="player-name"]',
      '[class*="playerName"]',
      '[class*="name-container"]',
      '.name',
    ],
    isDraftRoom(loc = location) {
      return /^\/draft\//.test(loc.pathname) || /^\/leagues\/\d+\/draft/.test(loc.pathname);
    },
  },
};

/** 'espn' | 'sleeper' | null for a hostname. */
export function platformForHost(host) {
  for (const p of Object.values(PLATFORMS)) if (p.host.test(String(host || ''))) return p.id;
  return null;
}

export const platformLabel = (id) => PLATFORMS[id]?.label || 'ESPN';
