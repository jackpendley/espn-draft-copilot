# ESPN Draft Copilot — Joel Smyth's 2026 Draft Guide

Joel Smyth's Draft Guide 2026, keeper-aware, live inside the ESPN draft room.

Built for one specific draft: **Example Keeper League** — 12-team full PPR keeper, snake, **16 rounds**,
pick 5, September 3 2026, keeping Jaxon Smith-Njigba for a 6th-round pick.

Roster: QB×1 RB×2 WR×2 TE×1 FLEX×1 DST×1 K×1, BE×7, IR×1.

---

## Setup (once)

```bash
npm install
npm run fetch:players    # pull ESPN's player universe + live ADP
npm run build            # transcribe guide -> dist/dataset.json, then bundle the extension
```

Then in Chrome:

1. Go to `chrome://extensions`, turn on **Developer mode**
2. **Load unpacked** → select the `extension/` folder
3. Click the extension icon (or Extensions → Details → Extension options)
4. League ID (`1234567890`) and draft slot (`5`) are pre-filled. Hit **Connect to ESPN** —
   team count, rounds and roster slots fill in automatically
5. Paste your keeper sheet (below)

**Be signed in to ESPN with a `fantasy.espn.com` tab open.** The league is private, so every
read needs your session cookie. See "How the private-league reads work" below.

Open `fantasy.espn.com/football/draft?leagueId=1234567890` and the panel appears. Drag it by
its header. To dry-run the panel on any other ESPN page, append `?copilot=1` to the URL.

**Re-run `npm run fetch:players && npm run build` the morning of the draft** so ADP is current.
ADP moves a lot in the final week.

---

## How the private-league reads work

League 1234567890 is private — `curl` gets a flat 401. Only a request carrying your ESPN
session cookie can read it, and *where the request comes from* decides whether the cookie is
attached:

- A fetch from the **extension's own origin** is cross-site to espn.com. If ESPN's `espn_s2`
  cookie is `SameSite=Lax`, the cookie is dropped and the call 401s.
- A fetch from a **content script on fantasy.espn.com** is same-site (both are `*.espn.com`),
  so the cookie goes along.

So the service worker asks an open ESPN tab to make the request on its behalf, and only falls
back to a direct fetch if no tab is available. Whichever path ESPN's cookie policy allows, one
of them works — and you don't discover which during a draft. If both fail you get "ESPN says
not authorized… make sure you are signed in" rather than a silent empty board.

Practical upshot: **keep a `fantasy.espn.com` tab open.** The draft room itself counts.

---

## The keeper sheet

Select the range in Google Sheets, copy, paste into the options page. Sheets copies as TSV so
there's no export step. Columns in any order, header row detected automatically:

| Team | Player | Round |
|------|--------|-------|
| Jack | Jaxon Smith-Njigba | 6 |
| Dave | Bijan Robinson | 1 |

Then set each keeper's **draft slot** (1–12) in the parse table so the simulation knows whose
round to burn. Names are fuzzy-matched against ESPN; anything that doesn't match is flagged in
red and skipped on save rather than silently dropped.

You can re-paste at any point, including mid-draft, and everything downstream recomputes.

### Why the draft slot matters

Keeping a player costs that team its pick in that round. Removing those slots from the snake
changes **every overall pick number after them**, including yours. With your R6 gone to JSN,
your R7 pick moves up. With other people's keepers in early rounds, your R1 moves up too. The
panel's "your next pick" and every availability percentage depend on this being right.

---

## What the panel shows

**Status strip** — the live overall pick, your next pick and how many picks away it is, and
Joel's round-by-round target for the current round.

**Alerts** — positional runs ("RB in 5 of the last 8") and tiers about to break, from the gold
underlines in his positional rankings.

**Board columns**

| Column | Meaning |
|---|---|
| # | Joel's PPR board rank |
| dot | Target (green) / I'll Pass (gold) / Avoiding (red) |
| T# | His tier at that position |
| ADP | ESPN ADP **adjusted for keepers** — hover for the raw number |
| ± | Picks between now and their adjusted ADP. Negative (green) = they've fallen past it. |
| % | Chance they last until your next pick |
| ▪ | Worst guardrail severity — hover for the list |
| ✓ | Mark drafted by hand (safety net) |

**Sort modes**

- **Best value** (default) — Joel's rank weighted by how likely the player vanishes before your
  next turn. A stud certain to still be there is demoted; this is rule #1 ("don't beat ADP")
  made mechanical. Hampton at Joel #10 with 77% survival scores *below* Jeanty at #11 with 16%.
- **Joel rank** — his board, straight
- **ADP** — keeper-adjusted market order
- **Joel edge** — where he's furthest ahead of the market

**Click any player** for the full card: adjusted '25 PPG with his reason string, luck metric with
the regression direction, PPR-vs-half lean, RB volume and gold-mine bucket, the team's OL rating
and playcaller tendencies and gamescript, every one of the 50 stats that mentions them, and the
profile card with ceiling/risk for the 16 preview players.

**Round plan.** Joel's round-by-round is written for 15 rounds; this league has 16. The plan is
mapped by shape rather than by literal round number — his last two rounds are always D/ST then
Kicker, so those anchor to R15/R16 and the surplus round becomes "BPA / Upside" at R14. The
no-K/DST guardrail follows the league's real round count too, so it opens at R15.

**Guardrails** fire on the selected player, drawn from p11:
no K/DST before the last two rounds · the RB30–40 dead zone · reaching 20+ picks ahead of ADP ·
risk stacking (his Nabers + Love + Kittle example) · the QB7–11 target band · round-plan drift.
Severity is `block` / `warn` / `note` / `good` — and off-plan is only ever a note, because
"Best Player Available still most important."

---

## Testing before the draft room opens

ESPN doesn't open the real draft room until close to your scheduled time, so
`fantasy.espn.com/football/draft?leagueId=…` is a dead link until then. Two ways to test anyway:

**Pick-sync — replay last season.** Options page → **Replay 2025 draft**. Your league's completed
2025 draft runs through the exact same path the live feed will use: same auth, same parsing, same
player-id mapping. If it comes back with real player names, the only untested link left is ESPN
populating the feed live.

**Panel mount and badges — use a mock draft.** `fantasy.espn.com/football/mockdraftlobby`. The
panel mounts there and badges attach to ESPN's player rows. Note that a mock is a *different*
league, so the pick counter will not advance — it's still polling your real league. That's
expected; use the replay above for sync and the mock for everything visual.

To see the panel on any other ESPN page, append `?copilot=1` to the URL.

---

## "Extension context invalidated"

Expected, not a bug. Reloading the extension orphans any content script already running
in an open tab — its `chrome.*` handles go dead. **Refresh the ESPN tab and it clears.**

The panel now detects this and shows an amber "This panel is out of date" bar with a
Refresh button instead of silently freezing, which is the behaviour that matters if Chrome
ever auto-updates the extension mid-draft. Rule of thumb: after any `npm run build`,
reload the extension *and* refresh the ESPN tab.

---

## If something breaks on draft night

1. **Panel gone but ESPN fine** — options page → **Open standalone board**. Same board in its own
   window, still syncing picks from ESPN's API. Draft in the ESPN window as normal.
2. **Pick sync stalls** — hit ✓ on players as they go. Manual marks override the API.
3. **You veto a pick as commissioner** — clear manual overrides in options; the API is the source
   of truth and will re-sync within 3 seconds.
4. **Badges vanish from ESPN's rows** — expected if ESPN changes their markup. The panel is
   unaffected; the badge layer fails closed by design.

---

## Layout

```
data/guide/       hand-transcribed guide, one file per section (source of truth, diffable vs the PDF)
data/overrides/   name aliases + the build's unmatched report
scripts/          fetch ESPN players, build the dataset, bundle the extension
src/core/         pure logic: keepers, board, rules, names (no DOM, no chrome.*)
src/panel/        Preact UI + the standalone fallback page
src/content/      panel mount + ESPN row badges
src/background/   service worker: all ESPN network access
src/options/      league config + keeper editor
test/             37 tests over core logic and panel rendering
```

## Commands

```bash
npm test                 # 37 tests
npm run fetch:players    # refresh ESPN ADP
npm run build:data       # rebuild dataset; FAILS LOUDLY on any unresolved guide name
npm run build:ext        # bundle
npm run build            # both
node scripts/scenario.mjs   # print a simulated draft situation against the real data
```

`npm run build:data` exits non-zero if any name in the guide fails to resolve to an ESPN id, or if
a rank sequence has a gap, or if the PPR and Half-PPR boards disagree on which 150 players exist.
That check is the reason a transcription typo can't reach draft day.

---

## What was intentionally left out of the transcription

Not relevant to a 12-team PPR redraft-with-keepers league:

- **Dynasty rookie rankings** (p8) — dynasty only
- **6-pt passing TD table** (p8) — our league is standard 4-pt passing TDs
- **Half-PPR positional rankings** (p7) — the half-PPR *big board* is included for reference,
  but our league is full PPR so the PPR positional ranks and tiers are what drive the panel

Everything else in the guide is in `data/guide/`.

## A note on the Gold Mine buckets

The guide presents the RB Gold Mine as a scatter plot with four labeled regions, not a table.
Buckets in `data/guide/rb-gold-mine.txt` are derived by reading each player's plotted position
against those labels, and players near a divider are marked `borderline` and shown as such on the
card. Treat it as the soft signal it is.
