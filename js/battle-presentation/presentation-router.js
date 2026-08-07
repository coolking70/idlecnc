import { ContractBattleRenderer } from './contract-battle-renderer.js';
import { clearContractPlanCache, getContractPlanCacheDiagnostics, getOrBuildContractPresentation } from './contract-plan-cache.js';
import { UniversalBattleRenderer } from './universal/universal-battle-renderer.js';
import { clearUniversalPlanCache, getOrBuildUniversalPresentation, getUniversalPlanCacheDiagnostics } from './universal/universal-plan-cache.js';
import { getUniversalCoverageDecision, isContractTemplatePrecedence } from './universal/universal-coverage-matrix.js';
import { buildPresentationCacheKey, buildReportFingerprint } from './report-fingerprint.js';
import { createPresentationDiagnostics } from './presentation-diagnostics.js';
import {
  clearAllRuntimeFallbacks,
  getRuntimeFallbackDiagnostics,
  isBattleContractDisabled,
  markBattleContractDisabled
} from './runtime-fallback-registry.js';

const STORAGE_KEY = 'iron-command.presentation-mode';
const PERMANENT_FALLBACK_CODES = new Set(['render_error', 'invalid_runtime_state', 'unknown_template_slot', 'layout_runtime_error', 'contract_renderer_unavailable', 'universal_plan_invalid', 'universal_renderer_unavailable']);

function readPreference() {
  try { return ['auto', 'legacy', 'contract', 'universal'].includes(sessionStorage.getItem(STORAGE_KEY)) ? sessionStorage.getItem(STORAGE_KEY) : 'auto'; } catch { return 'auto'; }
}

function writePreference(value) { try { sessionStorage.setItem(STORAGE_KEY, value); } catch { /* session-only preference is best effort */ } }

export function createBattlePresentationRouter({ canvas, legacyRenderer, onStateChange } = {}) {
  const diagnostics = createPresentationDiagnostics();
  diagnostics.setPreference(readPreference());
  const contractRenderer = new ContractBattleRenderer(canvas);
  const universalRenderer = new UniversalBattleRenderer(canvas);
  let lastBattleId = null;
  let lastBattleKey = null;
  let lastBattleRef = null;
  let renderedMode = 'legacy';
  let presentation = null;
  let frameId = 0;

  function preference() { return diagnostics.state.preference; }
  function shouldTryContract(activeBattle) { return Boolean(activeBattle?.report) && (preference() === 'contract' || (preference() === 'auto' && isContractTemplatePrecedence(activeBattle))); }
  function shouldTryUniversal(activeBattle) { return Boolean(activeBattle?.report) && (preference() === 'universal' || (preference() === 'auto' && getUniversalCoverageDecision(activeBattle).eligible)); }
  function publish() { onStateChange?.(getState()); }
  function battleKey(activeBattle) { return buildPresentationCacheKey(activeBattle); }
  function fallback(code, reason, key, activeBattle, mode = 'legacy') {
    diagnostics.markFallback(code, reason, activeBattle?.id || activeBattle?.report?.id || null, mode);
    if (PERMANENT_FALLBACK_CODES.has(code)) markBattleContractDisabled(key, code, reason);
  }

  function render(activeBattle, dtReal = 0) {
    frameId += 1;
    if (!activeBattle) {
      presentation = null; renderedMode = 'legacy'; lastBattleId = null; lastBattleKey = null; lastBattleRef = null;
      contractRenderer.reset(); universalRenderer.reset(); publish(); return false;
    }
    const key = battleKey(activeBattle);
    const replacedBattle = lastBattleRef !== null && lastBattleRef !== activeBattle;
    const changedBattle = key !== lastBattleKey;
    if (replacedBattle || changedBattle) { clearContractPlanCache(); clearUniversalPlanCache(); }
    lastBattleRef = activeBattle; lastBattleKey = key; lastBattleId = activeBattle.id || activeBattle.report?.id || null;
    const coverageDecision = getUniversalCoverageDecision(activeBattle); diagnostics.setCoverageDecision(coverageDecision); if (preference() === 'auto' && coverageDecision.eligible && !isContractTemplatePrecedence(activeBattle)) diagnostics.state.universalDefaultAttempts += 1;

    if (shouldTryContract(activeBattle) && !isBattleContractDisabled(key)) {
      diagnostics.markAttempt(lastBattleId, 'contract');
      const candidate = getOrBuildContractPresentation(activeBattle);
      if (candidate.ok) {
        try {
          contractRenderer.setPresentation(candidate);
          const rendered = contractRenderer.render(activeBattle, dtReal);
          if (rendered === true) {
            presentation = candidate; renderedMode = 'contract_road_victory'; diagnostics.markSuccess('contract'); publish(); return true;
          }
          fallback('contract_renderer_unavailable', 'contract renderer returned false', key, activeBattle, 'contract');
        } catch (error) {
          fallback('render_error', error instanceof Error ? error.message : String(error), key, activeBattle, 'contract');
        }
      } else fallback(candidate.code, candidate.reason, key, activeBattle, 'contract');
    }
    if (shouldTryUniversal(activeBattle) && !isBattleContractDisabled(key)) {
      diagnostics.markAttempt(lastBattleId, 'universal');
      const candidate = getOrBuildUniversalPresentation(activeBattle);
      if (candidate.ok) {
        try {
          universalRenderer.setPresentation(candidate);
          const rendered = universalRenderer.render(activeBattle, dtReal);
          if (rendered === true) {
            presentation = candidate; renderedMode = 'universal_battle'; diagnostics.markSuccess('universal', preference() === 'auto' ? 'default' : 'explicit'); publish(); return true;
          }
          fallback('universal_renderer_unavailable', 'universal renderer returned false', key, activeBattle, 'universal');
        } catch (error) {
          fallback('render_error', error instanceof Error ? error.message : String(error), key, activeBattle, 'universal');
        }
      } else fallback(candidate.code, candidate.reason, key, activeBattle, 'universal');
    }

    renderedMode = 'legacy'; presentation = null; contractRenderer.reset(); universalRenderer.reset();
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
      universalCache: getUniversalPlanCacheDiagnostics(),
      runtimeFallbacks: getRuntimeFallbackDiagnostics(),
      presentation: presentation ? { ok: presentation.ok, mode: presentation.mode, reportId: presentation.reportId, reportFingerprint: presentation.reportFingerprint, plan: presentation.plan } : null
    };
  }
  function getPresentation() { return presentation; }
  function reset() { presentation = null; renderedMode = 'legacy'; lastBattleId = null; lastBattleKey = null; lastBattleRef = null; clearContractPlanCache(); clearUniversalPlanCache(); clearAllRuntimeFallbacks(); contractRenderer.reset(); universalRenderer.reset(); publish(); }
  function destroy() { contractRenderer.destroy(); universalRenderer.destroy(); reset(); }
  function getTextState(options) { return renderedMode === 'contract_road_victory' ? contractRenderer.getTextState(options) : renderedMode === 'universal_battle' ? universalRenderer.getTextState(options) : null; }
  function setCameraMode(mode) { contractRenderer.setCameraMode(mode); universalRenderer.setCameraMode(mode); legacyRenderer?.setCameraMode?.(mode); }
  function setAutoCamera(enabled) { contractRenderer.setAutoCamera(enabled); universalRenderer.setAutoCamera(enabled); legacyRenderer?.setAutoCamera?.(enabled); }
  function resetCamera() { contractRenderer.resetCamera?.(); universalRenderer.resetCamera?.(); legacyRenderer?.resetCamera?.(); }
  function setDebugOverlay(enabled, options = {}) { contractRenderer.setDebugOverlay?.(enabled, options); universalRenderer.setDebugOverlay?.(enabled, options); publish(); return getDebugOverlayState(); }
  function getDebugOverlayState() { return renderedMode === 'universal_battle' ? universalRenderer.getDebugOverlayState?.() : contractRenderer.getDebugOverlayState?.() || { debugOverlay: false }; }
  function getInteractionState() { return renderedMode === 'universal_battle' ? universalRenderer.getInteractionState?.() : renderedMode === 'contract_road_victory' ? contractRenderer.getInteractionState?.() : legacyRenderer?.getInteractionState?.() || null; }
  function getAssetRuntimeState() { return renderedMode === 'universal_battle' ? universalRenderer.getAssetRuntimeState?.() || null : null; }
  function getActorScreenMetrics() { return renderedMode === 'universal_battle' ? universalRenderer.getActorScreenMetrics?.() || null : null; }
  function getActorScreenMetricsAt(seconds) { return renderedMode === 'universal_battle' ? universalRenderer.getActorScreenMetricsAt?.(seconds) || null : null; }
  function setAssetDisabled(assetId, value = true) { return renderedMode === 'universal_battle' ? universalRenderer.setAssetDisabled?.(assetId, value) || null : null; }

  function getRenderState() { return renderedMode === 'universal_battle' ? universalRenderer.lastState || null : contractRenderer.lastState || null; }
  function getRenderStateAt(seconds) { return renderedMode === 'universal_battle' && universalRenderer.presentation?.renderState ? universalRenderer.presentation.renderState.atTime(Number(seconds) || 0) : getRenderState(); }
  // Test/evidence-only deterministic seek: render a timestamp without
  // advancing settlement or mutating the authoritative active battle.
  function renderAt(seconds) {
    if (renderedMode !== 'universal_battle' || !universalRenderer.presentation?.plan || !lastBattleRef) return null;
    const visualDuration = Math.max(.001, Number(universalRenderer.presentation.plan.timeline?.duration) || 1); const sourceDuration = Math.max(.001, Number(lastBattleRef.duration) || 1); const snapshot = { ...lastBattleRef, elapsed: Math.max(0, Math.min(sourceDuration, Number(seconds) / visualDuration * sourceDuration)), playing: false };
    universalRenderer.render(snapshot, 0); return universalRenderer.lastState || null;
  }

  return { render, reset, destroy, setPreference, getPreference: preference, getState, getPresentation, getRenderState, getRenderStateAt, renderAt, getTextState, setCameraMode, setAutoCamera, resetCamera, setDebugOverlay, getDebugOverlayState, getInteractionState, getAssetRuntimeState, getActorScreenMetrics, getActorScreenMetricsAt, setAssetDisabled };
}
