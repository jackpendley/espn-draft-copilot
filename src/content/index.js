// Mounts the panel into a draft room and decorates the site's own player rows.
// The badge layer is strictly optional: if the site's markup shifts, badges silently stop
// and the panel is untouched.
//
// Runs on two sites: ESPN, where the real draft happens, and Sleeper, which is where the
// whole thing gets rehearsed with keepers in their proper rounds. Which one we're on is
// decided once, here, and passed down -- nothing below this file sniffs the URL.

import { h, render } from 'preact';
import { Panel } from '../panel/Panel.js';
import { attachBadges } from './badges.js';
import { installFetchRelay } from '../core/espn-fetch.js';
import { extensionAlive } from '../core/runtime.js';
import { PLATFORMS, platformForHost, ESPN, SLEEPER } from '../core/platform.js';
import { draftIdFromUrl } from '../core/sleeper-constants.js';

const HOST_ID = 'draft-copilot-root';
const platform = platformForHost(location.hostname);

// Register this before anything else: the service worker relies on any ESPN tab,
// draft room or not, to make same-site requests on its behalf. It exists solely for
// ESPN's SameSite cookie problem -- Sleeper's API is public, so it has nothing to do there.
if (platform === ESPN) installFetchRelay();

function isDraftRoom() {
  if (!platform) return false;
  // ?copilot=1 force-mounts anywhere on either site, for pre-draft dry runs.
  if (new URLSearchParams(location.search).get('copilot') === '1') return true;
  return PLATFORMS[platform].isDraftRoom(location, document);
}

// The draft id is in the URL of every Sleeper draft room, including a throwaway mock, so
// a fresh mock needs no configuration at all.
const draftId = () => (platform === SLEEPER ? draftIdFromUrl(location.href) : null);

// ESPN's draft room URL always carries its own leagueId too (?leagueId=...) -- read it the
// same way, so the panel self-corrects to whatever league you're actually standing in
// instead of quietly polling a stale or wrong one left over in options from a prior season
// or a different league.
const leagueId = () => (platform === ESPN ? new URLSearchParams(location.search).get('leagueId') : null);

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

  render(h(Panel, { platform, draftId: draftId(), leagueId: leagueId() }), shell);

  try {
    attachBadges(platform);
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
const obs = new MutationObserver(() => {
  if (!extensionAlive()) { obs.disconnect(); return; }
  if (isDraftRoom()) mount();
});
obs.observe(document.documentElement, { childList: true, subtree: true });
