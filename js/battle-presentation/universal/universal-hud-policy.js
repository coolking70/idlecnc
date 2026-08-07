const TERRAIN_LABELS = { open: '废弃矿区', road: '公路', fortified: '防御阵地' };
const RESULT_LABELS = { victory: '目标完成', pyrrhic: '代价取胜', withdraw: '有序撤离', defeat: '战线失守', wiped: '部队覆灭' };

function phaseFor(state) {
  if (state?.returning) return '返航';
  const time = Number(state?.time || 0); const duration = Math.max(1, Number(state?.duration || 30));
  if (time >= duration * 0.8) return '结局';
  if (time >= duration * 0.32) return '接敌';
  if (time >= duration * 0.13) return '展开';
  return '侦察';
}

export function buildUniversalBattleHud(activeBattle, presentation, renderState) {
  const plan = presentation?.plan || {};
  const terrain = TERRAIN_LABELS[plan.scene?.terrain?.id] || '战术地域';
  const result = RESULT_LABELS[plan.source?.result] || '战斗进行中';
  const phase = phaseFor({ ...renderState, duration: plan.timeline?.duration });
  const duration = Math.max(1, Number(plan.timeline?.duration) || 30);
  return {
    title: terrain,
    subtitle: result,
    phase,
    phaseLabel: `战术阶段：${phase}`,
    progressLabel: `战斗进度  ${Math.floor(Math.max(0, Math.min(duration, Number(renderState?.time || 0))))} / ${Math.floor(duration)}`,
    modeLabel: '演出：通用RTS',
    viewLabel: `UNIVERSAL RTS · ${renderState?.camera?.label || '全局态势'}`,
    cameraLabel: renderState?.camera?.label || '全局态势',
    footer: renderState?.returning ? '作战结束 · 编队正在返航' : `${plan.scene?.objective?.label || '目标区域'} · ${result}`
  };
}

export function validateUniversalHud(hud) {
  if (!hud || typeof hud !== 'object') return { ok: false, errors: ['hud is not an object'] };
  const errors = [];
  for (const key of ['title', 'subtitle', 'phase', 'phaseLabel', 'progressLabel', 'modeLabel', 'viewLabel', 'cameraLabel', 'footer']) if (typeof hud[key] !== 'string') errors.push(`missing universal HUD field: ${key}`);
  if (/report|seed|authority/i.test(JSON.stringify(hud))) errors.push('universal HUD contains diagnostic identity');
  return { ok: errors.length === 0, errors };
}

export function drawUniversalBattleHud(context, hud, renderState, options = {}) {
  if (!context || options.showHud === false) return;
  const width = Number(options.screenWidth || 960); const height = Number(options.screenHeight || 540); const dpr = Number(options.screenDpr || 1);
  const compact = width < 680; const stacked = width < 500; const leftWidth = stacked ? width - 24 : compact ? Math.min(232, width - 24) : 330; const rightWidth = stacked ? width - 24 : compact ? 150 : 252; const rightX = stacked ? 12 : Math.max(12, width - rightWidth - 12); const rightY = stacked ? 56 : 8;
  context.save(); context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = 'rgba(5,14,15,.78)'; context.beginPath(); context.roundRect(12, 8, leftWidth, 42, 6); context.fill(); context.strokeStyle = 'rgba(147,205,172,.42)'; context.stroke();
  context.fillStyle = '#f0d597'; context.font = '700 14px sans-serif'; context.fillText(`${hud.title} · ${hud.subtitle}`, 22, 26);
  context.fillStyle = '#bfe6c9'; context.font = '11px sans-serif'; context.fillText(`${hud.phaseLabel} · ${hud.progressLabel}`, 22, 43);
  context.fillStyle = 'rgba(5,14,15,.78)'; context.beginPath(); context.roundRect(rightX, rightY, rightWidth, 42, 6); context.fill();
  context.fillStyle = '#e7d7aa'; context.font = '700 12px sans-serif'; context.fillText(hud.modeLabel, rightX + 10, rightY + 18);
  context.fillStyle = '#bfe6c9'; context.font = '10px sans-serif'; context.fillText(hud.viewLabel, rightX + 10, rightY + 34);
  context.fillStyle = 'rgba(5,14,15,.68)'; context.beginPath(); context.roundRect(12, Math.max(58, height - 28), Math.min(width - 24, compact ? 300 : 430), 20, 5); context.fill();
  context.fillStyle = '#b7c4a0'; context.font = '10px sans-serif'; context.fillText(hud.footer, 21, Math.max(71, height - 14)); context.restore();
}
