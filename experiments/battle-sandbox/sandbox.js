import { DEBUG_DEFAULTS, SANDBOX_SEED } from './sandbox-config.js';
import { createSandboxState, updateSandboxState } from './sandbox-director.js';
import { renderSandbox } from './sandbox-renderer.js';
import { buildCaptureState } from './sandbox-capture-tools.js';

const canvas = document.querySelector('#battle-canvas');
const context = canvas.getContext('2d');
const playButton = document.querySelector('#toggle-play');
const restartButton = document.querySelector('#restart');
const hudButton = document.querySelector('#toggle-hud');
const stateNote = document.querySelector('#state-note');
let state = createSandboxState(SANDBOX_SEED);
let speed = 1;
let showHud = DEBUG_DEFAULTS.hud;
let lastFrame = performance.now();

function draw() { renderSandbox(context, state, { ...DEBUG_DEFAULTS, hud: showHud }); }
function updateControls() {
  playButton.textContent = state.ended ? '重新播放' : state.paused ? '继续' : '暂停';
  stateNote.textContent = state.ended ? '阶段8.2C演示结束' : state.paused ? '已暂停' : `播放中 · ${state.time.toFixed(1)}s`;
}
function reset() { state = createSandboxState(SANDBOX_SEED); lastFrame = performance.now(); updateControls(); draw(); }
function step(seconds) { updateSandboxState(state, seconds * speed); updateControls(); draw(); }
function frame(now) { const delta = Math.min(.05, Math.max(0, (now - lastFrame) / 1000)); lastFrame = now; step(delta); requestAnimationFrame(frame); }

playButton.addEventListener('click', () => { if (state.ended) reset(); else state.paused = !state.paused; updateControls(); draw(); });
restartButton.addEventListener('click', reset);
hudButton.addEventListener('click', () => { showHud = !showHud; hudButton.textContent = showHud ? '隐藏HUD' : '显示HUD'; draw(); });
document.querySelectorAll('.speed').forEach((button) => button.addEventListener('click', () => { speed = Number(button.dataset.speed); document.querySelectorAll('.speed').forEach((item) => item.classList.toggle('active', item === button)); }));
document.addEventListener('keydown', (event) => { if (event.key.toLowerCase() === 'r') reset(); if (event.key === ' ') { event.preventDefault(); playButton.click(); } if (event.key.toLowerCase() === 'f') document.documentElement.requestFullscreen?.(); });

window.advanceTime = (milliseconds) => { const frames = Math.max(1, Math.round(milliseconds / (1000 / 60))); for (let index = 0; index < frames; index += 1) updateSandboxState(state, (1 / 60) * speed); updateControls(); draw(); };
window.seekSandboxTime = (seconds) => { const requestedTime = Number(seconds); state = buildCaptureState(seconds); state.paused = true; lastFrame = performance.now(); updateControls(); draw(); return { ok: true, requestedTime: Number.isFinite(requestedTime) ? requestedTime : 0, actualTime: state.time, state: JSON.parse(window.render_game_to_text()) }; };
window.render_game_to_text = () => JSON.stringify({ coordinateSystem: 'world origin top-left; x right, y down', scene: 'stage8.2C', time: Number(state.time.toFixed(3)), speed, paused: state.paused, ended: state.ended, hud: showHud, objective: state.objective, wrecks: state.wrecks, scorchMarks: state.scorchMarks, units: state.units.map((unit) => ({ id: unit.id, side: unit.side, type: unit.type, x: Math.round(unit.x), y: Math.round(unit.y), anchor: { x: Math.round(unit.x), y: Math.round(unit.y) }, visualCenter: { x: Math.round(unit.visualCenter?.x ?? unit.x), y: Math.round(unit.visualCenter?.y ?? unit.y) }, memberPositions: unit.memberPositions?.length ? unit.memberPositions.map((position) => ({ x: Math.round(position.x), y: Math.round(position.y) })) : undefined, alpha: Number(unit.alpha.toFixed(2)), status: unit.status, coverGroup: unit.coverGroup, visualDamage: unit.visualDamage ? { ...unit.visualDamage } : null })), activePulseSources: [...new Set(state.effects.filter((effect) => effect.pulse).map((effect) => effect.source))], effects: state.effects.map((effect) => effect.kind) });

updateControls(); draw(); requestAnimationFrame(frame);
