import assert from 'node:assert/strict';
import fs from 'node:fs';
const dir = new URL('../universal-planner/scenarios/', import.meta.url); const specs = JSON.parse(fs.readFileSync(new URL('fuzz-specs.json', dir), 'utf8')); const coverage = JSON.parse(fs.readFileSync(new URL('coverage.json', dir), 'utf8')); const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', dir), 'utf8'));
assert.equal(specs.length, 1000); assert.equal(coverage.fuzzCount, specs.length); assert.equal(manifest.fuzzSpecs, 'fuzz-specs.json'); assert.ok(specs.every((spec) => spec.seed !== undefined && spec.theaterId && spec.missionId && spec.strategyId && Array.isArray(spec.unitTypes) && !spec.report)); assert.ok(JSON.stringify(specs).length < 2_000_000);
console.log('universal-slim-delivery-test: compact fuzz specifications passed');

