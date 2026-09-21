# fixture

`GET /api/fixture/:sport/:id`

One fixture in full: score, status, venue, the source timezone the detail
view shows, and the per-sport extras.

Nested dynamic route, so the directory is `[sport]/` and the file inside it
is `[id].js`. Both names are Vercel parameters.

## Why this is separate from the list

The extras cost an extra upstream call each. Paying that for every card on
the dashboard would exhaust a daily quota in an afternoon, so a list never
fetches them and a detail view always does.

| Sport | Extras | Cost |
|---|---|---|
| `basketball` | Box score, per quarter | A second balldontlie call |
| `formula1` | Full race results | One Jolpica call |
| `football` | Half time score, officials | Included in the match call |
| `multi` | None | Restricted on the free tier |

## Ids

Every id is prefixed by its source, because ids are only unique within one:

| Prefix | Shape | Source |
|---|---|---|
| `nba-` | `nba-<gameId>` | balldontlie |
| `f1-` | `f1-<season>-<round>` | Jolpica |
| `fd-` | `fd-<matchId>` | football-data |
| `tsdb-` | `tsdb-<eventId>` | TheSportsDB |

Adapters strip their own prefix before calling upstream. A fixture that
cannot be found answers 404, which is correct here: unlike an unavailable
sport, a missing fixture really is a missing thing.
