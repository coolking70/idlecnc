import { ContractBattleRenderer } from './contract-battle-renderer.js';
import { clearContractPlanCache, getContractPlanCacheDiagnostics, getOrBuildContractPresentation } from './contract-plan-cache.js';
import { buildPresentationCacheKey, buildReportFingerprint } from './report-fingerprint.js';
import { createPresentationDiagnostics } from './presentation-diagnostics.js';
import {
  clearAllRuntimeFallbacks,
  getRuntimeFallbackDiagnostics,
  isBattleContractDisabled,
  markBattleContractDisabled
} from './runtime-fallback-registry.js';

const STORAGE_KEY = 'iron-command.presentation-mode';
const PERMANENT_FALLBACK_CODES = new Set(['render_error', 'invalid_runtime_state', 'unknown_template_slot', 'layout_runtime_error', 'contract_renderer_unavailable']);

function readPreference() {
  try { return ['auto', 'legacy', 'contract'].includes(sessionStorage.getItem(STORAGE_KEY)) ? sessionStorage.getItem(STORAGE_KEY) : 'auto'; } catch { return 'auto'; }
}

function writePreference(value) { try { sessionStorage.setItem(STORAGE_KEY, value); } catch { /* session-only preference is best effort */ } }

export function createBattlePresentationRouter({ canvas, legacyRenderer, onStateChange } = {}) {
  const diagnostics = createPresentationDiagnostics();
  diagnostics.setPreference(readPreference());
  const contractRenderer = new ContractBattleRenderer(canvas);
  let lastBattleId = null;
  let lastBattleKey = null;
  let lastBattleRef = null;
  let renderedMode = 'legacy';
  let presentation = null;
  let frameId = 0;

  function preference() { return diagnostics.state.preference; }
  function shouldTryContract(activeBattle) { return preference() !== 'legacy' && Boolean(activeBattle?.report); }
  function publish() { onStateChange?.(getState()); }
  function battleKey(activeBattle) { return buildPresentationCacheKey(activeBattle); }
  function fallback(code, reason, key, activeBattle) {
    diagnostics.markFallback(code, reason, activeBattle?.id || activeBattle?.report?.id || null);
    if (PERMANENT_FALLBACK_CODES.has(code)) markBattleContractDisabled(key, code, reason);
  }

  function render(activeBattle, dtReal = 0) {
    frameId += 1;
    if (!activeBattle) {
      presentation = null; renderedMode = 'legacy'; lastBattleId = null; lastBattleKey = null; lastBattleRef = null;
      contractRenderer.reset(); publish(); return false;
    }
    const key = battleKey(activeBattle);
    const replacedBattle = lastBattleRef !== null && lastBattleRef !== activeBattle;
    const changedBattle = key !== lastBattleKey;
    if (replacedBattle || changedBattle) clearContractPlanCache();
    lastBattleRef = activeBattle; lastBattleKey = key; lastBattleId = activeBattle.id || activeBattle.report?.id || null;

    if (shouldTryContract(activeBattle) && !isBattleContractDisabled(key)) {
      diagnostics.markAttempt(lastBattleId);
      const candidate = getOrBuildContractPresentation(activeBattle);
      if (candidate.ok) {
        try {
          contractRenderer.setPresentation(candidate);
          const rendered = contractRenderer.render(activeBattle, dtReal);
          if (rendered === true) {
            presentation = candidate; renderedMode = 'contract_road_victory'; diagnostics.markSuccess(); publish(); return true;
          }
          fallback('contract_renderer_unavailable', 'contract renderer returned false', key, activeBattle);
        } catch (error) {
          fallback('render_error', error instanceof Error ? error.message : String(error), key, activeBattle);
        }
      } else fallback(candidate.code, candidate.reason, key, activeBattle);
    }

    renderedMode = 'legacy'; presentation = null; contractRenderer.reset();
    legacyRenderer?.render(activeBattle, dtReal);
    publish();
    return true;
  }

  function setPreference(value) { diagnostics.setPreference(value); writePreference(diagnostics.state.preference); }
  function getState() {
    return {
      preference: preference(),
      battleKey: lastBattleKey,
      reportFingerprint: lastBattleRef ? buildReportFingerprint(lastBattleRef.report) : null,
      frameId,
      ...diagnostics.snapshot(),
      mode: renderedMode,
      renderedMode,
      cache: getContractPlanCacheDiagnostics(),
      runtimeFallbacks: getRuntimeFallbackDiagnostics(),
      presentation: presentation ? { ok: presentation.ok, mode: presentation.mode, reportId: presentation.reportId, reportFingerprint: presentation.reportFingerprint, plan: presentation.plan } : null
    };
  }
  function getPresentation() { return presentation; }
  function getRenderState() { return contractRenderer.lastState || null; }
  function reset() { presentation = null; renderedMode = 'legacy'; lastBattleId = null; lastBattleKey = null; lastBattleRef = null; clearContractPlanCache(); clearAllRuntimeFallbacks(); contractRenderer.reset(); publish(); }
  function destroy() { contractRenderer.destroy(); reset(); }
  function getTextState(options) { return renderedMode === 'contract_road_victory' ? contractRenderer.getTextState(options) : null; }
  function setCameraMode(mode) { contractRenderer.setCameraMode(mode); legacyRenderer?.setCameraMode?.(mode); }
  function setAutoCamera(enabled) { contractRenderer.setAutoCamera(enabled); legacyRenderer?.setAutoCamera?.(enabled); }

  return { render, reset, destroy, setPreference, getPreference: preference, getState, getPresentation, getRenderState, getTextState, setCameraMode, setAutoCamera };
}
