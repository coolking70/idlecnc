export const STRATEGY_PROFILES = Object.freeze({
  cautious: { id: 'cautious', name: '谨慎推进', scoutBias: 1.3, spacing: 1.18, advance: 0.78, reserve: 0.22 },
  cautious_advance: { id: 'cautious_advance', name: '谨慎推进', scoutBias: 1.3, spacing: 1.18, advance: 0.78, reserve: 0.22 },
  breakthrough: { id: 'breakthrough', name: '正面突破', scoutBias: 0.92, spacing: 0.9, advance: 1.18, reserve: 0.08 },
  armored_breakthrough: { id: 'armored_breakthrough', name: '装甲突破', scoutBias: 0.92, spacing: 0.9, advance: 1.18, reserve: 0.08 },
  recon_by_fire: { id: 'recon_by_fire', name: '火力侦察', scoutBias: 1.2, spacing: 1.05, advance: 0.92, reserve: 0.15 }
});

export function resolveStrategyProfile(id) { return STRATEGY_PROFILES[id] || { id: id || 'generic', name: '通用战术', scoutBias: 1, spacing: 1, advance: 1, reserve: 0.15, generic: true }; }

