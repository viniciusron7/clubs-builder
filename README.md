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
  editor includes +/− controls, a slider, next-point cost, and a breakdown. The
  six outfield categories also display their calculated face-stat OVRs:
  **PAC, SHO, PAS, DRI, DEF, and PHY**.
- **Body** — height and weight (limited by the archetype) adjust attributes using
  the actual formula and calculate **AcceleRATE** (Explosive/Lengthy/Controlled).
- **Club Facilities** — 34 player Facilities and 42 AI Facilities, with up to
  three stars and one budget shared by both groups. Player Facilities provide
  in-match attribute boosts and can automatically equip PlayStyles without
  consuming a regular slot; AI Facilities affect AI teammates only.
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
  `js/weights.js`:
  `OVR = floor(intercept + Σ weight·attribute) - 1`, clamped to 1–99. The
  expected tolerance is ±1.
- **In-game stats** — a persisted toggle switches attribute values, category
  face stats, position OVRs, the optimizer, and Max Sum between purchased
  values and effective values after body and player-Facility adjustments.
  Optimization still spends AP on purchased levels and stops before a positive
  adjustment would push an effective attribute past 99.
- **Screenshot import** — reads the full 16:9 outfield Attributes screen
  directly in the browser, including all 29 numeric attributes, Skill Moves,
  Weak Foot, and the green Key Attributes used to suggest an archetype. Every
  result is editable before it is applied. The importer reconstructs purchased
  levels from the current Body and Club Facilities adjustments, suggests the
  minimum feasible player level, and applies the import as one undoable change.
  JPEG, PNG, and WebP files are processed locally and are never uploaded.
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
  position and preserves existing upgrades as a floor. With In-game stats
  active, the reported sum and useful purchase caps use effective values.
- **UT players** — compact 80+ list, with costs calculated using the same editor
  tiers and values capped at the archetype maximum.
- **Undo/redo** — buttons and shortcuts Ctrl/Cmd+Z, Ctrl/Cmd+Y, and Cmd+Shift+Z.
- **Share by URL** (`?b=...`, v2 format with v1 link support) and **save as an
  image** with estimated OVRs by position.
- **Community Builds** — a public, account-free gallery rendered as FC-style
  player cards and shown directly on the home page. Visitors can favorite builds
  without signing in; the shared count is stored by Supabase while the browser
  keeps an anonymous device token to prevent duplicate favorites. The card
  preview uses the build's OVR, face stats, positions,
  Skill Moves, Weak Foot, and PlayStyles. A local UT catalog finds the closest
  athlete by attributes, positions, height, and weight; the publisher may
  replace that athlete and choose the rarity, nation, league, and a club from
  that league. Authors enter their public name only once, can optionally name
  each build, and locally retain its deletion credential. The backend uses
  Supabase and Cloudflare Turnstile with RLS, catalog validation, CORS, and
  publication limits.
  Published cards preserve the build's In-game stats mode, so their face stats
  use the same purchased or effective values shown by the builder.

The home page displays Community Builds and a **Create Build** action. The four
configuration tabs (PlayStyles / Specializations / Facilities / Body) open **modals** inside
the builder. Publish Build is a separate call to action in the tools bar and its
modal contains only the publication workflow. The main editor area displays
attributes and the selected attribute's detail panel.

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
    calc.js           # pure mechanics (AP, body, Facilities, PlayStyles...)
    optimizer-worker.js # multi-position solver outside the UI thread
    history.js        # immutable undo/redo history
    share.js          # URL encode/decode and canvas image export
    community-config.js # public gallery URL and site key
    community.js      # API client, local cache, and Turnstile
    build-card.js     # reusable FC-style Community card renderer
    screenshot-import.js # local fixed-layout FC screenshot recognition
    app.js            # state, rendering, and events
  data/               # enriched UT dataset and card metadata catalog
  scripts/            # reproducible UT catalog enrichment
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
  attributes, Facilities, PlayStyles, AP cost tables, AP-per-level tables, and
  English translations).
- The interface is English-only, matching the source content.
- URL encoding is custom and compact; it is **not** compatible with
  clubsbuilder.com.
- Run `node --test tests/*.test.js` to validate calculations, the model, solver,
  sharing, and history.
- `SCREENSHOT_FIXTURES=/absolute/first.jpg,/absolute/second.jpg
  tests/run-browser-smoke.sh` additionally runs the real-image screenshot
  recognition regression; without that variable, the smoke test uses a
  deterministic mocked recognition result for the import workflow.
- Full statistical model validation uses the optional original CSV:
  `EAFC26_VALIDATION_CSV=/path/to/eafc26_ut_players.csv node --test tests/model-validation.test.js`.
  Without it, only that heavyweight test is skipped; the functional suite
  remains self-contained.
