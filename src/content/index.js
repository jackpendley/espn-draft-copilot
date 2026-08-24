// Mounts the panel into the ESPN draft room and decorates ESPN's own player rows.
// The badge layer is strictly optional: if ESPN's markup shifts, badges silently stop
// and the panel is untouched.

import { h, render } from 'preact';
import { Panel } from '../panel/Panel.js';
import { attachBadges } from './badges.js';
import { installFetchRelay } from '../core/espn-fetch.js';

const HOST_ID = 'draft-copilot-root';

// Register this before anything else: the service worker relies on any ESPN tab,
// draft room or not, to make same-site requests on its behalf.
installFetchRelay();

function isDraftRoom() {
  // ?copilot=1 force-mounts anywhere on fantasy.espn.com, for pre-draft dry runs.
  if (new URLSearchParams(location.search).get('copilot') === '1') return true;
  return /\/football\/(draft|mockdraft|mockdraftlobby)/.test(location.pathname)
      || document.querySelector('.draft-columns, [class*="draftContainer"], [class*="PlayerTable"]') != null;
}

function mount() {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  document.body.appendChild(host);

  // Draggable, resizable shell so it never fights ESPN's layout.
  const shell = document.createElement('div');
  shell.className = 'dc-shell';
  host.appendChild(shell);
  makeDraggable(shell);

  render(h(Panel), shell);

  try {
    attachBadges();
  } catch (err) {
    console.warn('[Draft Copilot] badge layer disabled:', err.message);
  }
}

function makeDraggable(el) {
  const saved = localStorage.getItem('dc-pos');
  if (saved) {
    try { const { x, y } = JSON.parse(saved); el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.right = 'auto'; } catch {}
  }
  let dragging = false; let ox = 0; let oy = 0;
  el.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.dc-header')) return;
    if (e.target.tagName === 'BUTTON') return;
    dragging = true;
    const r = el.getBoundingClientRect();
    ox = e.clientX - r.left; oy = e.clientY - r.top;
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const x = Math.max(0, Math.min(window.innerWidth - 200, e.clientX - ox));
    const y = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - oy));
    el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.right = 'auto';
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    const r = el.getBoundingClientRect();
    localStorage.setItem('dc-pos', JSON.stringify({ x: r.left, y: r.top }));
  });
}

// ESPN is a SPA: the draft room can appear after initial load.
if (isDraftRoom()) mount();
const obs = new MutationObserver(() => { if (isDraftRoom()) mount(); });
obs.observe(document.documentElement, { childList: true, subtree: true });
