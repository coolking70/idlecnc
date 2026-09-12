import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
assert.equal(/el\([^\n]*CURRENT_STAGE_LABEL/.test(ui), false, 'internal stage label must not be inserted into production DOM');
// Anchors proving the file still renders real player-facing text, so the leak
// check above is not passing against an empty or shuffled file. '战区作战' was a
// section heading in the pre-Stage-10-P-B overview builder; that builder became
// unreachable at the migration and has now been removed, so the anchor moves to
// the Command Overview that replaced it.
assert.match(ui, /战备就绪/); assert.match(ui, /基地待命/);
const file = path.join(root, 'stage8_2g_db1_production_leak_check.json');
if (fs.existsSync(file)) {
  const evidence = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(evidence.passed, true); assert.deepEqual(evidence.productionDomForbidden, []); assert.equal(evidence.internalIdentifiersVisible, false); assert.equal(evidence.debugOverlayPreserved, true);
}
console.log(JSON.stringify({ ok: true, stage: '8.2G-D-B.1', sourceLeakCheck: true, browserLeakChecked: fs.existsSync(file) }));

