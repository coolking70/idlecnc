# Stage 10-P-A — C&C Command UI Foundation Handoff

## Delivery identity

- Base SHA: `ca408bb7031afda79a65af7aad27b6b64b7c18c4`
- Final implementation checkpoint SHA: `136b8573eefb85911f35b23c3043f5f5f6c87832` (the exact code/test input bound by machine evidence).
- Final delivery SHA: the commit containing this handoff, evidence, screenshots, and ZIP; its immutable value is reported in the final delivery and CI run because a Git commit cannot contain its own hash.
- Branch: `auto/stage10-p-a-command-ui-foundation`
- Scope: presentation, UI, and interaction architecture only. Stage 10-P-B and Stage 10-A are not started.

## Files changed

- Shared presentation: `js/command-ui.js`, `js/command-presentation.js`, and the `command-*` namespace in `css/style.css`.
- Migrated UI composition: `js/ui.js` and the favicon-only browser hygiene update in `index.html`.
- Local presentation assets: `assets/command/*.svg`.
- Tests and evidence: `tests/stage10-P-A-*`, `tests/browser/stage10-P-A-command-ui.mjs`, `tests/lib/stage10-P-A-verifier.mjs`, evidence/selfcheck generators, CI workflow, and Stage 10-P-A evidence/screenshots.
- Existing presentation assertions were updated in `tests/stage3-test.mjs`; the Stage 9 authority guard was extended only to recognize the two new presentation files in `tests/stage9-E-integration-test.mjs`.

## New UI architecture

Canonical state is read through pure presentation builders and then consumed by generic UI primitives:

```text
existing game state
→ read-only command presentation models
→ CommandSurface
→ CommandGrid / CommandTile
→ one QuickTooltip host + one CommandInspector host
```

The reusable layer includes `CommandTile`, `CommandGrid`, `QuickTooltip`, `CommandInspector`, `StatusBadge`, `ProgressOverlay`, `CategoryBar`, and `LongPressController`. `CommandTile` has no gameplay-authority imports. A tile model carries its visual state, badges, progress, tooltip, inspector, and an action identifier/payload that the existing UI authority adapter dispatches.

## Migrated pages

- Construction command grid and current construction progress.
- Unit production command grid.
- Equipment production command grid.
- Compact active/waiting production queue.

The remaining pages intentionally retain their legacy UI for coexistence during staged migration.

## Interaction contract

- Primary mouse click, touch tap, or keyboard Enter/Space on an actionable tile performs exactly one existing command.
- Desktop hover/focus opens the shared quick tooltip after 150 ms.
- The detail affordance/context action opens the inspector on desktop.
- Mobile long press uses a unified 450 ms Pointer Events controller and opens details only.
- Movement beyond tolerance, pointer cancellation, lost capture, and scrolling cancel a pending long press.
- A completed long press consumes the following click, so it never produces, builds, cancels, or deletes.
- Locked and resource-insufficient tiles remain focusable and inspectable but cannot mutate gameplay state.
- Queue cancellation is an explicit inspector action, not a destructive tile click.

## Desktop and mobile behavior

Desktop uses responsive image-first grids, keyboard-native button semantics, delayed tooltips, and a floating inspector. At 1024 px the grid retains usable tile dimensions. At 480 px and 390 px it reflows to a touch-friendly two-column command surface; the inspector becomes a bottom sheet. Mobile can browse, tap to produce, inspect by long press, and view the queue without relying on hover.

## Gameplay authority freeze proof

`evidence/stage10-P-A/stage10-P-A-machine.json` recomputes SHA-256 equality against the accepted base for construction, production, equipment, state, save, offline progression, formation, theater, battle, salvage, battle-session, and save-diff authority files. It also rejects worktree changes outside the allowlisted presentation/test/delivery scope. `gameplayAuthorityChanged` is false.

The canonical state-equivalence test runs equivalent direct-authority and presentation-resolved flows for construction, unit production, equipment production, and queued cancellation. It compares resources, construction/production queues, units, equipment inventory, and canonical top-level keys; no fields are added.

## Save version proof

`SAVE_VERSION` remains `10`. `js/config.js`, `js/state.js`, and `js/save.js` are byte-identical to the accepted base. No save schema or migration was introduced.

## Tests and verification

- `npm test`
- `npm run test:stage9-E:fast`
- `npm run test:stage10-P-A`
- `npm run browser:stage10-P-A`
- `npm run verify:stage10-P-A`
- `npm run build:stage10-P-A`
- `npm run verify:stage10-P-A-package`

Stage 10-P-A focused coverage includes model rendering, locked/disabled/progress/badges, native keyboard commands, single shared hosts, tooltip timing, inspector read-only behavior, long-press safety, real-DOM construction/unit/equipment actions, rapid-click exactness, invalid zero-mutation, responsive layouts, and canonical state equivalence. Historical gameplay semantic tests remain present.

## Browser evidence

The production page was exercised through real Chromium DOM input. Fixture setup is used only to reach deterministic UI states; gameplay actions are not invoked through debug APIs or direct handlers. The manifest records 13 unique PNG hashes, zero page errors, zero console errors, DOM action provenance, global-host counts, and desktop/mobile/hover/long-press/keyboard coverage.

Screenshots:

1. `01-construction-command-grid.png`
2. `02-construction-hover-tooltip.png`
3. `03-construction-active-progress.png`
4. `04-unit-production-command-grid.png`
5. `05-unit-hover-tooltip.png`
6. `06-unit-locked-state.png`
7. `07-unit-resource-insufficient.png`
8. `08-production-queue.png`
9. `09-equipment-command-grid.png`
10. `10-equipment-tooltip.png`
11. `11-mobile-480-production.png`
12. `12-mobile-390-production.png`
13. `13-mobile-inspector.png`

## Known limitations

- The new building/equipment images are deterministic local presentation silhouettes, not final production artwork.
- Command UI and legacy pages intentionally coexist; the global navigation is unchanged.
- Touch devices use inspector long press rather than hover tooltips.

## Deferred Stage 10-P-B work — not implemented

- Units page full migration
- Formation page migration
- Theater page migration
- Repairs page migration
- Research page migration
- Reports page migration
- Overview migration
- Full global Command Sidebar navigation replacement
- Operational Assignment
- Dynamic Theater
- Doctrine
- Auto Dispatch
