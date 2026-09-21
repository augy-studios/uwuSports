# standings

`GET /api/standings/:sport?competition=PL&table=drivers`

League tables and championship standings. `[sport].js` is a Vercel dynamic
route.

| `:sport` | Returns | Extra parameter |
|---|---|---|
| `formula1` | Driver or constructor championship | `table=drivers` or `constructors` |
| `football` | A league table | `competition=PL`, and the other 11 codes |
| `basketball` | NBA standings by wins | None |
| `multi` | Unavailable, with a reason | None |

Cached for 30 minutes. A table does not move between matches, and
football-data only allows 10 requests a minute, so a shorter TTL would spend
the budget on data that had not changed.

Every loader returns the same render-ready shape, so `views.js` draws any
sport's table with one function:

```js
{ title, columns: ["Pos", "Team", "Pts"], rows: [["1", "Name", "42"]] }
```

Rows are arrays of strings, already ordered. Sorting belongs in the adapter,
not the renderer.

A source with no table answers `available: false` and a reason rather than
an empty table, which would read as "this league has no standings" instead
of "this source does not publish them".
