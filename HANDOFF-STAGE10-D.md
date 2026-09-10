# Stage 10-D — Auto Operations Handoff

- Parent: `auto/stage10-c-command-doctrine` @ `01710cd777af9ba39ebe005ffb93f5b7490bb854`
- Implementation SHA: `2829a76688ca9ee7cb48d186de37b163fdfb1cc6`
- Branch: `auto/stage10-d-auto-operations`
- Save schema: `SAVE_VERSION = 10`

## State shape

```js
state.autoOperations = { enabled: false }
formation.autoTaskHold = true // only after a manual Recall; absent/false otherwise
formation.tasking.autoAssigned = true | false
```

Old saves without `autoOperations` load disabled. `enabled`, `autoTaskHold`, and `autoAssigned` persist through normal save/load.

## Planner rules

- Disabled is fail-closed and produces no automatic behavior.
- Only idle, non-empty, non-repairing, non-battle formations with no active Operational Task and no manual hold are considered.
- Every assignment calls `assignOperationalTask()`; the planner never dispatches a formal Battle/Operation and never recalls, disbands, edits, repairs, produces, or changes Doctrine.
- Doctrine priorities: RECON → RECON, CONTROL → PATROL, SECURITY → SECURITY.
- BALANCED selects the largest unlocked-theater pressure need. Stable ties are RECON → SECURITY → PATROL, then canonical theater order/ID.
- Targets: RECON uses lowest recon, PATROL uses lowest control, SECURITY uses `max(100-security, threat)`.
- Formation order is stable by `createdAt`, then ID. No random or wall-clock input is used.
- Online runs at each formal tick boundary; offline runs at settlement start and after every existing event step.

## Manual hold

Player/manual `recallOperationalTask()` sets `formation.autoTaskHold = true`. Auto-origin recall can explicitly pass `{ manual: false }` and does not set hold. Held formations are ignored until “恢复自动调度” calls the release authority; if Auto Operations is enabled, the formation is immediately reconsidered.

## Changed files

- Core/state: `js/auto-operations.js`, `js/tasking.js`, `js/state.js`, `js/save.js`
- Runtime parity: `js/main.js`, `js/offline.js`
- UI/presentation: `js/ui.js`, `js/command-presentation.js`, `css/style.css`
- Tests/scripts: `tests/stage10-D-auto-operations-test.mjs`, `tests/browser/stage10-D-auto-operations.mjs`, `package.json`
- Process: `progress.md`, this handoff

The Stage 10-C P3 fixes remove the duplicated `.command-doctrine-grid` CSS and show Doctrine-adjusted actual upkeep in the Formation Task Inspector.

## Verification

- `npm run test:stage10-D` — 21/21
- `npm run browser:stage10-D` — 15/15; 3 unique screenshots inspected; 0 page errors; 0 console errors
- `npm run test:stage10-A` — 27/27 + A.1a 5/5
- `npm run test:stage10-B` — 16/16
- `npm run test:stage10-C` — 15/15
- `npm run test:stage10-P-B` — 22/22
- `node tests/lib/stage9-frozen-authority.mjs` — exit 0

## Known limitations

- The planner only fills idle formations. It does not recall or rebalance active tasks.
- Doctrine changes affect only later assignments; current tasks stay in place.
- Multiple idle formations may select the same highest-need theater because pressure does not change until simulation advances.
- Manual hold has no timer and remains until the player explicitly releases it.
- No Stage 10-E behavior is included.
