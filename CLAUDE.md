# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

EA FC 26 Pro Clubs build editor. Zero build step, zero dependencies, zero `package.json` — plain HTML/CSS/ES5-ish JS loaded via `<script>` tags in `index.html`. Every module attaches a global (`window.DATA`, `window.Calc`, `window.Share`, `window.BuildHistory`, `window.OVERALL_MODEL`, `window.MultiOverallSolver`).

Source comments and the README are in Portuguese; all user-facing UI strings are English (they live in `DATA.labels`).

## Commands

```bash
# Serve — required. file:// breaks the UT dataset fetch, the Web Worker, canvas export and clipboard.
python3 -m http.server 4173 --bind 0.0.0.0    # then http://localhost:4173

# Unit tests (node:test, no deps)
node --test tests/*.test.js
node --test tests/calc.test.js                       # one file
node --test --test-name-pattern 'multi-position' tests/calc.test.js   # one test

# Optional heavy statistical validation of the OVR model (skipped without the CSV)
EAFC26_VALIDATION_CSV=/path/to/eafc26_ut_players.csv node --test tests/model-validation.test.js

# End-to-end smoke test — needs the server above already running on :4173 + Chrome on macOS
sh tests/run-browser-smoke.sh    # drives headless Chrome over CDP, writes screenshots to /tmp
```

## Architecture

**Data flow is one-way and stateless-per-render.** `app.js` owns a single mutable `build` object (archetype, level, clubLevel, height/weight, purchased attributes, facilities, playstyles, signatures, positions, exclusion lists). Nothing else is cached: every render calls `Calc.derive(build)` to recompute the full derived state (categories with current values, body/facility adjustments, AP totals, AcceleRATE, unlocked slots), then re-renders whole DOM sections via `innerHTML`. There is no virtual DOM, no reactivity, no component state.

**All mutations go through `commitBuildChange(mutator)`** in `app.js`. It snapshots, applies the mutator, runs `Calc.normalizeBuild` (which re-clamps everything to current game rules — AP ceiling, shared facility budget, playstyle slots, one specialization, GK-forced position), records undo history, re-renders, and syncs the URL. Mutating `build` outside this wrapper skips history + normalization + URL sync. The few deliberate exceptions (`liveBody`, chip toggles in the optimize/max-sum modals) bypass full re-render to avoid destroying live `<input>` state, and call `rememberBuildChange` + `syncUrl` by hand.

**The URL is the persistence layer.** No localStorage. `Share.replaceUrl` writes `?b=<base64url JSON>` on every change; `init()` reads it back through `normalizeBuild`. Encoding is v2 with short keys (`a`,`l`,`c`,`h`,`w`,`t`,`f`,`af`,`p`,`s`,`po`,`da`,`se`); v1 links (no `af`) still decode. It is **not** compatible with clubsbuilder.com.

**Layer boundaries:**

| File | Role |
|---|---|
| `js/data.js` | ~9.5k lines of extracted game data + EN labels. Single `window.DATA` literal: archetypes, categories/attributes, 34 player + 42 AI facilities, playstyles, specializations, AP cost tables, club budgets, labels. Hand-edit only with a source of truth — the tests assert exact counts (`facilities.length === 34`, `totalAP(100) === 3167`, 3 specializations per archetype). |
| `js/weights.js` | Frozen linear OVR model v2 (`intercept + Σ weight·attr`, floored, clamped 1–99). Outfield weights are regression-fit; GK is a separate sum-to-one fit. Two attribute ids differ from the builder's (`att_position`→`att_positioning`, `def_aware`→`defensive_awareness`) — `Calc.PESO_KEY` bridges them. Don't retune without re-running `model-validation.test.js`. |
| `js/calc.js` | All pure mechanics, no DOM: AP costs/tiers, body height-weight adjustments, AcceleRATE, facility boosts/unlocks, eligibility, quick-unlock plans, OVR evaluation, and the optimizers. |
| `js/optimizer-worker.js` | Multi-position solver. Loads both as a Worker (`self.addEventListener('message')`) and as a Node module (`root.MultiOverallSolver`) via the same IIFE — the tests import it directly. |
| `js/history.js` | Immutable undo/redo over JSON snapshots, 100 entries. |
| `js/share.js` | URL encode/decode + a hand-drawn canvas build card for PNG export. |
| `js/app.js` | All rendering (template strings) and all events (three delegated listeners on `document.body` for click/input/change, plus keydown). New interactive elements need a `data-*` hook added to the `closest(...)` selector list in `init()`. |

**Optimizers — three distinct code paths, don't conflate them:**
- Single position: exact DP over AP budget (`exactMaxOverallPlan` / `exactUpgradePlan`) — always reports `status: 'optimal'`.
- Multiple positions: MinMax objective (maximize the lowest OVR, then the sum, then minimize AP) run in the Web Worker with Pareto pruning, beam search, and hard limits of 250k states / 2s. Reports `'optimal'` only when it proved it; otherwise `'best-found'`. Falls back to a greedy plan (`fastMaxMinPlan`) if `Worker` is unavailable, on error, or on timeout; closing the modal aborts via `AbortSignal`.
- `maximizeSum`: greedy cheapest-point-first, provably optimal for its objective, position-independent.

Every optimizer result is re-validated in `optimize()` before it reaches the UI: values re-clamped, cost recomputed, AP that doesn't move the objective trimmed back out (`trimOptimizerValues`), and infeasible targets reported with the real achievable OVR.

## Invariants worth preserving

- **OVR uses purchased attribute values only.** Body and facility adjustments change effective in-match attributes (`derived.effective`), never the lobby OVR estimate. Tests assert this.
- Attributes only ever go *up* from their archetype `baseValue`; `build.attributes` omits any attribute still at base.
- `affordableTarget` gates every manual attribute increase so available AP never goes negative; lowering always refunds.
- Facilities: player and AI share one club-level budget, but AI facilities only affect AI teammates — they must never appear in `facAdj`.
- Exactly one specialization can be active, occupying one of the 4 signature slots.
- Quick Unlock for both playstyles and specializations routes through `Calc.requirementUnlockPlan` — the single source of AP-cost truth. Don't add a parallel cost calculation.
- CSS: `css/vendor.css` is a compiled Tailwind bundle carried over from the original and is not regenerated. Missing utilities go in `css/app.css` by hand.
