// Service worker: owns all ESPN network access and caches the answers so the panel
// never blocks on a fetch. The content script talks to it over runtime messages.

import { fetchLeague, fetchDraftPicks } from '../core/espn-api.js';
import { getState } from '../core/storage.js';

const cache = { league: null, leagueAt: 0, picks: null, picksAt: 0 };
const LEAGUE_TTL = 5 * 60 * 1000;   // settings barely change
const PICKS_TTL = 2000;             // during a draft we want this fresh

async function getLeague(leagueId, force = false) {
  if (!force && cache.league && cache.league.leagueId === leagueId && Date.now() - cache.leagueAt < LEAGUE_TTL) {
    return cache.league;
  }
  const league = await fetchLeague(leagueId);
  cache.league = league; cache.leagueAt = Date.now();
  return league;
}

async function getPicks(leagueId, force = false, season) {
  // A past-season request is a diagnostic, never the live poll -- don't let it poison the cache.
  if (season) return fetchDraftPicks(leagueId, season);
  if (!force && cache.picks && Date.now() - cache.picksAt < PICKS_TTL) return cache.picks;
  const picks = await fetchDraftPicks(leagueId);
  cache.picks = picks; cache.picksAt = Date.now();
  return picks;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      const state = await getState();
      const leagueId = msg.leagueId || state.leagueId;
      switch (msg.type) {
        case 'ping':
          sendResponse({ ok: true });
          break;
        case 'league':
          if (!leagueId) throw new Error('No leagueId configured. Open the extension options.');
          sendResponse({ ok: true, league: await getLeague(leagueId, msg.force) });
          break;
        case 'picks':
          if (!leagueId) throw new Error('No leagueId configured.');
          sendResponse({ ok: true, ...(await getPicks(leagueId, msg.force, msg.season)) });
          break;
        case 'dataset': {
          const res = await fetch(chrome.runtime.getURL('build/dataset.json'));
          sendResponse({ ok: true, dataset: await res.json() });
          break;
        }
        default:
          sendResponse({ ok: false, error: `unknown message ${msg.type}` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err.message || err) });
    }
  })();
  return true;   // keep the channel open for the async reply
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
