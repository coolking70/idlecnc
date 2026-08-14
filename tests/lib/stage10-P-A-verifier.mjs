import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const STAGE10_PA_REQUIRED_FRAMES = [
  '01-construction-command-grid.png',
  '02-construction-hover-tooltip.png',
  '03-construction-active-progress.png',
  '04-unit-production-command-grid.png',
  '05-unit-hover-tooltip.png',
  '06-unit-locked-state.png',
  '07-unit-resource-insufficient.png',
  '08-production-queue.png',
  '09-equipment-command-grid.png',
  '10-equipment-tooltip.png',
  '11-mobile-480-production.png',
  '12-mobile-390-production.png',
  '13-mobile-inspector.png'
];

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function fail(failures, field, expected, actual) {
  failures.push({ field, expected, actual });
}

function safeFile(root, relativePath) {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function hasAction(actions, predicate) {
  return actions.some((action) => action?.source === 'production_dom' && predicate(action));
}

export function verifyStage10PABrowser(candidate, { root }) {
  const failures = [];
  const frames = Array.isArray(candidate?.screenshots) ? candidate.screenshots : [];
  const actions = Array.isArray(candidate?.actionProvenance) ? candidate.actionProvenance : [];
  const frameByName = new Map(frames.map((frame) => [frame?.file, frame]));

  if (candidate?.stage !== '10-P-A') fail(failures, 'stage', '10-P-A', candidate?.stage);
  if (candidate?.frameCount !== STAGE10_PA_REQUIRED_FRAMES.length) fail(failures, 'frameCount', STAGE10_PA_REQUIRED_FRAMES.length, candidate?.frameCount);
  if (frames.length !== STAGE10_PA_REQUIRED_FRAMES.length) fail(failures, 'screenshots.length', STAGE10_PA_REQUIRED_FRAMES.length, frames.length);
  if (JSON.stringify(candidate?.requiredFrames) !== JSON.stringify(STAGE10_PA_REQUIRED_FRAMES)) fail(failures, 'requiredFrames', STAGE10_PA_REQUIRED_FRAMES, candidate?.requiredFrames);
  if (new Set(frames.map((frame) => frame?.file)).size !== frames.length) fail(failures, 'screenshots.fileUniqueness', frames.length, new Set(frames.map((frame) => frame?.file)).size);

  const actualHashes = [];
  STAGE10_PA_REQUIRED_FRAMES.forEach((file) => {
    const frame = frameByName.get(file);
    if (!frame) {
      fail(failures, `screenshots.${file}`, 'present', 'missing');
      return;
    }
    const expectedPath = `screenshots/stage10-P-A/${file}`;
    if (frame.path !== expectedPath) fail(failures, `${file}.path`, expectedPath, frame.path);
    const filePath = safeFile(root, frame.path);
    if (!filePath || path.extname(filePath).toLowerCase() !== '.png' || !fs.existsSync(filePath)) {
      fail(failures, `${file}.file`, 'safe existing PNG', frame.path);
      return;
    }
    const bytes = fs.readFileSync(filePath);
    const dimensions = pngDimensions(bytes);
    if (!dimensions) fail(failures, `${file}.signature`, 'real PNG signature and IHDR', 'invalid');
    if (bytes.length < 10_000) fail(failures, `${file}.bytes`, '>= 10000', bytes.length);
    const actualHash = sha256(bytes);
    actualHashes.push(actualHash);
    if (actualHash !== frame.sha256) fail(failures, `${file}.sha256`, actualHash, frame.sha256);
    if (bytes.length !== frame.bytes) fail(failures, `${file}.recordedBytes`, bytes.length, frame.bytes);
    if (dimensions && (dimensions.width !== frame.dimensions?.width || dimensions.height !== frame.dimensions?.height)) {
      fail(failures, `${file}.dimensions`, dimensions, frame.dimensions);
    }
    if (frame.dom?.tooltipHosts !== 1 || frame.dom?.inspectorHosts !== 1) fail(failures, `${file}.globalHosts`, { tooltipHosts: 1, inspectorHosts: 1 }, frame.dom);
    if (frame.dom?.permanentDescriptions !== 0) fail(failures, `${file}.permanentDescriptions`, 0, frame.dom?.permanentDescriptions);
  });

  const uniqueHashes = new Set(actualHashes).size;
  if (actualHashes.length !== STAGE10_PA_REQUIRED_FRAMES.length || uniqueHashes !== STAGE10_PA_REQUIRED_FRAMES.length) {
    fail(failures, 'actualScreenshotHashes', `${STAGE10_PA_REQUIRED_FRAMES.length} real unique hashes`, { actualCount: actualHashes.length, uniqueHashes });
  }
  if (candidate?.uniqueScreenshotCount !== uniqueHashes) fail(failures, 'uniqueScreenshotCount', uniqueHashes, candidate?.uniqueScreenshotCount);
  if (!Array.isArray(candidate?.pageErrors) || candidate.pageErrors.length !== 0) fail(failures, 'pageErrors', [], candidate?.pageErrors);
  if (!Array.isArray(candidate?.consoleErrors) || candidate.consoleErrors.length !== 0) fail(failures, 'consoleErrors', [], candidate?.consoleErrors);

  const expectFrame = (file, predicate, field, expected) => {
    const value = frameByName.get(file);
    if (!value || !predicate(value)) fail(failures, field, expected, value || null);
  };
  expectFrame('02-construction-hover-tooltip.png', (frame) => frame.tooltip === true && frame.dom?.tooltipVisible === true, 'coverage.constructionHover', true);
  expectFrame('05-unit-hover-tooltip.png', (frame) => frame.tooltip === true && frame.dom?.tooltipVisible === true, 'coverage.unitHover', true);
  expectFrame('10-equipment-tooltip.png', (frame) => frame.tooltip === true && frame.dom?.tooltipVisible === true, 'coverage.equipmentHover', true);
  expectFrame('11-mobile-480-production.png', (frame) => frame.mobile === true && frame.dimensions?.width === 480, 'coverage.mobile480', true);
  expectFrame('12-mobile-390-production.png', (frame) => frame.mobile === true && frame.dimensions?.width === 390, 'coverage.mobile390', true);
  expectFrame('13-mobile-inspector.png', (frame) => frame.mobile === true && frame.longPress === true && frame.dom?.inspectorVisible === true, 'coverage.mobileLongPressInspector', true);
  expectFrame('03-construction-active-progress.png', (frame) => frame.actionViaTile === true && frame.state?.construction?.type === 'supply_depot', 'coverage.constructionAction', true);
  expectFrame('08-production-queue.png', (frame) => frame.rapidClicks === 3 && frame.state?.production?.queue?.length === 2, 'coverage.rapidQueue', true);

  if (!hasAction(actions, (action) => action.kind === 'mouse_hover')) fail(failures, 'provenance.hover', 'production DOM mouse hover', actions);
  if (!hasAction(actions, (action) => action.kind === 'pointer_long_press')) fail(failures, 'provenance.longPress', 'production DOM pointer long press', actions);
  if (!hasAction(actions, (action) => action.kind === 'mouse_click' && String(action.selector).includes('construction:supply_depot'))) fail(failures, 'provenance.construction', 'construction tile click', actions);
  if (!hasAction(actions, (action) => ['mouse_click', 'touch_tap', 'keyboard_enter'].includes(action.kind) && String(action.selector).includes('unit:'))) fail(failures, 'provenance.unitProduction', 'unit tile command', actions);
  if (!hasAction(actions, (action) => action.kind === 'mouse_click' && String(action.selector).includes('equipment:'))) fail(failures, 'provenance.equipmentProduction', 'equipment tile click', actions);
  if (!hasAction(actions, (action) => action.kind === 'touch_cancel') || !hasAction(actions, (action) => action.kind === 'pointer_move_cancel')) fail(failures, 'provenance.longPressCancellation', 'pointercancel and movement coverage', actions);
  if (candidate?.syntheticGameplayActionUsed !== false) fail(failures, 'syntheticGameplayActionUsed', false, candidate?.syntheticGameplayActionUsed);
  if (candidate?.fixtureSeedingOnly !== true) fail(failures, 'fixtureSeedingOnly', true, candidate?.fixtureSeedingOnly);

  return {
    passed: failures.length === 0,
    failures,
    recomputed: {
      frameCount: actualHashes.length,
      uniqueScreenshotCount: uniqueHashes,
      desktopCoverage: STAGE10_PA_REQUIRED_FRAMES.slice(0, 10).every((file) => frameByName.get(file)?.dimensions?.width >= 1024),
      mobileCoverage: frameByName.get('11-mobile-480-production.png')?.dimensions?.width === 480 && frameByName.get('12-mobile-390-production.png')?.dimensions?.width === 390,
      hoverCoverage: ['02-construction-hover-tooltip.png', '05-unit-hover-tooltip.png', '10-equipment-tooltip.png'].every((file) => frameByName.get(file)?.dom?.tooltipVisible === true),
      longPressCoverage: frameByName.get('13-mobile-inspector.png')?.dom?.inspectorVisible === true
    }
  };
}
