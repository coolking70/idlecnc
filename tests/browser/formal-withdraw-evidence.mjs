/**
 * Build a second, independent formal battle whose authoritative result is withdraw.
 * This module intentionally uses only the page's public debug/business API; it never
 * injects a fixture report into activeBattle.
 */
export async function prepareFormalWithdrawBattle(cdp) {
  const script = `
    (async () => {
      const api = window.__IRON_COMMAND__;
      api.reset();
      api.setPresentationMode('auto');
      const step = async (ms) => { await window.advanceTime(ms); };
      const build = async (id, wait) => { const result = api.build(id); if (!result.ok) throw new Error('withdraw build ' + id + ': ' + result.reason); await step(wait); };
      await build('barracks', 30000);
      await build('armor_factory', 50000);
      for (let index = 0; index < 12; index += 1) await step(1800000);
      await build('radar_station', 40000);
      for (let index = 0; index < 12; index += 1) await step(1800000);
      await build('research_center', 60000);
      for (let index = 0; index < 10; index += 1) await step(1800000);
      for (const tech of ['tactical_datalink', 'field_maintenance', 'expanded_command_network']) {
        const result = api.research(tech);
        if (!result.ok) throw new Error('withdraw research ' + tech + ': ' + result.reason);
        await step(70000);
      }
      for (let index = 0; index < 10; index += 1) await step(1800000);
      for (const type of ['infantry', 'at_infantry', 'scout_car', 'mbt', 'mbt', 'repair_vehicle']) {
        const result = api.produce(type);
        if (!result.ok) throw new Error('withdraw produce ' + type + ': ' + result.reason);
        await step(40000);
      }
      const created = api.createFormation('真实撤退取证编队');
      if (!created.ok) throw new Error('withdraw create formation: ' + created.reason);
      const formationId = created.formation.id;
      const units = api.units();
      const used = new Set();
      for (const type of ['infantry', 'at_infantry', 'scout_car', 'mbt', 'mbt', 'repair_vehicle']) {
        const unit = units.find((row) => row.type === type && row.status === 'ready' && !used.has(row.id));
        if (!unit) throw new Error('withdraw missing ready unit ' + type);
        used.add(unit.id);
        const result = api.addUnit(formationId, unit.id);
        if (!result.ok) throw new Error('withdraw add ' + type + ': ' + result.reason);
      }
      const findSeed = (theaterId, predicate, targetFormationId = formationId) => {
        for (let seed = 1; seed <= 800; seed += 1) {
          const report = api.simulate(targetFormationId, theaterId, 'breakthrough', seed);
          if (report && predicate(report)) return { seed, report };
        }
        throw new Error('withdraw seed not found for ' + theaterId);
      };
      const captureSeed = findSeed('scrap_mine', (report) => report.result === 'victory' && report.capture === true);
      const capture = api.dispatch(formationId, 'scrap_mine', 'breakthrough', captureSeed.seed);
      if (!capture.ok) throw new Error('withdraw prerequisite dispatch: ' + capture.reason);
      api.tickBattle(999);
      api.tickBattleReturn(5);
      if (api.activeBattle()) throw new Error('withdraw prerequisite did not return to base');
      // Keep the prerequisite capture formal, then create an intentionally weak
      // second formation. This makes the second battle a real withdraw rather
      // than reusing the victory lineup or injecting a fixture report.
      for (const unitId of [...(api.formations().find((row) => row.id === formationId)?.unitIds || [])]) api.removeUnit(formationId, unitId);
      api.disbandFormation(formationId);
      const weakCreated = api.createFormation('真实撤退取证编队');
      if (!weakCreated.ok) throw new Error('withdraw weak formation: ' + weakCreated.reason);
      const weakFormationId = weakCreated.formation.id;
      const weakUsed = new Set();
      for (const type of ['infantry', 'at_infantry', 'scout_car', 'mbt', 'repair_vehicle']) {
        const weakUnit = api.units().find((row) => row.type === type && row.status === 'ready' && !weakUsed.has(row.id));
        if (!weakUnit) throw new Error('withdraw weak unit is not ready: ' + type);
        weakUsed.add(weakUnit.id);
        const weakAdded = api.addUnit(weakFormationId, weakUnit.id);
        if (!weakAdded.ok) throw new Error('withdraw weak add: ' + weakAdded.reason);
      }
      const withdrawSeed = findSeed('border_road', (report) => report.result === 'withdraw'
        && report.capture === false
        && report.events.filter((event) => event.type === 'retreat').length === 1
        && Object.keys(report.rewards || {}).length === 0, weakFormationId);
      // findSeed resolves against the current active formation; the weak formation
      // is now the only ready candidate and is the one dispatched below.
      const dispatched = api.dispatch(weakFormationId, 'border_road', 'breakthrough', withdrawSeed.seed);
      if (!dispatched.ok) throw new Error('withdraw dispatch: ' + dispatched.reason);
      api.setSpeed(0);
      await step(0);
      const active = api.activeBattle();
      if (!active || active.report.result !== 'withdraw') throw new Error('active withdraw report missing');
      if (active.report.events.filter((event) => event.type === 'retreat').length !== 1) throw new Error('withdraw report retreat count mismatch');
      if (active.report.capture !== false || Object.keys(active.report.rewards || {}).length !== 0) throw new Error('withdraw report settlement fields mismatch');
      return { captureSeed: captureSeed.seed, withdrawSeed: withdrawSeed.seed, report: active.report, battleId: active.id };
    })()
  `;
  return cdp.evaluate(script, true, true);
}
