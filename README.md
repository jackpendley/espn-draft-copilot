# Draft Copilot

A Chrome extension that puts a live, **keeper-aware fantasy football draft board** inside the
ESPN draft room, and lets you rehearse the whole thing on Sleeper first.

I built it for my own keeper league's 2026 draft and used it live. It does the arithmetic a
keeper league makes painful: when managers keep players in specific rounds, every overall pick
number after those rounds shifts, including yours. Everything the panel shows (your next pick,
adjusted ADP, the chance a player lasts until you pick again) depends on getting that right.

> **Unofficial.** Not affiliated with ESPN, Sleeper, or the author of any draft guide. It reads
> ESPN's undocumented fantasy endpoints using your own signed-in session, which ESPN could
> change or restrict at any time. The ranking data it displays comes from a third-party guide
> that is **not included** in this repo (see [Guide data](#guide-data)).

## What it does

- **Keeper-aware pick math.** Paste the keeper sheet, assign each keeper a draft slot, and the
  snake order is recomputed with those picks removed. Your real pick numbers update as keepers
  change.
- **Live board.** Ranked players with tier, tag, keeper-adjusted ADP, "picks until they hit
  their ADP", and the probability each player survives to your next pick.
- **Best-value sort.** Guide rank weighted by survival odds: a star who will certainly still be
  there is demoted, one who will certainly be gone is promoted.
- **Guardrails.** Draft-strategy rules from the guide (no K/DST early, dead zones, reach
  detection, risk stacking, round-plan drift) evaluated on the selected player.
- **Alerts.** Positional runs and tiers about to break.
- **Player cards.** Adjusted PPG, luck/regression direction, PPR lean, team offensive-line and
  playcaller context, and the guide's notes for that player.
- **Young filter.** Rookie through third-year players, for keeper-league swings.
- **Two feeds, one panel.** The same panel runs on ESPN (the real draft) and Sleeper (rehearsal
  with keepers drafted by hand in their rounds, which an ESPN mock cannot do).
- **Failure-tolerant.** Manual "mark drafted" overrides, a loud banner when sync stops, a
  standalone board window, and a clean "extension reloaded, refresh the page" state.

## Status and honest limitations

- **Sleeper** pick sync worked well and was the basis for all mock-draft practice.
- **ESPN** automatic pick sync did **not** work reliably in the 2026 live draft; I fell back to
  the manual ✓ override. Fixes were made afterwards but are unverified against a live ESPN
  draft. Details and open questions: [docs/NEXT-SEASON.md](docs/NEXT-SEASON.md).
- League-specific values and the guide data are supplied locally, never committed.

## Quick start

Requires Node 20+ and Chrome.

```bash
npm install
npm test                  # runs on a synthetic fixture; no guide or network needed
```

A full build needs the (private) guide data and a refresh of the player universe:

```bash
npm run fetch:players     # ESPN player universe + live ADP
npm run fetch:sleeper     # Sleeper id map, so Sleeper picks cross players off
npm run build             # guide -> dist/dataset.json, then bundle the extension
```

Then in Chrome: `chrome://extensions` -> **Developer mode** -> **Load unpacked** -> the
`extension/` folder. Open the extension options, put in your league ID and draft slot, hit
**Connect to ESPN**, and paste your keeper sheet.

Open `fantasy.espn.com/football/draft?leagueId=<your id>` and the panel appears; drag it by the
header. Append `?copilot=1` to any ESPN or Sleeper URL to force it to mount for a visual check.

**Be signed in to ESPN with a `fantasy.espn.com` tab open.** Private leagues need your session
cookie, and the draft room itself counts as that tab (see the architecture notes below).

### Guide data

The board is driven by a paid third-party draft guide that I hand-transcribed into
`data/guide/`. It is gitignored and not redistributed. You can bring your own data in the same
format; the layout, the validation the build performs, and the transcription method that works
are in [docs/GUIDE-DATA.md](docs/GUIDE-DATA.md).

### Local league settings

Optional, gitignored, in `data/local/` (copy the `*.example*` files): `config.json` supplies
default league ID, slot, team and round counts, and `keepers.tsv` pre-fills the keeper box.
They are inlined at build time, so a fresh clone contains none of it.

## The keeper sheet

Copy the range from a spreadsheet and paste it into the options page (TSV, header row
detected, columns in any order):

| Team | Player | Round |
|------|--------|-------|
| Team A | Player One | 6 |

Then set each keeper's **draft slot** in the parse table so the simulation knows whose round to
burn. Names are fuzzy-matched; anything unmatched is flagged and skipped on save rather than
silently dropped. You can re-paste any time, including mid-draft.

## Practising on Sleeper

An ESPN mock cannot rehearse keepers (the league tracks them in a spreadsheet, so ESPN thinks
every round is open). Sleeper can:

1. Create a Sleeper league mirroring yours: team count, rounds, snake, **no 3rd-round
   reversal**.
2. Draft each keeper by hand in its real round. The panel recognises them from your sheet,
   removes them from the feed, and renumbers everything after, exactly as draft day will.
3. Open the draft room: the panel reads the draft ID from the URL. In options, enter your
   Sleeper username and **Connect to Sleeper** to read your seat from the draft order.

The header chip reads `SLEEPER · practice` so a tab left open can't be mistaken for the real
draft. A mirror that doesn't match (wrong team count, linear draft, reversal on) shows an amber
bar instead of quietly wrong numbers. Sleeper's own pick counter includes the keeper picks the
panel removes, so the status strip shows both numbers.

## Draft-day sequence

1. Run a full Sleeper mock beforehand.
2. Morning of: `npm run fetch:players && npm run build` (ADP moves in the last week), reload the
   extension, refresh any open ESPN tab.
3. Options: paste the final keeper sheet, set draft slots, **Save**. Check the "Your real
   picks" card.
4. Open the draft room and confirm the chip reads **ESPN** and the pick number is right.

If sync stalls, hit ✓ on players as they go (manual marks override the API). If the panel
disappears, use options -> **Open standalone board**.

## Architecture

```
src/core/        pure logic, no DOM and no chrome.*: keepers, board, rules, names, errors
                 + the two platform adapters (espn-api, sleeper-api) returning one shape
src/panel/       Preact UI (Panel, BoardRow, PlayerCard), the poll loop (poller.js), standalone page
src/content/     panel mount + badges on the site's own player rows
src/background/  service worker: all network access, caching, dispatch by platform
src/options/     league config, keeper editor, replay diagnostics
scripts/         fetch players, build the dataset, bundle the extension (esbuild)
data/            overrides/ (name aliases) are tracked; guide/ and local/ are private
test/            node:test suites + synthetic fixtures
docs/            guide-data format and the next-season checklist
```

**The platform seam is one file deep.** `espn-api.js` and `sleeper-api.js` return the same two
shapes, `background/index.js` picks between them, and `platform.js` holds the per-site URLs and
DOM selectors. `board.js`, `rules.js`, `keepers.js` and `names.js` don't know there is more
than one draft site.

**Why ESPN reads go through a tab.** The league is private, so requests need the `espn_s2`
cookie. A fetch from the extension's own origin is cross-site to espn.com and the cookie can be
dropped by `SameSite` policy; a fetch from a content script on `fantasy.espn.com` is same-site
and carries it. So the service worker asks the requesting tab to fetch on its behalf and falls
back to a direct fetch. (CORS is not the obstacle: ESPN's read API is permissive.)

**Polling.** `poller.js` is a self-rescheduling loop (about 1s normally, 400ms near your pick
or just after a new pick, a flat 4s pause after a confirmed 429). The background serves its
last known picks if one refresh fails. After two consecutive failures the panel shows a red
"Not syncing" banner.

**Matching Sleeper players to ESPN's.** Sleeper uses its own ids. A build-time map joins them
(defenses by team; everyone else by name, with **no fuzzy matching**, because striking the
wrong player off the board mid-draft is worse than missing one).

## Commands

```bash
npm test                    # unit + render tests (synthetic fixture, no network)
npm run fetch:players       # refresh ESPN ADP
npm run fetch:sleeper       # refresh Sleeper's player list
npm run build:data          # build dataset; fails loudly on unresolved names / rank gaps
npm run build:ext           # bundle the extension (inlines data/local/* if present)
npm run build               # both
node scripts/scenario.mjs   # simulate a draft situation: --slot 5 --teams 12 --rounds 16
```

After any rebuild: reload the extension **and** refresh the ESPN tab. Reloading orphans content
scripts already running in open tabs ("Extension context invalidated"); the panel detects this
and shows a Refresh button instead of freezing.

## Roadmap

See [docs/NEXT-SEASON.md](docs/NEXT-SEASON.md): annual update checklist, ESPN sync follow-ups,
and ideas.

## License

[MIT](LICENSE) for the code. The draft guide data is not included and is not covered by this
license.
