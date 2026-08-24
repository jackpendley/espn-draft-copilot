// Parsers for the pipe-delimited guide files in data/guide/.
// Kept separate from build-dataset so the formats are easy to unit test.

import { readFileSync } from 'node:fs';

const strip = (s) => (s ?? '').trim();
const num = (s) => { const t = strip(s); return t === '' ? null : Number(t); };
const bool = (s) => strip(s).toLowerCase() === 'yes';

function lines(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'));
}

export function parseBigBoard(path) {
  return lines(path).map((l) => {
    const [rank, pos, name, tag] = l.split('|');
    return { rank: Number(rank), pos: strip(pos), name: strip(name), tag: strip(tag) || 'neutral' };
  });
}

/** Positional rankings, where "---" lines mark tier boundaries. */
export function parsePositional(path) {
  const out = [];
  let tier = 1;
  let currentPos = null;
  for (const l of lines(path)) {
    const t = l.trim();
    if (t.startsWith('==')) { tier = 1; currentPos = t.replace(/=/g, '').trim(); continue; }
    if (t === '---') { tier += 1; continue; }
    const [pos, rank, name, tag] = t.split('|');
    if (currentPos && strip(pos) !== currentPos) {
      throw new Error(`positional: row "${t}" is under section ${currentPos}`);
    }
    out.push({
      pos: strip(pos), posRank: Number(rank), name: strip(name),
      tag: strip(tag) || 'neutral', tier,
    });
  }
  return out;
}

export function parseAdjustedPpg(path) {
  return lines(path).map((l) => {
    const [pos, rank, name, ppg, reason] = l.split('|');
    return {
      pos: strip(pos), rank: Number(rank), name: strip(name),
      adjPpg: Number(ppg), reason: strip(reason) || null,
    };
  });
}

export function parseLuck(path) {
  return lines(path).map((l) => {
    const [name, total, pct] = l.split('|');
    return { name: strip(name), totalLost: Number(total), pctLost: Number(pct) };
  });
}

export function parseRbVolume(path) {
  return lines(path).map((l) => {
    const [name, proj, adj, conf, small] = l.split('|');
    return {
      name: strip(name), projVolumeRank: Number(proj),
      adjVolume25: strip(adj) || null, confidence: strip(conf) || null,
      smallSample: bool(small),
    };
  });
}

export function parsePprLean(path) {
  return lines(path).map((l) => {
    const [pos, name, pct, lean] = l.split('|');
    return { pos: strip(pos), name: strip(name), pctViaRec: Number(pct), lean: strip(lean) };
  });
}

export function parseGoldMine(path) {
  return lines(path).map((l) => {
    const [name, bucket, borderline] = l.split('|');
    return { name: strip(name), bucket: strip(bucket), borderline: strip(borderline) === 'borderline' };
  });
}

export function parseTeams(path) {
  return lines(path).map((l) => {
    const [team, ol25, trend, cohesion, ol26, qbRuns, gamescript] = l.split('|');
    return {
      team: strip(team), ol25Rank: num(ol25), olTrend: strip(trend) || null,
      cohesion: num(cohesion), olRank26: num(ol26), qbRuns: bool(qbRuns),
      gamescript: strip(gamescript) || null,
    };
  });
}

export function parsePlaycallers(path) {
  return lines(path).map((l) => {
    const f = l.split('|');
    return {
      team: strip(f[0]), playcaller: strip(f[1]), seasons: num(f[2]),
      fantasyPpg: num(f[3]), fantasyPpgRank: num(f[4]), team2025Ppg: num(f[5]),
      rbPpg: num(f[6]), wrPpg: num(f[7]), pctRb1: num(f[8]), rb1Rank: num(f[9]),
      personnel: strip(f[10]) || null, paceRank: strip(f[11]) || null,
      scheme: strip(f[12]) || null, motionRank: strip(f[13]) || null,
      formation: strip(f[14]) || null, rbScreenRank: strip(f[15]) || null,
      newTeam: bool(f[16]), firstTimePlaycaller: bool(f[17]), lastCoachingYear: bool(f[18]),
    };
  });
}

export function parseDst(path) {
  return lines(path).map((l) => {
    const [adp, team, prroe, adjPpg, b10, trend, value] = l.split('|');
    return {
      adp: Number(adp), team: strip(team), prroe: num(prroe), adjPpg25: num(adjPpg),
      bottom10Offense: bool(b10), trend: strip(trend) || null, value: strip(value) || null,
    };
  });
}

export function parseKickers(path) {
  return lines(path).map((l) => {
    const f = l.split('|');
    return {
      adp: Number(f[0]), team: strip(f[1]), name: strip(f[2]), ppg25: num(f[3]),
      accuracy: num(f[4]), offRank: num(f[5]), goRank: num(f[6]),
      fiftyPlus: strip(f[7]) === 'yes' ? true : (strip(f[7]) === 'no' ? false : null),
      dome: strip(f[8]) === 'yes' ? true : (strip(f[8]) === 'no' ? false : null),
      value: strip(f[9]) || null,
    };
  });
}
