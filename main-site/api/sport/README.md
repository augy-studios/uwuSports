# sport

`GET /api/sport/:sport?date=YYYY-MM-DD`

One sport's fixtures for a day. `[sport].js` is a Vercel dynamic route, so
the bracketed filename is the parameter name, not a placeholder to rename.

`:sport` is the **internal** id, never an upstream's name:

| `:sport` | Source |
|---|---|
| `basketball` | balldontlie, enhanced by ESPN |
| `formula1` | Jolpica-F1 |
| `football` | football-data.org, enhanced by ESPN |
| `multi` | TheSportsDB |
| `badminton` | None, answered as unavailable |
| `olympics` | None, answered as unavailable |

The two unavailable sports return **200 with an empty list and a reason**,
not a 404. The client renders that as an honest coming-soon state; a 404
would render as a broken section. Neither ever returns placeholder fixtures.

A sport whose key is unset answers the same way, with `available: false` and
a reason naming the missing variable.

Formula 1 is the one collector that ignores the date. The calendar is sparse
enough that a day-scoped view is empty most of the year, so it returns the
season around today instead, which is what somebody opening the tab on an
ordinary Tuesday actually wants.
