function score(row) {
  const tags = new Set(row.tags || []);
  return [tags.has('repair') ? 0 : 1, tags.has('scout') ? 0 : 1, tags.has('armor') ? 0 : 1, tags.has('anti_armor') ? 0 : 1, row.type || '', row.actorId || ''];
}

function compare(a, b) {
  const aa = score(a); const bb = score(b);
  for (let i = 0; i < aa.length; i++) { if (aa[i] < bb[i]) return -1; if (aa[i] > bb[i]) return 1; }
  return 0;
}

export function allocateUniversalRoles(forces, intent) {
  const assignments = [];
  const roleGroups = { friendly: Object.fromEntries(['vanguard', 'line', 'flank', 'antiArmor', 'overwatch', 'armor', 'scouts', 'support', 'reserve'].map((key) => [key, []])), enemy: Object.fromEntries(['screen', 'line', 'strongpoint', 'antiArmor', 'mobile', 'reserve'].map((key) => [key, []])) };
  for (const side of ['friendly', 'enemy']) {
    const rows = (forces[side] || []).slice().sort(compare);
    rows.forEach((row, index) => {
      const tacticalRole = intent.doctrine?.tacticalRoles?.[row.actorId]?.role;
      const role = side === 'friendly'
        ? (tacticalRole === 'overwatch' ? 'overwatch'
          : tacticalRole === 'support' ? 'support'
            : tacticalRole === 'scout' ? 'scouts'
              : tacticalRole === 'vanguard' ? 'vanguard'
                : tacticalRole === 'armor_screen' ? 'armor'
                  : tacticalRole === 'infantry_screen' ? 'line'
                    : (row.primary === 'repair' ? 'support' : row.primary === 'scout' ? 'scouts' : row.primary === 'armor' && intent.strategy.id === 'breakthrough' ? 'vanguard' : row.primary === 'armor' ? 'armor' : row.primary === 'anti_armor' ? 'antiArmor' : assignmentRole(index, intent)))
        : (row.primary === 'scout' ? 'screen' : row.primary === 'armor' || row.primary === 'anti_armor' ? (row.primary === 'anti_armor' ? 'antiArmor' : 'strongpoint') : index === 0 ? 'line' : 'reserve');
      const group = `${side}_${role}`;
      assignments.push({ actorId: row.actorId, side, primaryRole: role, groupId: group, order: index, reserve: intent.doctrine.reserve > 0.2 && index >= Math.ceil(rows.length * (1 - intent.doctrine.reserve)) });
      roleGroups[side][role].push(row.actorId);
    });
  }
  assignments.roleGroups = roleGroups;
  return assignments;
}

function assignmentRole(index, intent) { if (intent.strategy.id === 'recon_by_fire') return index % 2 ? 'flank' : 'line'; if (intent.strategy.id === 'cautious') return index >= 2 ? 'reserve' : 'line'; return index === 0 ? 'vanguard' : 'line'; }
