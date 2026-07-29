# FC 26 Pro Clubs Builder

An EA FC 26 Clubs builder implemented without a framework, using plain HTML, CSS, and JavaScript.
It lets you create, optimize, share, and export player builds.

## Running locally

Use a local server. Browsers block resources used by the UT dataset, Web Worker,
canvas, and clipboard when the page is opened directly through `file://`.

```bash
cd clubs-builder
python3 -m http.server 4173 --bind 0.0.0.0
# open http://localhost:4173
```

## Included features (parity with the original)

- **Archetypes** (13: 2 GK, 4 DEF, 4 MID, 3 FWD) with position filtering.
- **Attributes** — 8 categories with a faithful **AP (Attribute Points)** system:
  total AP per level, per-point cost based on tier and value, and tier discounts
  for key attributes. The maximum level is **100**, with **3167 total AP**. The
  editor includes +/− controls, a slider, next-point cost, and a breakdown.
- **Body** — height and weight (limited by the archetype) adjust attributes using
  the actual formula and calculate **AcceleRATE** (Explosive/Lengthy/Controlled).
- **PlayStyles** (modal) — 4 **signature** PlayStyles (upgraded to "+" at levels
  30/50/75/95) plus 9 regular slots unlocked by level
  (1/10/20/40/60/70/80/90/95). Locked PlayStyles provide **Quick Unlock**, which
  purchases their requirements through the central AP calculation while
  respecting archetype caps and available AP.
- **Specializations** (modal) — 3 per archetype, each with attribute requirements.
  They unlock when the requirements are met or through **Quick Unlock** (which
  spends AP). Only one Specialization can be active at a time, replacing one of
  the 4 signature slots with its PlayStyle+.
- **Positions + estimated OVR** — select one or more outfield positions; GK is
  automatic for goalkeepers. Each position is calculated independently by
  `js/weights.js` using purchased attributes only:
  `OVR = floor(intercept + Σ weight·attribute) - 1`, clamped to 1–99. Height and
  weight affect in-match attributes, not the estimated lobby OVR. The expected
  tolerance is ±1.
- The v2 model was validated against Common/Rare base cards: 93.43% exact and
  99.995% within ±1 across 19,363 outfield players; 88.05% exact and 100% within
  ±1 across 2,528 players rated 75+; and 98.05% exact and 100% within ±1 across
  2,303 goalkeepers.
- **Optimize Overall** (modal) — two modes:
  1. *Maximize overall for a given AP budget* (additional): allocates AP to
     maximize overall.
  2. *Minimum AP for a target overall*: finds the attribute levels needed to
     reach the target while spending as little AP as possible.

  With **multiple positions**, it uses MinMax: maximize the lowest OVR, then the
  sum, and finally minimize AP. The search runs in a Web Worker with Pareto
  pruning and limits of 250,000 states/2 seconds. Results report `optimal` when
  proven or `best-found` when the bounded search returns its strongest result.
  Before applying a result, costs, caps, and OVRs are recalculated; AP that does
  not affect the objective is removed; and impossible targets show the highest
  OVR that can actually be reached. Closing the modal cancels an active search.
  Previously upgraded attributes are preserved as a floor.

  The modal also lets you **exclude attributes** (gray/struck-through chips).
  The optimizer will not spend AP on them; they remain fixed but still count
  toward overall at their current value.
- **Maximize Attribute Sum** ("Σ Max Sum" button) — select attributes (chips with
  All/None) and an AP budget. AP is distributed to **maximize the sum** of those
  attributes by purchasing the cheapest points first. This is independent of
  position and preserves existing upgrades as a floor.
- **UT players** — compact 80+ list, with costs calculated using the same editor
  tiers and values capped at the archetype maximum.
- **Undo/redo** — buttons and shortcuts Ctrl/Cmd+Z, Ctrl/Cmd+Y, and Cmd+Shift+Z.
- **Share by URL** (`?b=...`, v2 format with v1 link support) and **save as an
  image** with estimated OVRs by position.
- **Community Builds** — a public, account-free gallery. Authors enter their name
  and a build name; the browser remembers the author and locally stores the
  deletion credential for each publication. The optional backend uses Supabase
  and Cloudflare Turnstile with RLS, validation, CORS, and publication limits.

The three configuration tabs (PlayStyles / Specializations / Body) open
**modals**. Community Builds has a dedicated action in the summary bar, while
Publish Build is available as a separate call to action in the tools bar. The
main area displays attributes and the selected attribute's detail panel.

## Structure

```text
clubs-builder/
  index.html          # GitHub Pages entry point
  site.webmanifest    # installation/PWA metadata
  assets/
    fonts/            # Cruyff Sans family used by the interface
    ui/               # custom interface icons (AP and Key Attribute)
  archetypes/         # archetype SVG icons
  playstyles/         # PlayStyle and PlayStyle+ PNG icons
  css/
    vendor.css        # compiled Tailwind reused from the original
    app.css           # additions (missing utilities and adjustments)
  js/
    data.js           # ALL game data (extracted and normalized)
    calc.js           # pure mechanics (AP, body, PlayStyles, eligibility...)
    optimizer-worker.js # multi-position solver outside the UI thread
    history.js        # immutable undo/redo history
    share.js          # URL encode/decode and canvas image export
    community-config.js # public gallery URL and site key
    community.js      # API client, local cache, and Turnstile
    app.js            # state, rendering, and events
  data/               # compact UT dataset used by the interface
  supabase/           # Community Builds migration and Edge Function
  docs/               # backend activation and technical contract
  tests/              # node:test suite and browser smoke test
```

## Enabling Community Builds

The interface already supports its configured state, but publishing and listing
builds requires the backend. Follow
[docs/COMMUNITY_SETUP.md](docs/COMMUNITY_SETUP.md). Secrets stay in Supabase;
only the function URL and public Turnstile site key belong in
`js/community-config.js`.

## Notes

- Data was faithfully extracted from the original build chunks (archetypes,
  attributes, PlayStyles, AP cost tables, AP-per-level tables, and English
  translations).
- The interface is English-only, matching the source content.
- URL encoding is custom and compact; it is **not** compatible with
  clubsbuilder.com.
- Run `node --test tests/*.test.js` to validate calculations, the model, solver,
  sharing, and history.
- Full statistical model validation uses the optional original CSV:
  `EAFC26_VALIDATION_CSV=/path/to/eafc26_ut_players.csv node --test tests/model-validation.test.js`.
  Without it, only that heavyweight test is skipped; the functional suite
  remains self-contained.
