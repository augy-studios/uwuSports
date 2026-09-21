# images

Screenshots referenced by [`../manifest.json`](../manifest.json). They are
what an install prompt shows, so they are product assets rather than
decoration.

| File | Size | Form factor |
|---|---|---|
| `screenshot_1.png` | 1080x2340 | `narrow`, phone |
| `screenshot_2.png` | 1920x1080 | `wide`, desktop |

Both are precached by the service worker only indirectly, through the
manifest; they are fetched when an install prompt needs them.

Replacing one means matching the declared dimensions exactly. A manifest
whose `sizes` disagrees with the file is silently ignored by Chrome, which
drops the richer install prompt with no error anywhere.

App icons live one level up next to the manifest, not here: `USC-192.png`,
`USC-512.png` and `USC-main.png`.
