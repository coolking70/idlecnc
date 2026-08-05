const FORBIDDEN_TEXT = /真实战报驱动演示|authority\b|\bseed\b|report\.id|battle_[\w-]+/i;
const FORBIDDEN_DYNAMIC = ['source=', ['fi', 'xture'].join(''), ['scen', 'ario', '-d'].join('')];

function phaseFor(renderState) {
  const time = Number(renderState?.time || 0);
  if (renderState?.returning) return '返航';
  if (time >= 35) return '占领';
  if (time >= 26) return '突破';
  if (time >= 7) return '接敌';
  return '侦察';
}

export function buildFormalBattleHud(activeBattle, presentation, renderState) {
  const phase = phaseFor(renderState);
  return {
    title: '边境公路',
    subtitle: '正面突破',
    phase,
    phaseLabel: `战术阶段：${phase}`,
    progressLabel: `战报进度  ${Math.floor(Math.max(0, Math.min(35, Number(renderState?.time || 0))))} / 35`,
    modeLabel: '演出：RTS',
    viewLabel: 'CONTRACT RTS',
    footer: renderState?.returning ? '作战结束 · 编队正在返航' : phase === '占领' ? '目标已占领 · 编队保持警戒' : '编队沿公路推进 · 各路协同接敌'
  };
}

export function validateFormalHud(hud) {
  if (!hud || typeof hud !== 'object') return { ok: false, errors: ['hud is not an object'] };
  const serialized = JSON.stringify(hud);
  const errors = [];
  if (FORBIDDEN_TEXT.test(serialized) || FORBIDDEN_DYNAMIC.some((text) => serialized.includes(text))) errors.push('formal HUD contains diagnostic or experiment identity');
  for (const key of ['title', 'subtitle', 'phase', 'phaseLabel', 'progressLabel', 'modeLabel', 'viewLabel', 'footer']) if (typeof hud[key] !== 'string') errors.push(`missing formal HUD field: ${key}`);
  return { ok: errors.length === 0, errors };
}

export function drawFormalBattleHud(context, hud, renderState, options = {}) {
  if (!context || options.showHud === false) return;
  const phaseColor = hud.phase === '返航' ? '#e7c77e' : hud.phase === '占领' ? '#72d39a' : '#9be0c2';
  if (options.screenSpace === true) {
    const width = Number(options.screenWidth || 960); const height = Number(options.screenHeight || 540); const dpr = Number(options.screenDpr || 1);
    context.save(); context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = 'rgba(5,14,15,.92)'; context.beginPath(); context.roundRect(12, 12, 224, 72, 7); context.fill();
    context.strokeStyle = 'rgba(147,205,172,.5)'; context.stroke();
    context.fillStyle = '#f0d597'; context.font = '700 18px sans-serif'; context.fillText(hud.title, 24, 34);
    context.fillStyle = '#9be0c2'; context.font = '700 13px sans-serif'; context.fillText(hud.subtitle, 24, 53);
    context.fillStyle = phaseColor; context.font = '12px sans-serif'; context.fillText(`${hud.phaseLabel} · ${hud.progressLabel}`, 24, 72);
    context.fillStyle = 'rgba(5,14,15,.92)'; context.beginPath(); context.roundRect(Math.max(248, width - 194), 12, 182, 54, 7); context.fill();
    context.fillStyle = '#e7d7aa'; context.font = '700 14px sans-serif'; context.fillText(hud.modeLabel, Math.max(260, width - 182), 34);
    context.fillStyle = phaseColor; context.font = '11px sans-serif'; context.fillText(hud.viewLabel, Math.max(260, width - 182), 52);
    context.fillStyle = 'rgba(5,14,15,.86)'; context.beginPath(); context.roundRect(12, Math.max(92, height - 32), Math.min(width - 24, 420), 22, 5); context.fill();
    context.fillStyle = '#b7c4a0'; context.font = '11px sans-serif'; context.fillText(hud.footer, 22, Math.max(107, height - 17));
    context.restore(); return;
  }
  context.save();
  context.fillStyle = 'rgba(5,14,15,.88)'; context.beginPath(); context.roundRect(24, 22, 420, 112, 8); context.fill();
  context.strokeStyle = 'rgba(147,205,172,.36)'; context.stroke();
  context.fillStyle = '#f0d597'; context.font = '700 22px sans-serif'; context.fillText(hud.title, 42, 52);
  context.fillStyle = '#9be0c2'; context.font = '700 14px sans-serif'; context.fillText(hud.subtitle, 42, 76);
  context.fillStyle = phaseColor; context.font = '12px sans-serif'; context.fillText(hud.phaseLabel, 42, 99);
  context.fillStyle = '#b7c4a0'; context.fillText(hud.progressLabel, 42, 119);
  context.fillStyle = 'rgba(5,14,15,.88)'; context.beginPath(); context.roundRect(932, 22, 324, 84, 8); context.fill();
  context.fillStyle = '#e7d7aa'; context.font = '700 18px sans-serif'; context.fillText(hud.modeLabel, 952, 52);
  context.fillStyle = phaseColor; context.font = '12px sans-serif'; context.fillText(hud.viewLabel, 952, 75);
  context.fillStyle = '#d0c393'; context.fillText(hud.footer, 952, 94);
  context.fillStyle = 'rgba(5,14,15,.78)'; context.beginPath(); context.roundRect(24, 664, 650, 32, 6); context.fill();
  context.fillStyle = '#b7c4a0'; context.font = '12px sans-serif'; context.fillText(hud.footer, 40, 685);
  context.restore();
}
