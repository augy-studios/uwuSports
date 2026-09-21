# .well-known

Served verbatim at the site root. Nothing here is read by the app.

| File | What it is |
|---|---|
| `assetlinks.json` | Digital Asset Links, for the Android TWA wrapper. |

## assetlinks.json

Associates `sports.uwuapps.org` with the Android package
`org.uwuapps.uwuSports`, which is what lets the installed app open uwuSports
links without the browser chrome and without a disambiguation prompt.

The SHA-256 fingerprint must match the certificate the APK or AAB is
actually signed with. If Play App Signing is enabled, that is **Google's**
signing certificate from the Play Console, not the local upload key. A
mismatch fails silently: the app installs, opens, and shows a browser
address bar, with no error to explain why.

Verify a change with Google's checker:

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://sports.uwuapps.org&relation=delegate_permission/common.handle_all_urls
```

The file must be served as `application/json` over HTTPS with no redirect.
Vercel does this correctly for static files in this directory.
