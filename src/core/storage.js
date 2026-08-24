// Thin promise wrapper over chrome.storage.local with sane defaults.
// Everything the panel needs to survive a mid-draft page reload lives here.

export const DEFAULTS = {
  leagueId: '1234567890',  // Jack's league
  myTeamSlot: 5,           // 1-based draft position
  teams: 12,
  rounds: 15,
  scoring: 'PPR',
  keepers: [],             // [{ team, player, round, espnId|null, teamSlot|null }]
  manualDrafted: [],       // espnIds marked drafted by hand (commissioner veto safety net)
  manualUndrafted: [],     // espnIds explicitly un-drafted, wins over API
  sortMode: 'value',
  hideAvoid: false,
  panelCollapsed: false,
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
