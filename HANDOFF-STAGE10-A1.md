# Stage 10-A.1 — Operational Tasking Consistency Hotfix Handoff

## Delivery identity

- **Branch**: `auto/stage10-a1-tasking-consistency-hotfix`
- **Parent**: `53d4b438152861ccbec3e5d4504160abe73405d3` (`auto/stage10-a-operational-tasking-core` branch head — the Stage 10-A handoff docs commit; the Stage 10-A implementation commit itself is `605a622`)
- **Implementation SHA**: the implementation commit on this branch (see git log; single fix commit containing all authority/test changes)
- **Final Branch HEAD**: this handoff commit (implementation + handoff kept as distinct commits; the final HEAD is reported after the commit is created, since a commit cannot contain its own hash)

## 1. Repair ↔ Tasking mutual exclusion (P0)

Tasked formations keep the Stage 9 `idle` lifecycle, so `canQueueRepair()` previously accepted their `assigned` members: `queueRepair()` then detached the unit from the formation while `formation.tasking` stayed active — RECON kept ticking/charging on a shrinking/empty formation.

Fix (authority layer, `js/repairs.js`): the `assigned + idle formation` branch of `canQueueRepair()` now also checks `getOperationalTask(state, formation.id)` and rejects with the new `REPAIR_CODE.FORMATION_TASKED = 'formation_tasked'` / reason `该单位所属编队正在执行作战任务，请先召回`. `queueRepair()` fails through the same check with canonical state untouched; no automatic recall. UI (disabled tile + inspector reason) consumes the authority result naturally.

## 2. Formation authority guards (P0)

`js/formations.js` no longer relies on `main.js`'s `guardFormationNotTasked()` as the only boundary. A read-only `failIfTasked()` helper reusing the tasking selector rejects `canAddUnit` / `addUnit` / `removeUnit` / `disbandFormation` with the new `FORMATION_CODE.FORMATION_TASKED = 'formation_tasked'` / reason `该编队正在执行作战任务，请先召回`. `renameFormation` stays allowed during a task (verified), `getFormationStats` is read-only, `setStatus` / `applyPreset` untouched. `main.js` was NOT modified — its guard remains as a UX fast-fail/toast layer, while the authority now enforces the invariant itself (proven by direct authority-call tests).

Dependency note: no new helper module was needed — the existing ESM graph safely allows `formations.js` / `repairs.js` to import `getOperationalTask` from `tasking.js` (tasking.js depends only on config/theater/utils; no cycle at module-init time).

## 3. Offline task boundary algorithm (P0)

Online play alternates `tickEconomy(step)` / `tickOperationalTasks(step)` at small steps, so upkeep intervals interleave with resource growth. Offline's event scheduler didn't know the 30s task interval: with no other event it stepped the whole window at once, letting the economy grow to cap before all intervals charged in bulk (measured divergence up to 1190 supply).

Fix (`js/tasking.js` + `js/offline.js`): new read-only `operationalTaskBoundaryRemaining(state)` returns, over all active tasks, `min((intervalsCharged + 1) * costIntervalSec - stats.timeSec)` (positive values; `Infinity` with no active task). `settleOfflineProgress()` now includes `operationalTaskBoundary(state)` in `nextEvent`, so each offline step lands exactly on a task interval boundary and the economy/task order matches online. The 30s rule stays solely in the tasking authority; offline.js only consumes the boundary (no numbers copied). No fixed 0.05s stepping.

Verified equivalence over 3600s (both scenarios, online 0.05s stepping vs offline settle):
- resource-cap scenario (1 PATROL, supply 500): supply 4990.000 = 4990.000, charged 120/120, missed 0/0, results equal.
- low-resource scenario (6 PATROL formations, brownout fixture: power plant removed + radar/barracks consuming, supply 5, +30/interval growth vs 60/interval upkeep): final supply equal, per-formation charged/missed identical (charged 720 processed, 360 missed), boundary cursor exactly 6×120.

## 4. Operation result-code fix

`canDispatchOperation()` returned `OPERATION_CODE.FORMATION_TASKED` which was undefined. Added `FORMATION_TASKED: 'formation_tasked'` to `OPERATION_CODE` (`js/operations.js`); no other operation semantics changed. Targeted test asserts `ok === false` and `code === 'formation_tasked'` for a tasked SECURITY formation.

## 5. Stage 9 freeze boundary adjustment

`js/formations.js` moved from byte-freeze to the same semantic-shared (additive-only) contract as `theater.js` / `offline.js` in `tests/lib/stage9-frozen-authority.mjs`: all 23 Stage 9 baseline exports preserved (no removal/rename), Stage 9 formation semantics re-proven by regression (stage9-A 21/21, stage9-E fast 23/23 + B 10/10 + C 10/10 + D 17/17), additive behavior guarded by the Stage 10-A targeted tests. The freeze itself was not deleted; `repairs.js` was never in the freeze manifest. Guard result: 10 byte-frozen + 3 semantic-shared, 0 violations.

## 6. Changed files

- `js/repairs.js` — FORMATION_TASKED code + tasked-formation rejection in `canQueueRepair()`
- `js/formations.js` — FORMATION_TASKED code + `failIfTasked()` authority guard on canAddUnit/addUnit/removeUnit/disbandFormation
- `js/tasking.js` — new read-only `operationalTaskBoundaryRemaining(state)`
- `js/offline.js` — task boundary integrated into the offline event scheduler
- `js/operations.js` — `OPERATION_CODE.FORMATION_TASKED` defined
- `tests/stage10-A-operational-tasking-test.mjs` — +6 targeted checks
- `tests/browser/stage10-A-operational-tasking.mjs` — +2 smoke scenarios (blocked repair under RECON, repair allowed after recall), 4→6 frames
- `tests/lib/stage9-frozen-authority.mjs` — formations.js moved to semantic-shared
- `evidence/stage10-A/stage10-A-browser.json` — regenerated smoke evidence
- `HANDOFF-STAGE10-A1.md` — this file

No changes to state/save/battle/settlement/salvage/production/research semantics, `main.js`, UI code, or SAVE_VERSION (stays 10).

## 7. Targeted tests

`npm run test:stage10-A` — **27/27 passed** (21 existing + 6 new):
1. tasked formation member cannot enter repair (`formation_tasked`, canonical state unchanged)
2. recall re-enables repair (queue succeeds)
3. direct formation mutation rejected at authority level (`removeUnit`/`disbandFormation`/`canAddUnit`/`addUnit` all `formation_tasked`; rename still allowed)
4. repeated-operation dispatch returns `formation_tasked`, never undefined
5. offline task upkeep boundaries match online stepping (resource-cap scenario)
6. low-resource offline/online equivalence (missed intervals; brownout fixture)
7. `operationalTaskBoundaryRemaining` is a read-only cursor (bonus check for the boundary helper)

## 8. Browser smoke

`npm run browser:stage10-A` — **27/27 assertions, 0 page errors, 0 console errors**, saveVersion 10, 6 unique screenshots. New scenarios: while RECON is active the damaged member's repair tile has no primary action and surfaces the authority reason (tile aria + inspector, no repair job created); after recall the tile regains the `repair-unit` primary action and a plain click queues the repair (`status → repairing`).

## 9. Known limitations

- `missedIntervals` remains a separate counter; `intervalsCharged` is the processed-interval cursor (charged + missed) per the Stage 10-A contract — unchanged semantics, now explicitly asserted.
- The low-resource offline/online equivalence fixture uses a brownout state (no power plant + consuming buildings) to make missed intervals reachable, because base supply growth (+2/s vs ≤10/30s upkeep) otherwise always affords upkeep.
- `main.js`'s `guardFormationNotTasked()` stays as UX convenience (choice A); it is no longer the only safety boundary.
- Local browser runs use the launcher's `IRON_COMMAND_CHROMIUM_EXTRA_ARGS` hook (`--no-sandbox --disable-crashpad`) because Chrome 151 crashes under this session's file sandbox; the tested page semantics are unaffected.
