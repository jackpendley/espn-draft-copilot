// chrome.runtime.sendMessage sets chrome.runtime.lastError when nothing answers --
// most often when the service worker is asleep, restarting, or threw on startup.
// Reading lastError inside the callback is what marks it handled; leaving it unread
// makes Chrome log "Unchecked runtime.lastError" and surface it on the extensions
// page, which looks like a crash even though the page is fine.
import { extensionAlive, INVALIDATED } from './runtime.js';

export function send(msg) {
  return new Promise((resolve) => {
    // Orphaned by an extension reload: fail fast with a message the panel can act on.
    if (!extensionAlive()) { resolve({ ok: false, error: INVALIDATED, invalidated: true }); return; }
    try {
      chrome.runtime.sendMessage(msg, (reply) => {
        const err = chrome.runtime.lastError;   // reading this marks it handled
        if (err) { resolve({ ok: false, error: err.message || 'No response from the extension worker.' }); return; }
        resolve(reply ?? { ok: false, error: 'Empty response from the extension worker.' });
      });
    } catch (err) {
      const msgText = String(err?.message || err);
      resolve({ ok: false, error: msgText, invalidated: msgText.includes('context invalidated') });
    }
  });
}
