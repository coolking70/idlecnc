export const UNIVERSAL_COVERAGE_MATRIX_VERSION = '8.2F-B.3';

export const UNIVERSAL_COVERAGE_RESULTS = Object.freeze(['victory', 'pyrrhic', 'withdraw', 'defeat', 'wiped']);
export const UNIVERSAL_COVERAGE_MISSIONS = Object.freeze(['border_road', 'convoy_escort', 'enemy_outpost', 'outpost_sweep', 'salvage_run', 'scrap_mine']);

const cell = (missionId, result, mode = 'universal_default') => Object.freeze({ missionId, result, mode });

// This is a production policy snapshot, not a runtime import of the sandbox
// coverage JSON. It records the 26 observed formal mission/result cells and
// keeps the four unobserved cells explicit so auto mode cannot overclaim them.
const COVERED_CELLS = [
  ...UNIVERSAL_COVERAGE_RESULTS.map((result) => cell('border_road', result, result === 'victory' ? 'contract_precedence' : 'universal_default')),
  ...UNIVERSAL_COVERAGE_RESULTS.map((result) => cell('convoy_escort', result)),
  cell('enemy_outpost', 'withdraw'), cell('enemy_outpost', 'defeat'), cell('enemy_outpost', 'wiped'),
  cell('outpost_sweep', 'pyrrhic'), cell('outpost_sweep', 'withdraw'), cell('outpost_sweep', 'defeat'), cell('outpost_sweep', 'wiped'),
  cell('salvage_run', 'victory'), cell('salvage_run', 'pyrrhic'), cell('salvage_run', 'withdraw'), cell('salvage_run', 'wiped'),
  ...UNIVERSAL_COVERAGE_RESULTS.map((result) => cell('scrap_mine', result))
];

const UNCOVERED_CELLS = [
  cell('enemy_outpost', 'victory', 'unobserved'), cell('enemy_outpost', 'pyrrhic', 'unobserved'),
  cell('outpost_sweep', 'victory', 'unobserved'), cell('salvage_run', 'defeat', 'unobserved')
];

const keyOf = (missionId, result) => `${String(missionId || '')}:${String(result || '')}`;
const coveredByKey = new Map(COVERED_CELLS.map((entry) => [keyOf(entry.missionId, entry.result), entry]));
const uncoveredByKey = new Map(UNCOVERED_CELLS.map((entry) => [keyOf(entry.missionId, entry.result), entry]));

export const UNIVERSAL_COVERED_CELLS = Object.freeze(COVERED_CELLS.slice());
export const UNIVERSAL_UNCOVERED_CELLS = Object.freeze(UNCOVERED_CELLS.slice());

export function getUniversalCoverageCell(source) {
  const report = source?.report || source;
  const missionId = report?.missionId || report?.theaterId || null;
  const result = report?.result || null;
  const key = keyOf(missionId, result);
  return coveredByKey.get(key) || uncoveredByKey.get(key) || Object.freeze({ missionId, result, mode: 'unknown' });
}

export function getUniversalCoverageDecision(source) {
  const report = source?.report || source;
  if (!report) return Object.freeze({ eligible: false, code: 'missing_active_report', cell: getUniversalCoverageCell(null) });
  const resolved = getUniversalCoverageCell(report); const key = keyOf(resolved.missionId, resolved.result);
  if (coveredByKey.has(key)) return Object.freeze({ eligible: true, code: 'covered_formal_cell', cell: resolved, matrixVersion: UNIVERSAL_COVERAGE_MATRIX_VERSION });
  if (uncoveredByKey.has(key)) return Object.freeze({ eligible: false, code: 'unobserved_formal_cell', cell: resolved, matrixVersion: UNIVERSAL_COVERAGE_MATRIX_VERSION });
  return Object.freeze({ eligible: false, code: 'unknown_formal_cell', cell: resolved, matrixVersion: UNIVERSAL_COVERAGE_MATRIX_VERSION });
}

export function isUniversalDefaultEligible(source) { return getUniversalCoverageDecision(source).eligible; }

export function isContractTemplatePrecedence(source) {
  const report = source?.report || source;
  return report?.theaterId === 'border_road' && report?.result === 'victory';
}

export function getUniversalCoverageSummary() {
  return Object.freeze({ version: UNIVERSAL_COVERAGE_MATRIX_VERSION, missionIds: UNIVERSAL_COVERAGE_MISSIONS, results: UNIVERSAL_COVERAGE_RESULTS, totalCells: UNIVERSAL_COVERAGE_MISSIONS.length * UNIVERSAL_COVERAGE_RESULTS.length, coveredCells: COVERED_CELLS.length, unobservedCells: UNCOVERED_CELLS.map(({ missionId, result }) => ({ missionId, result })) });
}
