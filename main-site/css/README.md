# css

Two stylesheets, loaded in this order. The order matters: `style.css`
consumes tokens that `theme.css` defines.

| File | What it is |
|---|---|
| [`theme.css`](theme.css) | The token system. Copied from `uwuapps-theme.md` at the repo root. |
| [`style.css`](style.css) | Everything specific to uwuSports. |

## theme.css

Do not edit this to solve an app problem. It is a copy of the canonical
spec, and the whole point is that it is identical across the suite. If a
token is missing, add the rule to `style.css`; if the *system* needs a new
token, change the spec first and re-copy.

Two independent axes on `<html>`, combining freely into 14 valid states:

| Axis | Attribute | Values |
|---|---|---|
| Brand colour | `data-color-theme` | 7 swatches |
| Mode | `data-mode` | `light`, `dark` |
| Mode preference | `data-mode-preference` | `light`, `dark`, `time` |

`data-mode-preference` exists so the theme modal can show the right button
pressed after a reload, and so anything inspecting the page can tell "dark
because you asked" from "dark because it is nine in the evening". **No
stylesheet reads it.** Every colour block selects on the first two only.

## Rules that are not preferences

- **No gradients, orbs or blobs.** The page background is one flat colour:
  `color-mix(in srgb, var(--brand) 10%, var(--bg))`. If something seems to
  call for a gradient, use a flat tint or a glass card.
- **Never hardcode a hex in `style.css`.** Reference the variable so it stays
  correct across all 14 combinations. The one exception is `.footer-heart`
  at `#34c759`, which must read as a heart whatever the brand swatch is.
- **Text on a brand tint uses `--on-brand`, never `--brand-ink`.** Brand
  swatches are pale in both modes, so `--brand-ink` on a tint reaches 1.9:1
  in dark mode.
- **Secondary text on `--surface-strong` uses `--muted-strong`.** Plain
  `--muted` is tuned against `--surface`; on a strong surface nested in a
  glass card the two overlays stack and it drops to 3.6:1 in dark mode.
  Set `opacity: 1` on placeholders using it, since a stacked multiplier puts
  the pair back under AA.
- **Fills that track the brand keep tracking it**, in both modes, via
  `--brand-fill` or `--brand-fill-strong`. Foregrounds do not: text, links
  and focus borders stay on `--brand-ink`.
- **Font is Jua everywhere**, set once on `*`. No per-component
  `font-family`.
- **Everything that opens, closes or switches state animates**, 150 to
  220ms, and respects `prefers-reduced-motion: reduce`.

## Shape conventions

- `.glass` surfaces: `border-radius: 20px`
- Cards and modals: 16 to 20px
- Chip buttons: `999px`; rectangular buttons: 12 to 14px
- Icon buttons: 42px square, 34px with `.small`
- Layout column: `max-width: 720px`, padding 14px, 10px under 480px
- Single breakpoint: `@media (max-width: 480px)`

## Status colours

Each is tuned to read at 4.5:1 against a 14% tint of itself, which is the
standard badge treatment used on fixture cards:

```css
.fixture-status.is-live {
  background: color-mix(in srgb, var(--ok) 14%, transparent);
  color: var(--ok);
}
```

## Checking a change

The trap is a change that looks right in light plus classic and fails in one
of the other 13 states. Before shipping, walk both modes against at least
`classic`, `really-light-green` (the palest, where the active swatch ring
carries the state on its own) and one mid swatch.
