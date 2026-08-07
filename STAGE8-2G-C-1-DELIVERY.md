# Stage 8.2G-C.1 · Production Visual Consumption & Evidence Hardening

## Scope

C.1 closes the gap between the formal battlefield state and what the production
renderer consumes. The combat solver, authority anchors, result, reward and save
state remain frozen. The new path is:

`offline asset manifest → runtime asset loader → production Draw Spec → sprite / hybrid / procedural fallback renderer`

Environment placement now checks every route polyline segment. Destruction marks
retain deterministic radius, rotation, weapon profile and persistent lifecycle.
Weapon presentation fields (`muzzleShape`, `tracerWidth`, `impactScale`, `smoke`,
`persistentMark`) are carried into runtime draw data and are covered by mutation
tests.

## Strong evidence policy

The machine evidence is generated from canonical current-code scenarios. The
browser manifest is captured from the formal page and binds to the machine file
hash. The verifier recomputes expected state, environment signature, destruction
signature, Draw Specs, semantic predicates and PNG hashes. It rejects both sides
of synchronized tampering; the 8-case C.1 tamper suite must report `rejected: true`
for every case.

The supplied independent-audit JSON and tamper-proof text are external review
baseline/reference files only. They are not imported into production code and no
failed sample is filtered or deleted to improve statistics.

## Commands

```bash
npm run test:stage8-2G-C-1
npm run browser:stage8-2G-C-1
npm run build:stage8-2G-C-1
npm run verify:stage8-2G-C-1
```

The final package contains the C.1 evidence, 20 browser frames, C and B.1.1a
regression assets, sample SVG fixtures, source tests and the clean-package test
record. The external package record contains the final ZIP SHA-256 and byte size.
