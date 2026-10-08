# Next season checklist

## Each year

1. **New guide.** Transcribe it into `data/guide/` (see [GUIDE-DATA.md](GUIDE-DATA.md)).
   Update any year-specific text: the panel sub-title in `src/panel/Panel.js`, the options
   page sub-title, and the round-by-round plan in `strategy.json`.
2. `npm run fetch:players && npm run fetch:sleeper` -- refresh ESPN's player universe and
   Sleeper's id map. `fetch-espn-players.mjs` has the season hard-wired; check it first.
3. `npm run build` -- fix any unresolved names (`data/overrides/aliases.json`).
4. Update `data/local/config.json` and `keepers.tsv`; roster slots / round count come from
   the league via "Connect to ESPN".
5. Review `src/core/rules.js`: the guardrails quote the guide's own rules and may change.
6. Reload the extension in `chrome://extensions`, then refresh any open ESPN tab.

## Rehearse early

- Build a Sleeper mirror league (README, "Practising on Sleeper"), draft the keepers by hand
  in their rounds, and run several full mocks.
- **Open the real ESPN draft room as soon as ESPN lets you** (the pre-draft lobby opens before
  the clock) and watch the panel footer. This is the only real test of the ESPN path.

## ESPN pick sync: status and open questions

In 2026 the ESPN auto-sync did not work during the live draft and picks had to be marked by
hand with the manual fallback (Sleeper rehearsals, which use a plain public fetch, were fine).
Fixes made afterwards and **not yet verified against a live ESPN draft**:

- The background relays the fetch straight to the tab that asked (`sender.tab.id` ->
  `preferredTabId`) instead of searching every `fantasy.espn.com` tab.
- ESPN's JSON error body is surfaced ("You are not authorized to view this League.") instead
  of a bare "ESPN 401".
- `leagueId` is read from the draft room URL (`?leagueId=`) rather than trusting whatever was
  saved in options -- a stale id is a silent way to point at the wrong league.
- A red "Not syncing picks" banner appears after two consecutive failures, so a dead feed is
  noticed mid-draft.
- The background serves its last known picks if a refresh throws, so one blip is not a stall.

Why the relay exists: `lm-api-reads.fantasy.espn.com` answers any origin with permissive CORS
headers, so CORS is not the obstacle. The blocker is `SameSite` cookie policy: a fetch from
the extension origin does not carry the session cookie, a fetch from a content script on
`fantasy.espn.com` does.

**Still unknown:** whether the `lm-api-reads` read-replica lags behind live picks. If the panel
says "Live" but updates slowly or not at all, that is the next thing to investigate: requests
would be succeeding with stale server-side data, which nothing client-side can fix. Try the
non-read host or a different `view=` parameter in `src/core/espn-api.js`.

## Ideas

- A recorded-fixture replay of a full ESPN draft through the poll loop.
- Split `Panel.js` further (status strip, controls, alert blocks) and the options sections.
