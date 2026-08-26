// Service worker: owns all network access and caches the answers so the panel never
// blocks on a fetch. The content script talks to it over runtime messages.
//
// Two platforms live behind the same two messages. ESPN is the real draft and needs the
// cookie relay in espn-fetch.js; Sleeper is the rehearsal platform and is a plain public
// fetch. Everything above this file sees one shape either way.

import { fetchLeague, fetchDraftPicks } from '../core/espn-api.js';
import { fetchSleeperLeague, fetchSleeperPicks, fetchSleeperUser } from '../core/sleeper-api.js';
import { ESPN, SLEEPER } from '../core/platform.js';
import { getState } from '../core/storage.js';

const cache = { league: new Map(), picks: new Map() };
const LEAGUE_TTL = 5 * 60 * 1000;   // settings barely change
const PICKS_TTL = 2000;             // during a draft we want this fresh

// Keyed by platform AND id: a Sleeper poll must never be served a stale ESPN answer, and
// swapping between them mid-session is exactly what the rehearsal workflow does.
async function cached(store, key, ttl, load, force) {
  const hit = store.get(key);
  if (!force && hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await load();
  store.set(key, { value, at: Date.now() });
  return value;
}

let datasetPromise = null;
function getDataset() {
  // Read once and hold it: the panel asks for picks every 3 seconds and the dataset is
  // 336 KB of JSON that never changes without an extension reload.
  if (!datasetPromise) {
    datasetPromise = fetch(chrome.runtime.getURL('build/dataset.json'))
      .then((r) => r.json())
      .catch((err) => { datasetPromise = null; throw err; });
  }
  return datasetPromise;
}

/** Which platform and which draft this message is about. */
async function target(msg, state) {
  const platform = msg.platform || state.platform || ESPN;
  if (platform === SLEEPER) {
    const id = msg.draftId || state.sleeperDraftId;
    if (!id) throw new Error('No Sleeper draft yet. Open a Sleeper draft room, or paste its ID in the extension options.');
    return { platform, id };
  }
  const id = msg.leagueId || state.leagueId;
  if (!id) throw new Error('No leagueId configured. Open the extension options.');
  return { platform, id };
}

async function getLeague({ platform, id }, force) {
  return cached(cache.league, `${platform}:${id}`, LEAGUE_TTL, () => (
    platform === SLEEPER ? fetchSleeperLeague(id) : fetchLeague(id)
  ), force);
}

async function getPicks({ platform, id }, msg, state) {
  if (platform === SLEEPER) {
    const dataset = await getDataset();
    const store = state.sleeperKeepers || {};
    const load = async () => {
      const res = await fetchSleeperPicks(id, {
        idMap: dataset.idMap?.sleeper || {},
        // A keeper drafted by hand is still a keeper. Sleeper flags none of them, so the
        // sheet and the board's own shape are both part of the answer.
        keptIds: (state.keepers || []).map((k) => k.espnId).filter(Boolean),
        knownKeeperIds: store[id] || [],
      });
      // The board only proves who the keepers are while the draft is still short of their
      // slots, so write down what it proved before that evidence expires.
      if (res.detectedKeeperIds.length > (store[id] || []).length) {
        await chrome.storage.local.set({
          sleeperKeepers: { ...store, [id]: res.detectedKeeperIds },
        });
      }
      return res;
    };
    // A named draft other than the configured one is a diagnostic, not the live poll.
    if (msg.draftId && msg.draftId !== state.sleeperDraftId) return load();
    return cached(cache.picks, `${platform}:${id}`, PICKS_TTL, load, msg.force);
  }
  // A past-season request is a diagnostic, never the live poll -- don't let it poison the cache.
  if (msg.season) return fetchDraftPicks(id, msg.season);
  return cached(cache.picks, `${platform}:${id}`, PICKS_TTL, () => fetchDraftPicks(id), msg.force);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      const state = await getState();
      switch (msg.type) {
        case 'ping':
          sendResponse({ ok: true });
          break;
        case 'league': {
          const t = await target(msg, state);
          sendResponse({ ok: true, platform: t.platform, league: await getLeague(t, msg.force) });
          break;
        }
        case 'picks': {
          const t = await target(msg, state);
          sendResponse({ ok: true, platform: t.platform, ...(await getPicks(t, msg, state)) });
          break;
        }
        case 'sleeper-user':
          sendResponse({ ok: true, user: await fetchSleeperUser(msg.username) });
          break;
        case 'dataset':
          sendResponse({ ok: true, dataset: await getDataset() });
          break;
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
