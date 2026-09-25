# Browser journeys

Not an example. The app the browser journeys drive, shaped like the store demo
where the bugs were found: a root layout, a shop layout under it, a category
layout under that, pattern shells resumed per request, an action that
revalidates the whole document, and one page with no JavaScript at all.

Every journey is a bug that passed the unit suites and was found by tapping
through a real build on a phone, and each was proven by putting its bug back
and watching the journey fail:

| journey | the bug it guards |
| --- | --- |
| `walk` | home, a category, home, another category: the url changed, the page did not |
| `cart` | add to cart, then the brand link: home in the bar, the product on screen |
| `nojs` | a page with no script in its markup hinting the whole runtime in its Link header |
| `binary-resume.sh` | a compiled binary renaming components and refusing every resume |

`hydration`, `history` and `binary.spec` are smoke checks of behaviour that has
held: a tap before the runtime arrives, back and forward keeping what was typed,
and a binary serving at all.

```sh
bun run core                  # pack the engine, install it as a user does
bun run build
npx playwright install chromium
npx playwright test           # as an iPhone, on a CPU four times slower
./binary-resume.sh            # on a fresh scaffold
WALK_SEED=123 npx playwright test walk   # replay a failing walk
```

The engine is installed from a packed tarball rather than the workspace on
purpose: linked, it bundles differently, and the binary rename did not happen.
