import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateBattle } from '../../../js/battle.js';
import { createInitialState } from '../../../js/state.js';
import { OPERATIONS, THEATERS, UNITS } from '../../../js/config.js';
import { buildUniversalPlan } from '../../../js/battle-presentation/universal/universal-plan-builder.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const scenarioDir = path.join(here, 'scenarios');
const theatres = Object.keys(THEATERS);
const missionIds = [...theatres, ...Object.keys(OPERATIONS)];
const strategies = ['cautious', 'breakthrough', 'recon_by_fire'];
const unitTypes = ['infantry', 'at_infantry', 'scout_car', 'mbt', 'repair_vehicle'];
const curatedPatterns = [
  ['infantry'], ['infantry', 'infantry'], ['infantry', 'infantry', 'infantry'], ['infantry', 'at_infantry'], ['scout_car'], ['mbt'], ['repair_vehicle'], ['mbt', 'repair_vehicle'], ['mbt', 'mbt'], ['infantry', 'scout_car', 'mbt'], ['infantry', 'at_infantry', 'scout_car', 'mbt'], ['infantry', 'at_infantry', 'scout_car', 'mbt', 'repair_vehicle'], ['infantry', 'infantry', 'infantry', 'infantry', 'infantry'], ['infantry', 'infantry', 'infantry', 'infantry', 'infantry', 'infantry'], ['infantry', 'infantry', 'infantry', 'infantry', 'infantry', 'infantry', 'infantry', 'infantry'], ['mbt', 'mbt', 'mbt'], ['mbt', 'mbt', 'mbt', 'mbt'], ['mbt', 'mbt', 'mbt', 'mbt', 'repair_vehicle'], ['infantry', 'at_infantry', 'at_infantry'], ['scout_car', 'scout_car', 'infantry'], ['repair_vehicle', 'repair_vehicle', 'infantry'], ['infantry', 'repair_vehicle'], ['at_infantry', 'at_infantry', 'repair_vehicle'], ['scout_car', 'mbt', 'repair_vehicle'], ['infantry', 'infantry', 'at_infantry', 'scout_car'], ['infantry', 'at_infantry', 'mbt', 'repair_vehicle'], ['infantry', 'infantry', 'scout_car', 'mbt'], ['infantry', 'infantry', 'at_infantry', 'mbt', 'repair_vehicle'], ['mbt', 'mbt', 'repair_vehicle', 'repair_vehicle'], ['infantry', 'at_infantry', 'scout_car', 'mbt', 'mbt', 'repair_vehicle'], ['infantry', 'infantry', 'infantry', 'scout_car', 'repair_vehicle'], ['at_infantry', 'at_infantry', 'scout_car', 'mbt'], ['scout_car', 'scout_car', 'mbt', 'repair_vehicle'], ['infantry', 'infantry', 'infantry', 'at_infantry', 'mbt'], ['infantry', 'infantry', 'scout_car', 'repair_vehicle', 'repair_vehicle'], ['infantry', 'at_infantry', 'at_infantry', 'mbt', 'mbt'], ['mbt', 'mbt', 'mbt', 'repair_vehicle', 'repair_vehicle'], ['infantry', 'infantry', 'infantry', 'infantry', 'scout_car', 'mbt'], ['infantry', 'at_infantry', 'scout_car', 'scout_car', 'mbt'], ['infantry', 'infantry', 'at_infantry', 'at_infantry', 'repair_vehicle'], ['infantry', 'scout_car', 'scout_car', 'mbt', 'repair_vehicle']
];

function commandCost(types) { return types.reduce((sum, type) => sum + (UNITS[type]?.command || 1), 0); }
function legalTypes(index, count = 1) {
  let state = (index * 1103515245 + 12345) >>> 0;
  const raw = Array.from({ length: count }, () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return unitTypes[state % unitTypes.length]; });
  if (!raw.some((type) => (UNITS[type]?.stats.attack || 0) > 0)) raw[0] = 'infantry';
  while (commandCost(raw) > 6) { const heavy = raw.findIndex((type) => UNITS[type]?.command > 1); if (heavy < 0) break; raw[heavy] = 'infantry'; }
  return raw;
}

export function inputFor(index, missionId, strategyId, types, options = {}) {
  const operation = OPERATIONS[missionId]; const theaterId = operation?.theaterId || missionId; const missionKind = operation ? 'operation' : 'campaign'; const formationId = `corpus-${options.kind || 'case'}-${index}`; const state = createInitialState(); const unitIds = types.map((_, unitIndex) => `corpus-u-${options.kind || 'case'}-${index}-${unitIndex + 1}`);
  state.units.push(...types.map((type, unitIndex) => { const definition = UNITS[type]; const ratio = Number.isFinite(Number(options.initialRatios?.[unitIndex])) ? Number(options.initialRatios[unitIndex]) : 1; return { id: unitIds[unitIndex], type, hp: Math.max(0, Math.round(definition.stats.hp * ratio)), maxHp: definition.stats.hp, damage: 'intact', status: 'assigned', formationId, callsign: null, experience: Math.max(0, Number(options.experiences?.[unitIndex]) || 0), battles: 0, createdAt: 1 }; }));
  return { state, formation: { id: formationId, name: `Corpus ${index}`, status: 'idle', unitIds }, theaterId, strategyId, missionKind, missionId, missionConfig: operation || null, seed: options.seed ?? index + 1 };
}

function stablePlanHash(plan) { return plan?.planFingerprint || null; }
function scenarioFrom(index, kind, missionId, strategyId, types, options = {}) {
  const report = simulateBattle(inputFor(index, missionId, strategyId, types, { ...options, kind }));
  const plan = options.skipPlan ? null : buildUniversalPlan(report);
  return {
    id: `${kind}-${String(index).padStart(5, '0')}`, index, reportId: report.id, theaterId: report.theaterId, terrain: report.terrain,
    missionKind: report.missionKind, missionId: report.missionId, strategyId: report.strategyId, result: report.result,
    actorCount: report.initial.friendly.length + report.initial.enemy.length,
    friendlyCount: report.initial.friendly.length, enemyCount: report.initial.enemy.length, unitTypes: types,
    initialDamage: types.some((_, unitIndex) => Number(options.initialRatios?.[unitIndex] ?? 1) < 1),
    experienced: types.some((_, unitIndex) => Number(options.experiences?.[unitIndex] || 0) > 0),
    eventTypes: report.events.map((event) => event.type), seed: options.seed ?? index + 1, initialRatios: options.initialRatios || types.map(() => 1), experiences: options.experiences || types.map(() => 0),
    friendlyLoss: report.final.friendly.some((actor) => actor.alive === false),
    enemyArmor: report.initial.enemy.some((actor) => actor.type === 'enemy_light_armor' || actor.category === 'armor'),
    planHash: stablePlanHash(plan), report
  };
}

function candidatePool() {
  const pool = []; let index = 1;
  for (let pass = 0; pass < 10; pass += 1) for (const missionId of missionIds) for (const strategyId of strategies) for (let patternIndex = 0; patternIndex < curatedPatterns.length; patternIndex += 1) {
    const types = curatedPatterns[(patternIndex + pass * 7) % curatedPatterns.length]; const ratios = types.map((_, unitIndex) => pass % 4 === 0 ? 1 : (35 + ((pass * 17 + unitIndex * 19 + patternIndex) % 66)) / 100); const experiences = types.map((_, unitIndex) => pass % 3 === 0 ? 0 : (pass * 13 + unitIndex * 11 + patternIndex) % 81); pool.push(scenarioFrom(index, 'candidate', missionId, strategyId, types, { seed: (pass * 97 + patternIndex * 13 + missionIds.indexOf(missionId) * 5) % 900 + 1, initialRatios: ratios, experiences, skipPlan: true })); index += 1;
  }
  return pool;
}

function coverageRows(rows) {
  const values = (key) => [...new Set(rows.map((row) => row[key]))].sort(); const countBy = (key) => Object.fromEntries(values(key).map((value) => [value, rows.filter((row) => row[key] === value).length])); const bool = (predicate) => ({ true: rows.filter(predicate).length, false: rows.filter((row) => !predicate(row)).length });
  return { total: rows.length, byTerrain: countBy('terrain'), byMissionKind: countBy('missionKind'), byMissionId: countBy('missionId'), byStrategy: countBy('strategyId'), byResult: countBy('result'), byArchetype: countBy('archetype'), byFriendlyActorCount: countBy('friendlyCount'), byEnemyActorCount: countBy('enemyCount'), friendTypesSequences: values('typesKey'), ambushed: bool((row) => row.contact?.ambushed), enemyRevealed: bool((row) => row.contact?.enemyRevealed), revealHighThreat: bool((row) => row.contact?.revealHighThreat), repairEvents: { present: rows.filter((row) => row.eventTypes.includes('repair')).length, absent: rows.filter((row) => !row.eventTypes.includes('repair')).length }, friendlyLoss: { present: rows.filter((row) => row.friendlyDestroyedCount > 0).length, absent: rows.filter((row) => row.friendlyDestroyedCount === 0).length }, enemyArmor: { present: rows.filter((row) => row.enemyArmor).length, absent: rows.filter((row) => !row.enemyArmor).length }, initialDamage: { present: rows.filter((row) => row.initialDamage).length, absent: rows.filter((row) => !row.initialDamage).length }, experiencedUnits: { present: rows.filter((row) => row.experienced).length, absent: rows.filter((row) => !row.experienced).length }, planFailures: [], continuousLayoutFailures: [], semanticFailures: [] };
}

const RESULT_IDS = ['victory', 'pyrrhic', 'withdraw', 'defeat', 'wiped'];

function buildMissionResultMatrix(rows) {
  const missionIds = [...new Set(rows.map((row) => row.missionId))].sort();
  const cells = missionIds.flatMap((missionId) => RESULT_IDS.map((result) => {
    const matches = rows.filter((row) => row.missionId === missionId && row.result === result);
    return {
      missionId, result, total: matches.length,
      canonical: matches.filter((row) => row.id.startsWith('canonical-')).length,
      fuzz: matches.filter((row) => row.id.startsWith('fuzz-')).length,
      sampleReportIds: matches.slice(0, 3).map((row) => row.reportId)
    };
  }));
  const unobservedCells = cells.filter((cell) => cell.total === 0).map(({ missionId, result }) => ({ missionId, result }));
  return { version: 1, missionIds, results: RESULT_IDS, totalCells: cells.length, coveredCells: cells.length - unobservedCells.length, unobservedCells, cells };
}

function enrich(row, plan) { const contact = plan.intent.contact; row.archetype = plan.forces.profile.archetype; row.typesKey = row.unitTypes.join(','); row.contact = contact; row.eventTypes = row.report.events.map((event) => event.type); row.friendlyDestroyedCount = plan.outcome.finalState.friendlyDestroyedIds.length; row.enemyArmor = plan.forces.enemy.some((actor) => actor.tags.includes('armor')); row.planHash = plan.planFingerprint; return row; }

function selectCanonical(pool) {
  const selected = []; const used = new Set(); const protectedEvidence = new Set(); const quotas = { victory: 10, pyrrhic: 10, withdraw: 10, defeat: 10, wiped: 10 };
  const dimensions = [
    ['terrain', new Set()], ['missionId', new Set()], ['strategyId', new Set()], ['friendlyCount', new Set()],
    ['enemyCount', new Set()], ['result', new Set()], ['repair', new Set()], ['initialDamage', new Set()],
    ['experienced', new Set()], ['enemyArmor', new Set()], ['ambush', new Set()], ['enemyRevealed', new Set()],
    ['revealHighThreat', new Set()], ['friendlyLoss', new Set()]
  ];
  const mark = (row) => {
    for (const [key, values] of dimensions) values.add(key === 'repair' ? row.eventTypes.includes('repair') : key === 'ambush' ? row.eventTypes.includes('ambush') : key === 'enemyRevealed' ? row.report.events.some((event) => event.type === 'reveal' && Number(event.value || 0) > 0) : key === 'revealHighThreat' ? Boolean(row.report.scout?.revealHighThreat) : row[key]);
    if (quotas[row.result] > 0) quotas[row.result] -= 1;
  };
  const take = (predicate, protect = false) => { const row = pool.find((candidate) => !used.has(candidate.reportId) && predicate(candidate)); if (!row) return false; used.add(row.reportId); selected.push(row); if (protect) protectedEvidence.add(row.reportId); mark(row); return true; };
  const evidenceRequirements = [
    ['convoy victory', (row) => row.missionId === 'convoy_escort' && row.result === 'victory'],
    ['convoy withdraw', (row) => row.missionId === 'convoy_escort' && row.result === 'withdraw'],
    ['convoy wiped', (row) => row.missionId === 'convoy_escort' && row.result === 'wiped']
  ];
  for (const [label, predicate] of evidenceRequirements) if (!take(predicate, true)) throw new Error(`canonical evidence selection failed: ${label}`);
  for (const result of Object.keys(quotas)) while (quotas[result] > 0) if (!take((row) => row.result === result)) throw new Error(`missing result candidate: ${result}`);
  for (const [key] of dimensions) {
    const values = [...new Set(pool.map((row) => key === 'repair' ? row.eventTypes.includes('repair') : key === 'ambush' ? row.eventTypes.includes('ambush') : key === 'enemyRevealed' ? row.report.events.some((event) => event.type === 'reveal' && Number(event.value || 0) > 0) : key === 'revealHighThreat' ? Boolean(row.report.scout?.revealHighThreat) : row[key]))];
    for (const value of values) take((row) => { const current = key === 'repair' ? row.eventTypes.includes('repair') : key === 'ambush' ? row.eventTypes.includes('ambush') : key === 'enemyRevealed' ? row.report.events.some((event) => event.type === 'reveal' && Number(event.value || 0) > 0) : key === 'revealHighThreat' ? Boolean(row.report.scout?.revealHighThreat) : row[key]; return current === value; });
  }
  const score = (row) => {
    let value = quotas[row.result] > 0 ? 5000 : 0;
    for (const [key, values] of dimensions) { const current = key === 'repair' ? row.eventTypes.includes('repair') : key === 'ambush' ? row.eventTypes.includes('ambush') : key === 'enemyRevealed' ? row.report.events.some((event) => event.type === 'reveal' && Number(event.value || 0) > 0) : key === 'revealHighThreat' ? Boolean(row.report.scout?.revealHighThreat) : row[key]; if (!values.has(current)) value += 1000; }
    return value - row.index / 100000;
  };
  while (selected.length < 120) {
    const candidates = pool.filter((row) => !used.has(row.reportId)); if (!candidates.length) break;
    candidates.sort((a, b) => score(b) - score(a)); const row = candidates[0]; used.add(row.reportId); selected.push(row); mark(row);
  }
  if (selected.length < 120 || Object.values(quotas).some((value) => value > 0)) throw new Error(`canonical selection failed count=${selected.length} quotas=${JSON.stringify(quotas)}`);
  // Keep every doctrine represented at a meaningful canonical volume even
  // after the result/semantic axes have been satisfied.
  for (const strategyId of strategies) {
    while (selected.filter((row) => row.strategyId === strategyId).length < 10) {
      const replacement = pool.find((row) => !used.has(row.reportId) && row.strategyId === strategyId);
      const donorIndex = selected.findIndex((row) => !protectedEvidence.has(row.reportId) && selected.filter((item) => item.result === row.result).length > 10 && row.strategyId !== strategyId);
      if (!replacement || donorIndex < 0) break;
      used.delete(selected[donorIndex].reportId); selected[donorIndex] = replacement; used.add(replacement.reportId);
    }
  }
  return selected.map((row, index) => ({ ...row, id: `canonical-${String(index + 1).padStart(4, '0')}` }));
}

function buildFuzz() {
  return Array.from({ length: 1000 }, (_, offset) => {
    const index = offset + 1; const count = 1 + (offset % 8);
    let types = legalTypes(offset * 19 + 17, count);
    let ratios = types.map((_, unitIndex) => (35 + ((offset * 17 + unitIndex * 23) % 66)) / 100);
    if (offset % 50 === 0) { types = ['mbt', 'repair_vehicle']; ratios = [0.42, 1]; }
    if (offset % 17 === 0) ratios = types.map(() => 1);
    const experiences = types.map((_, unitIndex) => (offset * 13 + unitIndex * 7) % 81);
    const missionId = missionIds[(offset * 5 + 1) % missionIds.length]; const strategyId = strategies[(offset * 7 + 2) % strategies.length];
    return scenarioFrom(index, 'fuzz', missionId, strategyId, types, { seed: index + 1000, initialRatios: ratios, experiences });
  });
}

export function buildCorpus() {
  const pool = candidatePool(); const canonicalRaw = selectCanonical(pool); const fuzz = buildFuzz(); const canonical = canonicalRaw.map((row) => enrich(row, buildUniversalPlan(row.report))); const fuzzEnriched = fuzz.map((row) => enrich(row, buildUniversalPlan(row.report))); const all = [...canonical, ...fuzzEnriched]; const planFailures = all.filter((row) => !buildUniversalPlan(row.report).ok).map((row) => ({ id: row.id, reportId: row.reportId })); const fuzzSpecs = fuzzEnriched.map((row) => ({ id: row.id, index: row.index, reportId: row.reportId, seed: row.seed, theaterId: row.theaterId, missionKind: row.missionKind, missionId: row.missionId, strategyId: row.strategyId, unitTypes: row.unitTypes, initialRatios: row.initialRatios, experiences: row.experiences, expectedPlanFingerprint: row.planHash })); const coverage = { version: '8.2F-A.2', canonicalCount: canonical.length, fuzzCount: fuzzEnriched.length, canonical: coverageRows(canonical), fuzz: coverageRows(fuzzEnriched), total: coverageRows(all), missionResultMatrix: buildMissionResultMatrix(all), planFailures, continuousLayoutFailures: [], semanticFailures: [] }; return { version: '8.2F-A.2', canonical, fuzz: fuzzEnriched, fuzzSpecs, coverage };
}

export function writeCorpus(corpus) { fs.mkdirSync(scenarioDir, { recursive: true }); fs.writeFileSync(path.join(scenarioDir, 'canonical.json'), `${JSON.stringify(corpus.canonical)}\n`); fs.writeFileSync(path.join(scenarioDir, 'fuzz.json'), `${JSON.stringify(corpus.fuzz)}\n`); fs.writeFileSync(path.join(scenarioDir, 'fuzz-specs.json'), `${JSON.stringify(corpus.fuzzSpecs)}\n`); fs.writeFileSync(path.join(scenarioDir, 'coverage.json'), `${JSON.stringify(corpus.coverage, null, 2)}\n`); fs.writeFileSync(path.join(scenarioDir, 'manifest.json'), `${JSON.stringify({ version: corpus.version, canonicalCount: corpus.canonical.length, fuzzCount: corpus.fuzz.length, fuzzSpecs: 'fuzz-specs.json', reportIds: corpus.canonical.concat(corpus.fuzz).map((row) => row.reportId) }, null, 2)}\n`); }

if (process.argv.includes('--write')) { const corpus = buildCorpus(); writeCorpus(corpus); console.log(JSON.stringify(corpus.coverage, null, 2)); }
