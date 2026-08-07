export const MISSION_PROFILES = Object.freeze({
  campaign_assault: { id: 'campaign_assault', name: '战区突击', objectiveKind: 'capture', objectiveLabel: '夺取战区', convoy: false },
  salvage_run: { id: 'salvage_run', name: '废料回收', objectiveKind: 'salvage', objectiveLabel: '回收物资', convoy: false },
  convoy_escort: { id: 'convoy_escort', name: '补给护送', objectiveKind: 'escort', objectiveLabel: '护送车队', convoy: true },
  outpost_sweep: { id: 'outpost_sweep', name: '残敌清剿', objectiveKind: 'sweep', objectiveLabel: '清剿残敌', convoy: false },
  generic_operation: { id: 'generic_operation', name: '战术行动', objectiveKind: 'secure', objectiveLabel: '完成任务', convoy: false }
});

export function resolveMissionProfile(battle = {}) {
  if (battle.missionKind === 'campaign') return MISSION_PROFILES.campaign_assault;
  return MISSION_PROFILES[battle.missionId] || MISSION_PROFILES.generic_operation;
}

