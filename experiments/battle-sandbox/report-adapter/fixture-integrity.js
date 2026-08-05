import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { stableStringify } from './report-normalizer.js';
import { countReportEvents, MANIFEST_VERSION, scenarioMatchesReport } from './schema.js';

export const FORMAL_BOUNDARY_FILES = [
  'js/battle.js', 'js/battle-outcome.js', 'js/battle-targeting.js', 'js/config.js', 'js/utils.js', 'js/state.js', 'js/units.js', 'js/research.js', 'js/integrity.js',
  'experiments/battle-sandbox/report-adapter/fixture-scenarios.js'
];

export const VIEWER_SCREENSHOTS = Object.freeze({
  'campaign-victory': '01-victory-contract.png',
  'campaign-withdraw': '02-withdraw-contract.png',
  'campaign-defeat-or-wiped': '03-wiped-contract.png',
  'operation-result': '04-operation-contract.png'
});

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function hashJson(value) {
  return sha256(Buffer.from(stableStringify(value)));
}

export function hashFile(filePath) {
  return sha256(fs.readFileSync(filePath));
}

export function formalBoundaryEntries(projectRoot) {
  return FORMAL_BOUNDARY_FILES.slice().sort().map((relativePath) => {
    const absolutePath = path.join(projectRoot, relativePath);
    return { relativePath, fileHash: hashFile(absolutePath) };
  });
}

export function formalBoundaryHash(projectRoot) {
  const entries = formalBoundaryEntries(projectRoot);
  return sha256(Buffer.from(entries.map(({ relativePath, fileHash }) => `${relativePath}\0${fileHash}\n`).join('')));
}

export function buildFixtureManifest(fixtures, projectRoot) {
  return {
    manifestVersion: MANIFEST_VERSION,
    formalBoundaryHash: formalBoundaryHash(projectRoot),
    formalBoundaryFiles: FORMAL_BOUNDARY_FILES.slice().sort(),
    fixtures: fixtures.map(({ id, file, fixture, fileHash, contract }) => {
      const reportHash = hashJson(fixture.report);
      const screenshotFile = VIEWER_SCREENSHOTS[id];
      const screenshotPath = screenshotFile
        ? path.join(projectRoot, 'experiments/battle-sandbox/report-adapter/screenshots', screenshotFile)
        : null;
      return {
      id,
      file,
      scenarioHash: hashJson(fixture.scenario),
      reportHash,
      fileHash,
      seed: fixture.scenario.seed,
      result: fixture.report.result,
      counts: countReportEvents(fixture.report),
      validation: {
        ok: contract?.validation?.ok === true,
        errors: contract?.validation?.errors || []
      },
      supported: contract?.diagnostics?.supported === true,
      missingRequirements: contract?.diagnostics?.missingRequirements || [],
      viewerScreenshot: screenshotFile && fs.existsSync(screenshotPath)
        ? { file: screenshotFile, sha256: hashFile(screenshotPath), fixtureReportHash: reportHash }
        : null
      };
    })
  };
}

export function firstDifference(expected, actual, prefix = '') {
  if (expected === actual) return null;
  if (typeof expected !== typeof actual || expected === null || actual === null) return { path: prefix || '$', expected, actual };
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return { path: prefix || '$', expected, actual };
    for (let i = 0; i < expected.length; i += 1) {
      const difference = firstDifference(expected[i], actual[i], `${prefix}[${i}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (typeof expected === 'object') {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const key of keys) {
      const difference = firstDifference(expected[key], actual[key], prefix ? `${prefix}.${key}` : key);
      if (difference) return difference;
    }
    return null;
  }
  return { path: prefix || '$', expected, actual };
}

export function validateFixtureShape(fixture) {
  const errors = [];
  if (fixture?.fixtureVersion !== 1) errors.push('fixtureVersion must be 1');
  if (!scenarioMatchesReport(fixture)) errors.push('scenario metadata does not match report metadata');
  const report = fixture?.report || {};
  const expectedSuffix = report.missionKind === 'operation'
    ? `_${report.formationId}_operation_${report.missionId}_${report.strategyId}`
    : `_${report.formationId}_${report.theaterId}_${report.strategyId}`;
  if (!report.id || !String(report.id).includes(`_${report.seed}_`) || !String(report.id).endsWith(expectedSuffix)) errors.push('report id does not match formal metadata rule');
  return { ok: errors.length === 0, errors };
}
