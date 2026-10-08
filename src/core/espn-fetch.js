// ESPN league data is private, so the request has to carry the user's cookies.
//
// A fetch from the extension's own origin is cross-site to espn.com, which means a
// SameSite=Lax session cookie would NOT be attached and the call 401s. A fetch made
// from a content script running on fantasy.espn.com is same-site (both are *.espn.com),
// so the cookie goes along.
//
// So: prefer fetching through an open ESPN tab, and fall back to a direct fetch.
// Either path can be the one that works depending on how ESPN sets its cookies, and
// trying both means we do not find out the hard way during a draft.

const ESPN_TAB_QUERY = { url: 'https://fantasy.espn.com/*' };

// ESPN answers a failed request with a real JSON body -- e.g.
// {"messages":["You are not authorized to view this League."],
//  "details":[{"message":"...", "type":"AUTH_LEAGUE_NOT_VISIBLE", ...}]} -- which is far more
// actionable than a bare status code. Pull it out so the panel can show the real reason
// instead of "ESPN 401" when something is actually wrong during a draft.
async function espnErrorDetail(res) {
  try {
    const body = await res.json();
    return body?.details?.[0]?.message || body?.messages?.[0] || null;
  } catch {
    return null;
  }
}

/** Runs inside the content script. */
export function installFetchRelay() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'espn-fetch') return undefined;
    (async () => {
      try {
        const res = await fetch(msg.url, {
          credentials: 'include',
          cache: 'no-store',
          headers: { accept: 'application/json', ...(msg.headers || {}) },
        });
        if (!res.ok) {
          const detail = await espnErrorDetail(res);
          console.warn('[Draft Copilot] ESPN relay fetch failed:', res.status, detail, msg.url);
          sendResponse({ ok: false, status: res.status, error: `ESPN ${res.status}${detail ? `: ${detail}` : ''}` });
          return;
        }
        sendResponse({ ok: true, data: await res.json() });
      } catch (err) {
        console.error('[Draft Copilot] ESPN relay fetch threw:', err, msg.url);
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  });
}

/**
 * Runs in the service worker.
 *
 * @param preferredTabId  the tab id of whichever content script actually asked for this (the
 *                        draft room itself, when that's the caller) -- relaying straight to it
 *                        skips the tabs.query + sequential-fallback dance below entirely, which
 *                        is both faster and cannot be confused by some *other* fantasy.espn.com
 *                        tab (a league home page, a roster tab) answering first or slowly.
 */
export async function fetchViaPageOrDirect(url, headers = {}, preferredTabId = null) {
  if (preferredTabId != null) {
    const res = await sendToTab(preferredTabId, { type: 'espn-fetch', url, headers });
    if (res?.ok) return res.data;
    if (res?.status === 401) {
      throw new Error(`ESPN says not authorized${res.error ? ` (${stripPrefix(res.error)})` : ''}. Make sure you are signed in to fantasy.espn.com, then retry.`);
    }
    console.warn('[Draft Copilot] preferred-tab relay failed, falling back to tab search:', res?.error, url);
  }

  const viaPage = await tryViaPage(url, headers);
  if (viaPage.ok) return viaPage.data;

  const direct = await tryDirect(url, headers);
  if (direct.ok) return direct.data;

  // Report the more informative failure.
  const reason = viaPage.error && viaPage.error !== 'no-espn-tab' ? viaPage.error : direct.error;
  console.warn('[Draft Copilot] ESPN fetch failed on every path:', { preferredTabId, viaPage, direct, url });
  if (String(reason).includes('401')) {
    throw new Error(
      `ESPN says not authorized${reason ? ` (${stripPrefix(reason)})` : ''}. Open fantasy.espn.com in a tab and make sure you are signed in, then retry.`,
    );
  }
  // Tagged distinctly so the poll loop can back off hard instead of just retrying fast.
  if (String(reason).includes('429')) throw new Error('ESPN 429: rate limited');
  throw new Error(reason || 'Could not reach ESPN.');
}

// "ESPN 401: You are not authorized..." -> "You are not authorized..." -- the code is already
// in the message we build around this; no need to repeat it.
function stripPrefix(s) {
  return String(s).replace(/^ESPN \d+:\s*/, '');
}

async function tryViaPage(url, headers) {
  try {
    const tabs = await chrome.tabs.query(ESPN_TAB_QUERY);
    if (!tabs.length) return { ok: false, error: 'no-espn-tab' };
    for (const tab of tabs) {
      const res = await sendToTab(tab.id, { type: 'espn-fetch', url, headers });
      if (res?.ok) return res;
      if (res?.status === 401) return { ok: false, error: res.error || 'ESPN 401' };
    }
    return { ok: false, error: 'no-espn-tab' };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

async function tryDirect(url, headers) {
  try {
    const res = await fetch(url, {
      credentials: 'include', cache: 'no-store', headers: { accept: 'application/json', ...headers },
    });
    if (!res.ok) {
      const detail = await espnErrorDetail(res);
      return { ok: false, error: `ESPN ${res.status}${detail ? `: ${detail}` : ''}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

function sendToTab(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (r) => {
      // A tab with no content script gives lastError; swallow it and move on.
      void chrome.runtime.lastError;
      resolve(r || { ok: false, error: 'no-response' });
    });
  });
}
