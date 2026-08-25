# Stage 10-P-B.1 - Research Grid & Primary Action Hotfix Handoff

## Delivery identity

- Base: `72b2b143b85ce97f53428228b815cfe1bf21397d` (Stage 10-P-B head, docs commit `b5e00f4` on top)
- Branch: `auto/stage10-p-b1-command-ui-hotfix`
- Scope: three targeted Command UI fixes only. No Stage 10-A, no gameplay change, no new evidence/tamper/historical-regression systems.
- `SAVE_VERSION` stays `10`, package version stays `0.9.0`, no gameplay authority file touched.

## Problem 1 - Research grid dropped all but the last tech per branch

`_updateResearch()` iterated `Object.keys(TECHNOLOGIES)` and called
`branchGrids[branch].update(...)` once per TECH with a single model. `CommandGrid.update(models)` replaces the grid's entire content, so each call wiped the branch's earlier tiles; 9 technologies rendered as 3.

Fix (`js/ui.js`): tech ids are grouped by `TECHNOLOGIES[techId].branch` first, then each branch grid is updated exactly once with its complete tile set. `TECHNOLOGIES` data is untouched; all 9 tiles render (3 per branch).

## Problem 2 - Primary actions swallowed by inspect-on-click

`inspectModel()` hardcoded `inspectOnClick: true`, and the CommandTile click handler checks `inspectOnClick` before `actionId`, so repair candidates (`repair-unit`) and available research (`research`) only opened the inspector on plain click.

Fix (`js/command-presentation.js`): `inspectModel()` gained an `inspectOnClick = true` parameter.

- Repair candidate: `inspectOnClick: !check.ok` - plain click/tap sends a repairable unit to repair; a blocked (disabled) tile keeps details.
- Research tile: `inspectOnClick: !checkOk` - plain click/tap starts an available research; locked/completed/researching/queued tiles stay details-only.
- Units, Formations, Reports, Overview, Repair active/queued keep `inspectOnClick: true`.
- Theater/Strategy primary-action behavior in `ui.js` is unchanged.

Details remain reachable everywhere through hover, long press, the ⓘ affordance (`data-command-detail`), and context menu, which all keep opening the inspector.

## Problem 3 - Formation status used a shrunk two-state copy

The presentation kept `FORMATION_STATUS_LABELS = { idle, deployed }` (`deployed` is not even a canonical formation status) and mapped only `deployed` to `active`, so rallying/marching/fighting/returning/repairing formations rendered as `available`.

Fix (`js/command-presentation.js`): reuse the canonical `FORMATION_STATUS`/`FORMATION_STATUS_LABEL` from `js/config.js` (no reduced copy), and map all non-idle statuses through a `FORMATION_BUSY_STATUSES` set:

- `idle` with units -> `available` (badge 待命)
- `rallying / marching / fighting / returning / repairing` -> `active` (badges 集结/行军/战斗/返回/维修, never `available`)
- empty formation -> `locked` (existing visual logic, badge 待命)

Formation authority itself is untouched.

## Tests (targeted only, no test-system growth)

`tests/stage10-P-B-command-migration-test.mjs` adds five cases: research builder returns all 9 technologies; branch grouping delivers the complete tile set per branch (and `ui.js` must not update branch grids per tech); repair candidate `actionId === 'repair-unit'` + `inspectOnClick === false` (blocked stays `true`); available research `actionId === 'research'` + `inspectOnClick === false` (other states stay `true`); every busy formation status renders `active`, never `available`, with six distinct canonical labels.

`tests/browser/stage10-P-B-command-migration.mjs` adds/adjusts three scenarios:

1. Research: exactly 9 `[data-command-id^="research:"]` tiles, 3 per branch; a plain click on an available tech actually starts the research (`research.current.techId` changes) and the inspector stays closed.
2. Repair: a plain click on a damaged candidate tile creates the repair job (`status` -> `repairing`, one job) without opening the inspector.
3. Long press on a tile with a real primary action (available research): inspector opens and the canonical research selection is unchanged - short tap acts, long press only inspects. The previous inspect-only unit-tile variant was replaced.

## Verification

- `npm run test:stage10-P-B` - 22/22 passed
- `npm run browser:stage10-P-B` - 50/50 assertions, 8 unique screenshots, 0 page errors, 0 console errors, saveVersion 10
- `npm run test:stage10-P-A` - 19/19 + canonical equivalence 4/4
- Stage 9 frozen authority vs `ca408bb7`: 63 targets checked, 0 violations (and `npm run test:stage9-E:fast` core evidence remains 23/23)

## Known limitations / not done (by scope)

No legacy-code cleanup, no navigation shell rework, no Command Rail, no production art, no PATROL/RECON/SECURITY/Threat/Doctrine/Auto-Dispatch, no gameplay changes, no new evidence or tamper systems, no full historical regression run. All reserved for later stages.
