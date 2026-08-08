import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
assert.match(css, /#app:has\(#stage\.is-battle-active\)\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/, 'battle-first narrow CSS missing');
assert.match(css, /#app:has\(#stage\.is-battle-active\) #panel\s*\{\s*display:\s*none;/, 'narrow battle panel must be hidden');
const file = path.join(root, 'stage8_2g_db1_responsive_geometry.json');
if (fs.existsSync(file)) {
  const evidence = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(evidence.passed, true); assert.equal(evidence.productionBattleFirstLayout, true);
  assert.ok((evidence.viewport || []).some((item) => item.label === '480x720')); assert.ok((evidence.viewport || []).some((item) => item.label === '390x844'));
  assert.ok((evidence.viewport || []).every((item) => item.battlefieldWidthRatio >= .8 && item.panelHidden === true));
}
console.log(JSON.stringify({ ok: true, stage: '8.2G-D-B.1', staticBattleFirstCss: true, browserGeometryChecked: fs.existsSync(file) }));

