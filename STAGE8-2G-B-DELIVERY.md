# Iron Command Stage 8.2G-B

Deterministic Engagement Choreographer — Suppression, Target Switching and Retreat Vertical Slice.

## Scope

This stage adds a precomputed, serializable engagement schedule on top of the 8.2G-A.1.1 visual core. It derives target assignments, target switches, presentation-only bursts, suppression windows, cover advance/retreat relations, retreat orders and camera interests from the validated universal plan, authority anchors, actor roles, routes, weapon profiles, result and seed.

No solver, HP, damage, repair, result, rewards, save, settlement or authoritative event order is changed.

## Main modules

- `js/battle-presentation/universal/universal-engagement-choreographer.js`
- `js/battle-presentation/universal/universal-camera-director.js`
- `js/battle-presentation/universal/universal-render-state.js`
- `js/battle-presentation/universal/universal-visual-scene.js`
- `js/battle-presentation/universal/visual-state-machine.js`
- `js/battle-presentation/universal/universal-debug-overlay.js`

The production Renderer remains a consumer only; target scoring and camera interest logic are not embedded in Canvas draw functions.

## Verification

```bash
npm install
npm run test:stage8-2G-B
node tests/generate-stage8-2G-B-machine-evidence.mjs
npm run browser:stage8-2G-B
npm test
npm run build:stage8-2G-B
npm run verify:stage8-2G-B
```

The clean-package verifier must report zero failed, zero skipped, zero residual processes, non-empty projectile anchors, stable repeated anchor coordinates and unchanged authority hashes.
