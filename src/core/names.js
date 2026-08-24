// Name normalization + matching between the guide's spellings and ESPN's player names.
// All matching happens at BUILD time so draft-day code never guesses.

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

/** Lowercase, drop punctuation and generational suffixes, collapse whitespace. */
export function normalizeName(name) {
  if (!name) return '';
  const cleaned = String(name)
    .toLowerCase()
    .replace(/[.'’`]/g, '')       // Ka'imi -> kaimi, A.J. -> aj
    .replace(/[-–—]/g, ' ')       // Croskey-Merritt -> croskey merritt
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = cleaned.split(' ').filter((w) => !SUFFIXES.has(w));
  return parts.join(' ');
}

/** Levenshtein distance, capped for speed. */
export function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length; const n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Build a lookup from an ESPN player list.
 * Index by normalized name, and by "normalized name|POS" to break ties between
 * same-named players at different positions (e.g. the several Mike Williamses).
 */
export function buildIndex(espnPlayers) {
  const byNamePos = new Map();
  const byName = new Map();
  for (const p of espnPlayers) {
    const n = normalizeName(p.name);
    if (!n) continue;
    const kp = `${n}|${p.pos}`;
    if (!byNamePos.has(kp)) byNamePos.set(kp, []);
    byNamePos.get(kp).push(p);
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(p);
  }
  return { byName, byNamePos, all: espnPlayers };
}

/**
 * Resolve a guide name (+ optional position) to a single ESPN player.
 * Returns { player, how } or { player: null, reason, candidates }.
 * `aliases` maps a normalized guide name to the normalized ESPN name.
 */
export function resolve(index, rawName, pos, aliases = {}) {
  let n = normalizeName(rawName);
  if (aliases[n]) n = normalizeName(aliases[n]);

  // Prefer an exact name+position hit; it is the only unambiguous case.
  if (pos) {
    const exact = index.byNamePos.get(`${n}|${pos}`);
    if (exact && exact.length === 1) return { player: exact[0], how: 'exact-name-pos' };
    if (exact && exact.length > 1) {
      // Same name, same position: take the most-rostered, which is the fantasy-relevant one.
      const best = [...exact].sort((a, b) => (b.percentOwned ?? 0) - (a.percentOwned ?? 0))[0];
      return { player: best, how: 'name-pos-most-owned' };
    }
  }

  const byName = index.byName.get(n);
  if (byName && byName.length === 1) return { player: byName[0], how: 'exact-name' };
  if (byName && byName.length > 1) {
    const best = [...byName].sort((a, b) => (b.percentOwned ?? 0) - (a.percentOwned ?? 0))[0];
    return { player: best, how: 'name-most-owned', candidates: byName.map((p) => p.name) };
  }

  // Last resort: closest edit distance within the same position, distance <= 2.
  const pool = pos ? index.all.filter((p) => p.pos === pos) : index.all;
  let best = null; let bestD = 99;
  for (const p of pool) {
    const d = editDistance(n, normalizeName(p.name));
    if (d < bestD) { bestD = d; best = p; }
  }
  if (best && bestD <= 2) return { player: best, how: `fuzzy-d${bestD}`, fuzzy: true };

  return {
    player: null,
    reason: 'no-match',
    candidates: best ? [`${best.name} (d=${bestD})`] : [],
  };
}
