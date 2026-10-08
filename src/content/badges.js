// Decorates the draft site's own player rows with Joel's rank + tag color, so the
// augmentation shows up where your eyes already are. Every selector is best-effort and
// wrapped: if the markup shifts this layer goes quiet rather than breaking the panel.
//
// The selectors live in platform.js because ESPN and Sleeper share nothing structurally.
// Sleeper's board in particular is a virtualised React grid with hashed class names, so
// its selectors are a best guess -- no badges there is an acceptable outcome, a thrown
// error during a draft is not.

import { TAG_COLOR, TAG_LABEL } from '../panel/format.js';
import { send } from '../core/messaging.js';
import { extensionAlive } from '../core/runtime.js';
import { normalizeName } from '../core/names.js';
import { PLATFORMS, ESPN } from '../core/platform.js';

const MARK = 'data-dc-badged';

let byName = null;
let selectors = null;

export async function attachBadges(platform = ESPN) {
  const p = PLATFORMS[platform] || PLATFORMS[ESPN];
  selectors = { rows: p.rowSelectors.join(','), names: p.nameSelectors };

  const res = await send({ type: 'dataset' });
  if (!res?.ok) return;
  byName = new Map();
  for (const p of res.dataset.players) {
    if (p.joel.pprRank == null && p.joel.posRank == null) continue;
    byName.set(normalizeName(p.name), p);
  }

  let obs = null;
  const run = () => {
    // Once the extension is reloaded this script is orphaned; stop rather than throw.
    if (!extensionAlive()) { obs?.disconnect(); return; }
    try { decorate(); } catch { /* stay quiet during a draft */ }
  };
  run();
  obs = new MutationObserver(debounce(run, 250));
  obs.observe(document.body, { childList: true, subtree: true });
}

function decorate() {
  if (!byName || !selectors) return;
  const rows = document.querySelectorAll(selectors.rows);
  for (const row of rows) {
    if (row.hasAttribute(MARK)) continue;
    const nameEl = firstMatch(row, selectors.names);
    if (!nameEl) continue;
    const p = byName.get(normalizeName(nameEl.textContent));
    row.setAttribute(MARK, '1');
    if (!p) continue;

    const badge = document.createElement('span');
    badge.className = 'dc-badge';
    badge.style.background = TAG_COLOR[p.joel.tag] || TAG_COLOR.neutral;
    badge.textContent = p.joel.pprRank != null ? `#${p.joel.pprRank}` : `${p.pos}${p.joel.posRank}`;
    const bits = [
      p.joel.pprRank != null ? `Joel PPR #${p.joel.pprRank}` : null,
      p.joel.posRank != null ? `${p.pos}${p.joel.posRank}` : null,
      p.joel.tier != null ? `Tier ${p.joel.tier}` : null,
      TAG_LABEL[p.joel.tag] || null,
      p.joel.adjPpg25 != null ? `'25 adj ${p.joel.adjPpg25} PPG` : null,
    ].filter(Boolean);
    badge.title = bits.join(' · ');
    nameEl.parentElement?.appendChild(badge);
  }
}

const firstMatch = (root, sels) => {
  for (const s of sels) { const el = root.querySelector(s); if (el) return el; }
  return null;
};

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
