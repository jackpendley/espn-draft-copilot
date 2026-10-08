// Sleeper's read API. Public, unauthenticated, and CORS-open (`access-control-allow-origin: *`),
// so unlike ESPN there is no cookie problem to work around -- the service worker calls it
// directly. See espn-fetch.js for the contrast.

export const API_HOST = 'https://api.sleeper.app/v1';

/** The whole NFL player universe, ~14 MB. Build time only; Sleeper asks for <= 1 call/day. */
export const PLAYERS_URL = `${API_HOST}/players/nfl`;

export const draftUrl = (draftId) => `${API_HOST}/draft/${draftId}`;
export const draftPicksUrl = (draftId) => `${API_HOST}/draft/${draftId}/picks`;
export const userUrl = (username) => `${API_HOST}/user/${encodeURIComponent(username)}`;

// A draft room is sleeper.com/draft/nfl/<draft_id>; mocks use the same shape, which is
// why a fresh mock needs no configuration -- the id is right there in the URL.
const DRAFT_PATH = /\/draft\/(?:nfl\/)?(\d{5,})/;

/** Pull the draft id out of a Sleeper URL, or null if this isn't a draft page. */
export function draftIdFromUrl(href) {
  if (!href) return null;
  try {
    const u = new URL(href, 'https://sleeper.com');
    const m = DRAFT_PATH.exec(u.pathname);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** True for any Sleeper page that could host a draft board. */
export function isSleeperDraftPath(pathname) {
  return /^\/draft\//.test(pathname) || /^\/leagues\/\d+\/(draft|team)/.test(pathname);
}
