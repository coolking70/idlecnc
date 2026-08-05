import { mapSourceToPresentation, mapPresentationToSource } from './core/semantic-time-mapper.js';

export function sourceBattleTime(activeBattle) {
  if (activeBattle?.presentationPhase === 'returning') return Number(activeBattle.elapsed || 0);
  return Math.max(0, Number(activeBattle?.elapsed || 0));
}

export function presentationTimeFor(activeBattle, presentation) {
  if (!presentation?.plan) return 0;
  if (activeBattle?.presentationPhase === 'returning') return presentation.plan.duration;
  return mapSourceToPresentation(presentation.plan.timeMap, sourceBattleTime(activeBattle));
}

export function sourceTimeForPresentation(presentation, seconds) {
  return mapPresentationToSource(presentation?.plan?.timeMap, Number(seconds || 0));
}

export function describePresentationTime(activeBattle, presentation) {
  const presentationTime = presentationTimeFor(activeBattle, presentation);
  return {
    sourceTime: sourceBattleTime(activeBattle),
    presentationTime,
    returning: activeBattle?.presentationPhase === 'returning',
    returnElapsed: Number(activeBattle?.returnElapsed || 0),
    returnDuration: Number(activeBattle?.returnDuration || 0)
  };
}
