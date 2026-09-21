# sources

One adapter per upstream API. Each is swappable: they all return the same
normalised fixture, so replacing a source touches its file and nothing else.

| File | Covers | Key | Limit |
|---|---|---|---|
| [`jolpica.js`](jolpica.js) | All Formula 1 | None | 200/hour |
| [`balldontlie.js`](balldontlie.js) | NBA | Required | ~60/minute |
| [`thesportsdb.js`](thesportsdb.js) | Badges, artwork, multi-sport browse | Public test key | 30/minute |
| [`footballdata.js`](footballdata.js) | Football | Required | 10/minute |
| [`apisports.js`](apisports.js) | Secondary, 12 sports | Required | 100/**day** per sport |
| [`espn.js`](espn.js) | Live score enhancement only | None | Undocumented |

## The contract

Every exported fetcher returns fixtures built with `makeFixture()`:

```js
{ sport, competition, homeName, awayName,
  homeScore, awayScore, status, startTime, venue }
```

Plus additive fields: `id`, `source`, `sourceTimezone`, `delayed`,
`homeBadge`, `awayBadge`, `extra`.

Three rules:

1. **`null` means the source does not carry it.** Never guess, never
   substitute an empty string, never invent a plausible venue.
2. **`startTime` is a real ISO instant with an offset**, not a local wall
   clock, because the client renders it in the reader's timezone.
3. **The upstream's own shape never leaves this directory.** If an endpoint
   is reaching into a raw response, the mapping belongs here instead.

A source needing a key exports `isConfigured()`. Callers check it and return
`available: false` with a reason rather than calling and failing.

## Per source

### jolpica.js

Ergast's successor, Apache 2.0, no key. Covers the whole F1 section:
schedules, results, qualifying, standings, lap times, pit stops.

A grand prix is not two teams against each other, so the shape bends:
`homeName` carries the race name and `awayName` the circuit. That keeps one
card component for the whole app, which was the point of normalising.

Jolpica publishes no live flag, so `statusForRace()` infers a roughly two
and a half hour window from the start time. It is labelled in progress, and
never presented as a live score.

### balldontlie.js

**Every fixture carries `delayed: true`.** Upstream refreshes roughly every
10 minutes. The status field is a clock like `Q3 4:21`, a bare date for an
unplayed game, or `Final`, and all three are handled.

The box score is a separate call and a separate rate limit hit, so it is
fetched only on the detail view, never for a list.

### thesportsdb.js

**Never a live scores source.** Livescores are premium only, so an event
with a score is finished and one without is scheduled. Many search queries
are restricted on the free tier, which is why `searchTeams()` returns an
empty array on failure rather than throwing.

Its real job is badges. `decorateBadges()` is bounded to 12 lookups per call
and memoised per invocation, so a busy Saturday does not fire 80 requests at
a 30 per minute limit. A missing badge is cosmetic and the card falls back
to an initial.

### footballdata.js

**Delayed on the free tier**, so `delayed: true` throughout. The tightest
limit of the primary sources at 10 a minute, so `fetchByDate()` covers every
competition in one call rather than looping.

There is no team search endpoint on the free tier. `searchTeams()` walks
cached competition tables instead of spending requests on a lookup that does
not exist.

### apisports.js

**100 requests a day, per sport.** Never use it for anything a primary
source can serve. It exists for gaps, and everything through it is cached at
the standings or metadata TTL, never the live one. One key works across
every sport host. `remainingQuota()` is surfaced by `/api/health` so the
quota is visible before it runs out rather than after.

### espn.js

Undocumented, unofficial, unsupported, and the fastest free live-ish scores
there are. That tension is why it is an enhancement layer only.

It **never produces a fixture list.** `enhance()` takes fixtures a primary
source already returned and matches on normalised team names. Only
in-progress fixtures are touched: a finished game already has its final
score, and overwriting a scheduled one would quietly make an unofficial
endpoint the source of truth. Any failure is logged and the fixtures are
returned untouched.

`ESPN_ENABLED=0` switches it off if the endpoints start returning nonsense.

## The two gaps

There is no `badminton.js` or `olympics.js`, deliberately.

No free API exists for either. The BWF publishes none and the community
scrapers have been IP-banned; every Olympic provider gates the data behind a
paid plan. `api/sport/[sport].js` answers both with an empty list and a
plain reason, which the UI renders as a coming-soon state.

**Do not stub either with placeholder fixtures**, and do not scrape BWF or
tournamentsoftware.com from a Vercel function. An empty section that
explains itself is worth more than a full one that is lying.
