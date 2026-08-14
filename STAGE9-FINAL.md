# Stage 9 Final Milestone

Baseline: `5f7bbdd00fe5a2b3a029bcbbc8e550019f0034b6`  
Version: `0.9.0`  
Save Version: `10`  
Product Stage: `9`

## Stage 9-A — Expanded Theater Campaign

Six theaters and six operations remain the campaign boundary.

## Stage 9-B — Equipment Core

Equipment inventory, unit bindings, effective-stat resolution, deployment composition, battle locking, and historical replay are integrated without changing Formal Battle authority.

## Stage 9-C — Production Acquisition

Five production equipment definitions share the existing production queue, building and research gates, cancellation rules, persistence, and reload behavior. Starter equipment remains additive and unchanged.

## Stage 9-D — Deterministic Post-Settlement Salvage

Eligible Formal Battle settlements produce deterministic post-settlement salvage offers. Claiming is exactly once, equipment-only at the save-diff boundary, and never part of Formal Settlement authority.

## Stage 9-E — Integrated Product Loop

The complete product loop is:

`Theater → Production Equipment → Mount → Formal Battle → Immutable Settlement → Salvage Offer → Claim → Salvage Mount → Save/Reload → Historical Replay`

## Authority Freeze

Formal Battle and Formal Report are the only battle facts. HP, damage, repair, destruction, targeting, schedules, timing, outcomes, facing, position, legality, LOS, range, planner behavior, battle result, reward, and settlement calculation remain outside equipment and salvage acquisition paths. Solver, Planner, Choreographer, save-diff semantics, and authority verifiers remain frozen.

## Save Compatibility

Save version 10 is additive. Older saves do not gain equipment, production records, salvage offers, or claims by migration. Invalid references fail closed; production and salvage provenance remain deterministic and persist across reload.

## Excluded Scope

Stage 9 does not include equipment drops from Formal Settlement, equipment enhancement, rarity, affixes, levels, durability, repair, sale, dismantling, crafting, random events, new units, buildings, resources, theaters, operations, technologies, enemies, or any Stage 10 schema.

## Test Hierarchy

- Fast: targeted Stage 9 regression without browser capture.
- Stage: fresh Stage 9-E core/browser evidence, file-backed screenshot verification, tamper checks, and historical artifact integrity.
- Release: one formal D-C.1 performance measurement, full functional history, clean-clone functional replay, and immutable final-head identity closure.

## Stage 10 Boundary

NOT IMPLEMENTED.
