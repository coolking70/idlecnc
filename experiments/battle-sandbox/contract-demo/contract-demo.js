import { buildPresentationContract } from '../report-adapter/presentation-contract.js';
import { buildVictoryPresentationPlan, validateContractDrivenPlan } from './contract-plan-builder.js';
import { buildContractCaptureState, buildContractTextState, clampDemoTime } from './contract-capture-tools.js';
import { renderContractDemo } from './contract-renderer.js';
import { loadVictoryDemoSource, sourceIdFromSearch } from './report-demo-loader.js';

const canvas = document.querySelector('#contract-canvas');
const context = canvas.getContext('2d');
const errorPanel = document.querySelector('#contract-error');
const playButton = document.querySelector('#toggle-play');
const restartButton = document.querySelector('#restart');
const hudButton = document.querySelector('#toggle-hud');
const debugButton = document.querySelector('#toggle-debug');
const note = document.querySelector('#state-note');
let runtimeFixture = null; let runtimeContract = null; let runtimeSourceId = 'fixture'; let plan = null; let state = null; let paused = false; let speed = 1; let showHud = true; let debug = false; let viewMode = 'overview'; let lastFrame = 0;

export async function loadVictoryFixture() {
  const response = await fetch('../report-adapter/fixtures/campaign-victory.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`campaign-victory Fixture HTTP ${response.status}`);
  return response.json();
}

function setError(message) { errorPanel.hidden = false; errorPanel.textContent = message; canvas.setAttribute('aria-label', '契约演示不可用'); for (const button of [playButton, restartButton, hudButton, debugButton]) button.disabled = true; }
function updateControls() { playButton.textContent = paused ? '播放' : '暂停'; playButton.classList.toggle('primary', !paused); hudButton.textContent = showHud ? '隐藏HUD' : '显示HUD'; debugButton.textContent = debug ? '关闭权威调试' : '开启权威调试'; note.textContent = state ? `${state.time.toFixed(2)}s · ${paused ? '已暂停' : `${speed}×播放`}` : '场景初始化'; }
function draw() { if (!state || !plan) return; renderContractDemo(context, plan, state, { showHud, debug, viewMode }); updateControls(); }
function rebuildAt(time) { state = buildContractCaptureState(plan, runtimeContract, time); }
function textState() { return buildContractTextState(plan, runtimeContract, state, showHud, debug, viewMode); }

window.seekContractDemoTime = (seconds) => { if (!plan) return { ok: false, error: 'contract demo not ready' }; const requestedTime = Number(seconds); rebuildAt(clampDemoTime(seconds)); paused = true; lastFrame = 0; draw(); return { ok: true, requestedTime: Number.isFinite(requestedTime) ? requestedTime : 0, actualTime: state.time, state: textState() }; };
window.setContractDemoViewMode = (mode) => { viewMode = mode === 'final_status_focus' ? 'final_status_focus' : 'overview'; draw(); return { ok: true, viewMode }; };
window.render_contract_demo_to_text = () => plan && state ? textState() : { scene: 'contract-driven-road-assault', errors: ['contract demo not ready'] };
window.render_game_to_text = () => JSON.stringify(window.render_contract_demo_to_text());

playButton.addEventListener('click', () => { if (!state) return; if (state.time >= 35) rebuildAt(0); paused = !paused; lastFrame = 0; draw(); });
restartButton.addEventListener('click', () => { rebuildAt(0); paused = false; lastFrame = 0; draw(); });
hudButton.addEventListener('click', () => { showHud = !showHud; draw(); });
debugButton.addEventListener('click', () => { debug = !debug; draw(); });
document.querySelectorAll('[data-speed]').forEach((button) => button.addEventListener('click', () => { speed = Number(button.dataset.speed); document.querySelectorAll('[data-speed]').forEach((item) => item.classList.toggle('active', item === button)); updateControls(); }));
document.addEventListener('keydown', (event) => { if (event.code === 'Space') { event.preventDefault(); playButton.click(); } if (event.key.toLowerCase() === 'r') restartButton.click(); });

function frame(timestamp) { if (!lastFrame) lastFrame = timestamp; const dt = Math.min(.1, Math.max(0, (timestamp - lastFrame) / 1000)); lastFrame = timestamp; if (!paused && state && state.time < 35) { rebuildAt(Math.min(35, state.time + dt * speed)); if (state.time >= 35) paused = true; draw(); } requestAnimationFrame(frame); }

async function start() {
  try {
    runtimeSourceId = sourceIdFromSearch(window.location.search);
    const fixture = runtimeSourceId === 'fixture' ? await loadVictoryFixture() : await loadVictoryDemoSource(runtimeSourceId);
    const contract = buildPresentationContract(fixture.report);
    runtimeFixture = fixture;
    runtimeContract = contract;
    if (contract.validation.ok !== true || contract.diagnostics.supported !== true || contract.presentation.templateId !== null || contract.normalizedBattle.battle.result !== 'victory') throw new Error(`真实胜利契约启动检查失败\nvalidation.ok=${contract.validation.ok}\nsupported=${contract.diagnostics.supported}\ntemplateId=${contract.presentation.templateId}\nresult=${contract.normalizedBattle.battle.result}`);
    plan = buildVictoryPresentationPlan(contract, { sourceId: runtimeSourceId, sourceKind: fixture.sourceKind || 'formal_fixture', rebuildHash: fixture.rebuildHash || null }); const planValidation = validateContractDrivenPlan(plan, contract); if (!planValidation.ok) throw new Error(`真实演出计划验证失败\n${planValidation.errors.join('\n')}`);
    if (plan.ok !== true) throw new Error(`胜利模板参数化失败\n${plan.validation?.errors?.join('\n') || plan.reason || 'unknown error'}`);
    document.title = `真实战报驱动演示 · ${plan.sourceId}`;
    document.querySelector('.masthead-note').innerHTML = `真实 ${plan.sourceId} 报告 · ${plan.counts.anchors} authority anchors<br />无正式战斗页面接入 · 无资源结算写入`;
    state = buildContractCaptureState(plan, contract, 0); draw(); requestAnimationFrame(frame);
  } catch (error) { setError(`真实战报驱动演示未启动\n${error.message}`); note.textContent = '启动失败：未降级为固定演出'; }
}

start();
