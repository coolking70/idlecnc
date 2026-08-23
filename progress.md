Original prompt: Continue idlecnc from `auto/stage10-c-command-doctrine` on `auto/stage10-d-auto-operations`; implement Stage 10-D Auto Operations for deterministic Doctrine + Theater Pressure assignment of Stage 10-A PATROL / RECON / SECURITY only, with Overview toggle, manual recall hold/release, save/offline parity, targeted/browser tests, two Stage 10-C P3 fixes, handoff, commit and push; stop before Stage 10-E.

# Current development status

## Stage 10-D work in progress (2026-08-24)

- Created `auto/stage10-d-auto-operations` from exact parent SHA `01710cd777af9ba39ebe005ffb93f5b7490bb854`.
- Added `js/auto-operations.js`: fail-closed enabled selector, canonicalizer, stable Doctrine/Pressure planner, hold release, summary, authority-only assignment.
- Added canonical `state.autoOperations = { enabled: false }`; save migration preserves strict enabled and old saves remain disabled.
- Added `task.autoAssigned` and manual recall `formation.autoTaskHold`; offline planner runs at settlement start and after existing event steps.
- Connected main tick, Overview toggle/status, Formation Inspector AUTO/AUTO HOLD, and adjusted task upkeep presentation.
- Removed duplicated `.command-doctrine-grid` CSS.
- First syntax + `test:stage10-C` pass complete; first skill Playwright startup/action screenshot inspected (base canvas healthy).
- Added `test:stage10-D` (21/21) and `browser:stage10-D` (15/15, three unique screenshots, 0 page errors, 0 console errors); all screenshots visually inspected.
- Requested regressions passed: Stage 10-A 27/27 + A.1a 5/5, Stage 10-B 16/16, Stage 10-C 15/15, Stage 10-P-B 22/22, Stage 9 frozen authority exit 0.
- `render_game_to_text` now exposes concise Auto Operations and active Operational Task state for deterministic browser observation.
- TODO: write handoff against implementation SHA, commit handoff, push branch. Do not start Stage 10-E.

## Active milestone

- Stage: Stage 10-A.1 — Operational Tasking Consistency Hotfix
- Branch: `auto/stage10-a1-tasking-consistency-hotfix`
- Parent milestone: Stage 10-A Operational Tasking Core
- Save schema: `SAVE_VERSION = 10`

## Current implementation

- Operational tasks: PATROL / RECON / SECURITY.
- Tasking is mutually exclusive with battle dispatch, formation membership mutation, disbanding, and unit repair.
- Offline task upkeep advances at the same task interval boundaries as online simulation.
- Operation dispatch returns stable `formation_tasked` failures for tasked formations.
- Stage 9 frozen authority is protected by byte-frozen and semantic-shared contracts.

## Latest verified results

- `npm run test:stage10-A`: 27/27 passed.
- `npm run browser:stage10-A`: 27/27 assertions, 6 unique screenshots, 0 page errors, 0 console errors.
- Stage 9 relevant regressions passed; `SAVE_VERSION` remains 10.

## Handoffs

- Current: `HANDOFF-STAGE10-A1.md`
- Parent: `HANDOFF-STAGE10-A.md`
- Command UI history: `HANDOFF-STAGE10-P-A.md`, `HANDOFF-STAGE10-P-A1.md`, `HANDOFF-STAGE10-P-B.md`, `HANDOFF-STAGE10-P-B1.md`

Detailed Stage 2–9 process logs and delivery-package records were removed from the working tree during repository cleanup. Tracked history remains recoverable through Git.
