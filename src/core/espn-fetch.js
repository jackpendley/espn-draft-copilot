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

/** Runs inside the content script. */
export function installFetchRelay() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'espn-fetch') return undefined;
    (async () => {
      try {
        const res = await fetch(msg.url, {
          credentials: 'include',
          headers: { accept: 'application/json', ...(msg.headers || {}) },
        });
        if (!res.ok) { sendResponse({ ok: false, status: res.status, error: `ESPN ${res.status}` }); return; }
        sendResponse({ ok: true, data: await res.json() });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  });
}

/** Runs in the service worker. Tries the page first, then a direct call. */
export async function fetchViaPageOrDirect(url, headers = {}) {
  const viaPage = await tryViaPage(url, headers);
  if (viaPage.ok) return viaPage.data;

  const direct = await tryDirect(url, headers);
  if (direct.ok) return direct.data;

  // Report the more informative failure.
  const reason = viaPage.error && viaPage.error !== 'no-espn-tab' ? viaPage.error : direct.error;
  if (String(reason).includes('401')) {
    throw new Error(
      'ESPN says not authorized. Open fantasy.espn.com in a tab and make sure you are signed in, then retry.',
    );
  }
  throw new Error(reason || 'Could not reach ESPN.');
}

async function tryViaPage(url, headers) {
  try {
    const tabs = await chrome.tabs.query(ESPN_TAB_QUERY);
    if (!tabs.length) return { ok: false, error: 'no-espn-tab' };
    for (const tab of tabs) {
      const res = await sendToTab(tab.id, { type: 'espn-fetch', url, headers });
      if (res?.ok) return res;
      if (res?.status === 401) return { ok: false, error: 'ESPN 401' };
    }
    return { ok: false, error: 'no-espn-tab' };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

async function tryDirect(url, headers) {
  try {
    const res = await fetch(url, { credentials: 'include', headers: { accept: 'application/json', ...headers } });
    if (!res.ok) return { ok: false, error: `ESPN ${res.status}` };
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
