# Stage 9-D — Deterministic Battle Salvage

## Scope

Stage 9-D adds a production-side post-settlement salvage loop. It does not add battle drops to `simulateBattle()`, the Formal Solver, or Formal Settlement. A salvage offer is derived only after a valid production session, applied settlement ledger, and bound Formal Report exist; the explicit claim seam then writes one equipment instance and one receipt under `state.equipment`.

The implementation is intentionally limited to the existing Stage 9-C equipment catalog. It adds no rarity, affixes, durability, crafting, new units, buildings, theaters, or battle rules.

## Deterministic contract

`js/battle-salvage.js` uses domain-separated `canonicalHash()` inputs containing `battleSessionId`, `settlementId`, `formalReportHash`, mission identity, result, difficulty, and salvage rules version. Separate purposes derive the roll, pool index, salvage ID, offer hash, and deterministic instance ID. Reload, history navigation, and replay therefore cannot reroll an offer. Replay is read-only and never claims.

Victory uses `min(0.50, 0.30 + (difficulty - 1) * 0.04)`; Pyrrhic uses `min(0.30, 0.15 + (difficulty - 1) * 0.03)`. Defeat, Withdraw, and Wiped are ineligible. Only `acquisition.kind === 'production'` definitions enter the pool.

## Persistence and migration

`SAVE_VERSION` is 10. `salvageClaims` is additive. A v9 save keeps its equipment, production queue, sessions, and settlement ledger, receives an empty claim map, and receives no historical salvage. The migration stamps reconstructed/legacy sessions with `salvageRulesVersion: 0`; only current v10 production state without that legacy marker can derive the new offer. Claims and salvage instances are sanitized after units, equipment, sessions, reports, and settlement ledgers are sanitized, so both claim→session/ledger/report and inventory→claim directions fail closed.

`provenance.kind` distinguishes `starter`, `production`, and `battle_salvage`. Salvage instance IDs are hash-derived and do not depend on inventory size.

## Authority and diff boundaries

Formal Settlement leaves equipment byte-for-byte unchanged. A successful claim changes only `equipment.inventory` and `equipment.salvageClaims`; failed claims are side-effect free. No Solver, Planner, Choreographer, `js/save-diff.js`, or `tests/lib` authority code was changed. Existing Stage 9-B/C battle lock, snapshot, historical replay, production, and migration behavior remains covered by targeted regression.

## Evidence

- Core salvage: 12/12 checks.
- Browser: 9 meaningful frames, 4 real `Page.reload()` events, 9 unique screenshot hashes, real DOM claim click, replay read-only, and no-drop stability.
- Strong verifier: recomputes session/ledger/report binding, salvage roll/pool/IDs/offer hash, inventory/receipt binding, screenshot hashes, reload monotonicity, and UI provenance from current source.
- Tamper: 126/126 rejected with `passedFlagOnlyCases=0`.
- Focused performance: qualified environment, 20 warmups, 120 samples, p95 under 16.7ms for eligible, Pyrrhic, and invalid-ledger derivation; evidence includes environment and loadBefore/loadAfter.

## Gate separation

`test:stage9-D:fast` covers Stage 9-D core plus Stage 9-B/C targeted regression. `test:stage9-D` adds strong evidence, tamper, and focused performance. `browser:stage9-D` adds fresh production browser evidence and self-check. The existing `gate:stage8-2G` Release Gate remains unchanged apart from its prior Stage 9-A/B/C contents; Stage 9-D does not trigger the historical Release Gate by default.

## Self-check answers

1. The final remote SHA is intentionally reported only after `git ls-remote` confirms it.
2. A full clean-clone Release Gate is not run for this Stage Gate because the Stage 9-D scope has no authority regression; the existing Release Gate remains available for milestone use.
3. No battle drop is implemented in Formal Battle or Settlement; salvage is post-settlement only.
4. Settlement does not modify equipment, and the frozen save-diff semantics do not include equipment.
5. Salvage uses only the existing legal production equipment definitions; hp/maxHp and Stage 9-B modifiers are unchanged.
6. Starter definitions and existing technology values are unchanged.
7. Multiple salvage instances are hash-namespaced by salvage identity and are tested for exactly-once receipt binding.
8. Pending salvage is not inventory and cannot be mounted; only the claimed instance can be mounted through normal equipment validation.
9. Browser evidence covers pending and claimed result reloads; the offer and instance ID remain stable.
10. Salvage has no offline auto-claim path; replay and offline state remain read-only with respect to claims.
11. Stage 9-B battle lock and historical replay are covered by the Fast Gate regression.
12. v9→v10 is additive and does not fabricate claims, equipment, or production records.
13. Frozen authority files are checked by the core evidence and final diff review.
14. Performance uses the existing environment qualification helper without changing its logic or 16.7ms budget.
15. `stage9_d_tamper_results.json` records 126/126 rejection and zero flag-only cases.
16. Fast/Stage workflows are separate; the existing Release workflow and `.cnb.yml` remain present.
17. The performance evidence records the qualified environment and load snapshots.
