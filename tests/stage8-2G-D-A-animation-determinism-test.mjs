import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { artRequiredActors } from './lib/stage8-2G-DA-art-scenarios.mjs';
import { OFFLINE_ASSET_MANIFEST } from '../js/battle-presentation/environment/asset-provider.js';
import { buildActorDrawSpec } from '../js/battle-presentation/environment/production-visual-draw-spec.js';
import { directionIndexFromRadians, resolveActorAnimationState } from '../js/battle-presentation/environment/animation-resolver.js';

const root = process.cwd();
const snapshot = (actor, seconds) => { const spec = buildActorDrawSpec(actor, { zoom: .86 }, { manifest: OFFLINE_ASSET_MANIFEST, presentationSeconds: seconds, seed: 82 }); return { animation: spec.animation, directionIndex: spec.animationState.directionIndex, frameIndex: spec.animationState.frameIndex, sourceRect: spec.sourceRect, turretSourceRect: spec.turretSourceRect, muzzleAnchor: spec.muzzleAnchor }; };
const rows = [];
for (const actor of artRequiredActors()) {
  const times = [0, .14, .48, 1.24, 2.8, 6.1];
  const direct = times.map((seconds) => snapshot(actor, seconds));
  const linear = []; for (const seconds of times) linear.push(snapshot(actor, seconds));
  assert.deepEqual(linear, direct, `${actor.id} linear/direct replay`);
  assert.deepEqual(times.slice().reverse().map((seconds) => snapshot(actor, seconds)).reverse(), direct, `${actor.id} rewind/replay`);
  const replay = times.map((seconds) => snapshot(actor, seconds)); assert.deepEqual(replay, direct, `${actor.id} deterministic replay`);
  rows.push({ actorId: actor.id, samples: direct, eightDirections: Array.from({ length: 8 }, (_, index) => directionIndexFromRadians(index * Math.PI / 4)) });
}
const staticSource = fs.readFileSync(path.join(root, 'js/battle-presentation/environment/animation-resolver.js'), 'utf8');
assert.equal(/Date\.now|performance\.now/.test(staticSource), false, 'production animation clock must be deterministic');
const idle = resolveActorAnimationState({ id: 'idle-seed', type: 'infantry', facing: 0 }, 'idle', 1.25, { entry: OFFLINE_ASSET_MANIFEST.assets.find((asset) => asset.id === 'unit_friendly_infantry'), seed: 82 });
assert.equal(idle.deterministicClock, 'presentation-seconds-plus-actor-seed');
fs.writeFileSync(path.join(root, 'stage8_2g_da_animation_determinism.json'), `${JSON.stringify({ stage: '8.2G-D-A', actors: rows.length, rows, noWallClock: true, seekReplay: true, passed: true }, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: '8.2G-D-A', actors: rows.length, samples: rows.reduce((sum, row) => sum + row.samples.length, 0), noWallClock: true, seekReplay: true }));
