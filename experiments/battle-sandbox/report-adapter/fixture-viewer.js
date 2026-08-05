import { buildPresentationContract } from './presentation-contract.js';

let fixtureIndex = [];
let fixtureManifest = null;
let selectedId = null;
let selectedContract = null;

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function render(contract, fixture) {
  const report = contract.normalizedBattle;
  const manifestRow = fixtureManifest?.fixtures?.find((row) => row.id === selectedId);
  const validation = contract.validation;
  const count = (type) => report.events.filter((event) => event.type === type).length;
  $('summary').innerHTML = `<h2>战报概览</h2><div class="summary-line">
    <div class="metric"><small>RESULT</small><strong>${esc(report.battle.result)}</strong></div>
    <div class="metric"><small>REPORT</small><strong>${esc(report.battle.id)}</strong></div>
    <div class="metric"><small>THEATER / STRATEGY</small><strong>${esc(report.battle.theaterId)} / ${esc(report.battle.strategyId)}</strong></div>
    <div class="metric"><small>ACTORS / EVENTS</small><strong>${report.actors.friendly.length + report.actors.enemy.length} / ${report.events.length}</strong></div>
    <div class="metric"><small>DMG · REPAIR · DESTROY · RETREAT</small><strong>${count('damage')} · ${count('repair')} · ${count('destroy')} · ${count('retreat')}</strong></div>
    <div class="metric"><small>CONTRACT</small><strong class="${contract.diagnostics.supported ? 'ok' : 'bad'}">${contract.diagnostics.supported ? 'SUPPORTED' : 'DIAGNOSTIC'}</strong></div>
  </div><p class="muted" style="margin-top:14px">${esc(fixture.scenario.id)} · seed ${fixture.scenario.seed} · ${esc(report.battle.missionKind)} · source ${report.battle.duration}s → presentation ${contract.presentation.presentationDuration}s · manifest ${manifestRow?.reportHash ? 'matched' : 'missing'}</p>`;
  const roleRows = contract.roleBinding.roleOrder.map((role) => `<tr><td><code>${esc(role)}</code></td><td>${contract.roleBinding.roles[role] ? `<code>${esc(contract.roleBinding.roles[role])}</code>` : '<span class="muted">—</span>'}</td></tr>`).join('');
  $('roles').innerHTML = `<table><thead><tr><th>Role</th><th>Actor</th></tr></thead><tbody>${roleRows}</tbody></table>`;
  $('anchors').innerHTML = `<table><thead><tr><th>Time / Type</th><th>Source</th><th>Actor → Target</th><th>Value</th></tr></thead><tbody>${contract.authorityAnchors.slice(0, 80).map((anchor) => `<tr><td>${esc(anchor.reportTime)} / <code>${esc(anchor.type)}</code></td><td><code>${esc(anchor.sourceEventId)}</code></td><td>${esc(anchor.actorId)} → ${esc(anchor.targetId)}</td><td>${esc(anchor.value)}</td></tr>`).join('')}</tbody></table>${contract.authorityAnchors.length > 80 ? '<p class="muted">仅展示前 80 个锚点；契约保留全部来源。</p>' : ''}`;
  const actors = [...report.actors.friendly, ...report.actors.enemy];
  $('actors').innerHTML = `<table><thead><tr><th>Side</th><th>ID / Type</th><th>Initial</th><th>Final</th><th>Role</th></tr></thead><tbody>${actors.map((actor) => `<tr><td>${esc(actor.side)}</td><td><code>${esc(actor.id)}</code><br>${esc(actor.type)} / ${esc(actor.category)}</td><td>${esc(actor.initial.hp)} / ${esc(actor.initial.maxHp)} / ${actor.initial.alive}</td><td>${esc(actor.final.hp)} / ${esc(actor.final.maxHp)} / ${actor.final.alive}</td><td>${esc((contract.roleBinding.actorRoles[actor.id] || []).join(', ') || '—')}</td></tr>`).join('')}</tbody></table>`;
  $('diagnostics').textContent = JSON.stringify({ validation, authorityCoverage: contract.authorityCoverage, diagnostics: contract.diagnostics }, null, 2);
  $('contract-json').textContent = JSON.stringify(contract, null, 2);
}

async function selectFixture(id) {
  const item = fixtureIndex.find((entry) => entry.id === id) || fixtureIndex[0];
  if (!item) return null;
  const fixture = await fetch(`./fixtures/${encodeURIComponent(item.file)}`).then((response) => response.json());
  selectedId = item.id;
  selectedContract = buildPresentationContract(fixture.report);
  $('fixture-select').value = selectedId;
  render(selectedContract, fixture);
  return selectedContract;
}

window.selectFixture = selectFixture;
window.render_contract_to_text = () => {
  if (!selectedContract) return null;
  const report = selectedContract.normalizedBattle;
  return {
    fixtureId: selectedId, reportId: report.battle.id, result: report.battle.result,
    actorCount: report.actors.friendly.length + report.actors.enemy.length, eventCount: report.events.length,
    roleBinding: selectedContract.roleBinding.roles, anchorCount: selectedContract.authorityAnchors.length,
    uncoveredEventCount: selectedContract.diagnostics.uncoveredEvents.length, supported: selectedContract.diagnostics.supported,
    errors: selectedContract.validation.errors, warnings: selectedContract.validation.warnings,
    manifestCounts: fixtureManifest?.fixtures?.find((row) => row.id === selectedId)?.counts || null,
    manifestSeed: fixtureManifest?.fixtures?.find((row) => row.id === selectedId)?.seed ?? null,
    manifestReportHash: fixtureManifest?.fixtures?.find((row) => row.id === selectedId)?.reportHash || null
  };
};

async function boot() {
  fixtureManifest = await fetch('./fixture-manifest.json').then((response) => response.json());
  fixtureIndex = await fetch('./fixtures/index.json').then((response) => response.json());
  $('fixture-select').innerHTML = fixtureIndex.map((item) => `<option value="${esc(item.id)}">${esc(item.id)}</option>`).join('');
  $('fixture-select').addEventListener('change', (event) => selectFixture(event.target.value));
  await selectFixture(fixtureIndex[0]?.id);
}
boot().catch((error) => { $('diagnostics').textContent = String(error.stack || error); });
