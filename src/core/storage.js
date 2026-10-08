// Thin promise wrapper over chrome.storage.local with sane defaults.
// Everything the panel needs to survive a mid-draft page reload lives here.

// League-specific values (leagueId, slot, team and round counts) come from the gitignored
// data/local/config.json, which build-extension inlines as __LOCAL_DEFAULTS__. A fresh
// clone, and the tests, get the neutral values below.
const LOCAL = typeof __LOCAL_DEFAULTS__ === 'object' && __LOCAL_DEFAULTS__ ? __LOCAL_DEFAULTS__ : {};

export const DEFAULTS = {
  platform: 'espn',        // 'espn' (the real draft) | 'sleeper' (rehearsal)
  leagueId: '',
  myTeamSlot: 1,           // 1-based draft position

  // Sleeper exists so the panel can be rehearsed with keepers in their proper rounds,
  // which an ESPN mock cannot do. The draft id is auto-filled from the draft room URL,
  // and the slot is derived from the draft order once the username is known -- so a
  // fresh mock needs no setup at all.
  sleeperDraftId: '',
  sleeperUsername: '',
  sleeperUserId: '',
  sleeperSlot: null,       // 1-based; the mirror league may deal a different seat

  // Keepers found sitting on a Sleeper board before its draft ran, per draft id. Sleeper
  // flags nothing, so this is how a keeper stays identified once the draft has advanced
  // past its slot. Sleeper-only -- the sheet is still the truth for ESPN.
  sleeperKeepers: {},      // { [draftId]: [sleeperPlayerId] }

  teams: 12,
  rounds: 15,
  scoring: 'PPR',
  keepers: [],             // [{ team, player, round, espnId|null, teamSlot|null }]
  manualDrafted: [],       // espnIds marked drafted by hand (commissioner veto safety net)
  manualUndrafted: [],     // espnIds explicitly un-drafted, wins over API
  sortMode: 'value',
  hideAvoid: false,
  panelCollapsed: false,

  ...LOCAL,
};

export async function getState() {
  const got = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...got };
}

export async function setState(patch) {
  await chrome.storage.local.set(patch);
  return getState();
}

export function onStateChange(fn) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') fn(Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue])));
  });
}
