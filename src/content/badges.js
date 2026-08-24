// Decorates ESPN's own player rows with Joel's rank + tag color, so the augmentation
// shows up where your eyes already are. Every selector is best-effort and wrapped:
// if ESPN changes their markup this layer goes quiet rather than breaking the panel.

import { TAG_COLOR, TAG_LABEL } from '../panel/format.js';
import { send } from '../core/messaging.js';
import { extensionAlive } from '../core/runtime.js';

const MARK = 'data-dc-badged';

// ESPN has used several table shells over the years; try them broadly and bail quietly.
const ROW_SELECTORS = [
  '.Table__TR',
  'tr[class*="Table__TR"]',
  '[class*="playerTableRow"]',
  '[class*="PlayerRow"]',
];
const NAME_SELECTORS = [
  '.player-column__athlete .AnchorLink',
  '.player-column__bio .AnchorLink',
  'a[href*="/football/player/"]',
  '[class*="playerinfo__playername"]',
];

let byName = null;

export async function attachBadges() {
  const res = await send({ type: 'dataset' });
  if (!res?.ok) return;
  byName = new Map();
  for (const p of res.dataset.players) {
    if (p.joel.pprRank == null && p.joel.posRank == null) continue;
    byName.set(normalize(p.name), p);
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
  if (!byName) return;
  const rows = document.querySelectorAll(ROW_SELECTORS.join(','));
  for (const row of rows) {
    if (row.hasAttribute(MARK)) continue;
    const nameEl = firstMatch(row, NAME_SELECTORS);
    if (!nameEl) continue;
    const p = byName.get(normalize(nameEl.textContent));
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

const normalize = (s) => String(s || '')
  .toLowerCase()
  .replace(/[.'’`]/g, '')
  .replace(/[-–—]/g, ' ')
  .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
