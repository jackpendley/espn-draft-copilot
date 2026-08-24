// Reloading an extension orphans the content scripts already running in open tabs:
// their chrome.* handles go dead and every later call throws "Extension context
// invalidated". That is expected after a reload, but it must not surface as uncaught
// errors, and during a draft the panel has to say so rather than quietly stop updating.

export const INVALIDATED = 'Extension context invalidated.';

/** False once this content script has been orphaned by a reload/update. */
export function extensionAlive() {
  try {
    return chrome?.runtime?.id != null;
  } catch {
    return false;   // touching chrome.runtime can itself throw once orphaned
  }
}

export function isInvalidated(err) {
  return String(err?.message || err || '').includes('context invalidated');
}

/** chrome.storage.local.get that resolves to a fallback instead of rejecting. */
export async function safeGet(keys = null, fallback = {}) {
  if (!extensionAlive()) return fallback;
  try {
    return await chrome.storage.local.get(keys);
  } catch (err) {
    if (isInvalidated(err)) return fallback;
    throw err;
  }
}

/** chrome.storage.local.set that no-ops once orphaned. Returns whether it stuck. */
export async function safeSet(patch) {
  if (!extensionAlive()) return false;
  try {
    await chrome.storage.local.set(patch);
    return true;
  } catch (err) {
    if (isInvalidated(err)) return false;
    throw err;
  }
}

/** Adds a storage listener that detaches itself once the context dies. */
export function onStorageLocal(fn) {
  if (!extensionAlive()) return () => {};
  const handler = (changes, area) => {
    if (area !== 'local') return;
    if (!extensionAlive()) { try { chrome.storage.onChanged.removeListener(handler); } catch {} return; }
    fn(changes);
  };
  try { chrome.storage.onChanged.addListener(handler); } catch { return () => {}; }
  return () => { try { chrome.storage.onChanged.removeListener(handler); } catch {} };
}
