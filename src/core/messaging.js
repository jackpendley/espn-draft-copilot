// chrome.runtime.sendMessage sets chrome.runtime.lastError when nothing answers --
// most often when the service worker is asleep, restarting, or threw on startup.
// Reading lastError inside the callback is what marks it handled; leaving it unread
// makes Chrome log "Unchecked runtime.lastError" and surface it on the extensions
// page, which looks like a crash even though the page is fine.
export function send(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (reply) => {
        const err = chrome.runtime.lastError;   // reading this marks it handled
        if (err) { resolve({ ok: false, error: err.message || 'No response from the extension worker.' }); return; }
        resolve(reply ?? { ok: false, error: 'Empty response from the extension worker.' });
      });
    } catch (err) {
      resolve({ ok: false, error: String(err?.message || err) });
    }
  });
}
