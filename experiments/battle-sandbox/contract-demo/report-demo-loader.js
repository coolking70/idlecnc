import { buildPresentationContract } from '../report-adapter/presentation-contract.js';

const SOURCES = Object.freeze({
  fixture: '../report-adapter/fixtures/campaign-victory.json',
  'scenario-b': './scenarios/scenario-b.json',
  'scenario-c': './scenarios/scenario-c.json'
  , 'scenario-d': './scenarios/scenario-d.json'
  , 'scenario-e': './scenarios/scenario-e.json'
  , 'scenario-f': './scenarios/scenario-f.json'
});

export function sourceIdFromSearch(search = '') { const value = new URLSearchParams(search).get('source') || 'fixture'; return SOURCES[value] ? value : 'fixture'; }
export function sourcePath(sourceId = 'fixture') { return SOURCES[sourceId] || SOURCES.fixture; }

export async function loadVictoryDemoSource(sourceId = 'fixture') {
  const selected = sourceIdFromSearch(`?source=${sourceId}`);
  const response = await fetch(sourcePath(selected), { cache: 'no-store' });
  if (!response.ok) throw new Error(`${selected} report HTTP ${response.status}`);
  const payload = await response.json();
  const report = payload.report;
  const contract = buildPresentationContract(report);
  return { sourceId: selected, report, contract, scenario: payload.scenario || null, sourceKind: payload.sourceKind || 'formal_fixture', rebuildHash: payload.rebuildHash || null, derivedFromReportId: payload.derivedFromReportId || null, transformation: payload.transformation || null };
}

export { SOURCES };
