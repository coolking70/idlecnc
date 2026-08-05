import { stableStringify } from './core/report-normalizer.js';

// This is deliberately synchronous so it can be used by the render loop in a browser.
// FNV-1a over a canonical JSON projection is sufficient for a session cache key and
// keeps the fingerprint independent of object insertion order.
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

function digest(text) {
  let hash = FNV_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

function actorSnapshot(row) {
  const source = row && typeof row === 'object' ? row : {};
  return {
    id: source.id ?? null,
    realId: source.realId ?? null,
    type: source.type ?? null,
    category: source.category ?? null,
    maxHp: source.maxHp ?? null,
    hp: source.hp ?? null,
    alive: source.alive ?? null
  };
}

function sideSnapshots(report, phase, side) {
  const rows = report?.[phase]?.[side];
  return (Array.isArray(rows) ? rows : [])
    .map(actorSnapshot)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function eventSummary(event, index) {
  const source = event && typeof event === 'object' ? event : {};
  return {
    index,
    t: source.t ?? null,
    type: source.type ?? null,
    actor: source.actor ?? source.actorId ?? null,
    target: source.target ?? source.targetId ?? null,
    value: source.value ?? source.amount ?? null,
    text: source.text ?? null
  };
}

export function buildReportFingerprint(report) {
  const source = report && typeof report === 'object' ? report : {};
  const projection = {
    id: source.id ?? null,
    seed: source.seed ?? null,
    theaterId: source.theaterId ?? null,
    strategyId: source.strategyId ?? null,
    missionKind: source.missionKind ?? null,
    missionId: source.missionId ?? null,
    result: source.result ?? null,
    duration: source.duration ?? null,
    initial: {
      friendly: sideSnapshots(source, 'initial', 'friendly'),
      enemy: sideSnapshots(source, 'initial', 'enemy')
    },
    final: {
      friendly: sideSnapshots(source, 'final', 'friendly'),
      enemy: sideSnapshots(source, 'final', 'enemy')
    },
    events: (Array.isArray(source.events) ? source.events : []).map(eventSummary)
  };
  return `fp1-${digest(stableStringify(projection))}`;
}

export function buildPresentationCacheKey(activeBattle) {
  const report = activeBattle?.report;
  return [
    activeBattle?.id || report?.id || 'none',
    report?.id || 'none',
    report?.seed ?? 'none',
    report?.result || 'none',
    buildReportFingerprint(report)
  ].join('::');
}

export function validateReportFingerprint(report, fingerprint) {
  return typeof fingerprint === 'string' && fingerprint === buildReportFingerprint(report);
}
