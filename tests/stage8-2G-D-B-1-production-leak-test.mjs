import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
assert.equal(/el\([^\n]*CURRENT_STAGE_LABEL/.test(ui), false, 'internal stage label must not be inserted into production DOM');
assert.match(ui, /战备就绪/); assert.match(ui, /战区作战/);
const file = path.join(root, 'stage8_2g_db1_production_leak_check.json');
if (fs.existsSync(file)) {
  const evidence = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(evidence.passed, true); assert.deepEqual(evidence.productionDomForbidden, []); assert.equal(evidence.internalIdentifiersVisible, false); assert.equal(evidence.debugOverlayPreserved, true);
}
console.log(JSON.stringify({ ok: true, stage: '8.2G-D-B.1', sourceLeakCheck: true, browserLeakChecked: fs.existsSync(file) }));

