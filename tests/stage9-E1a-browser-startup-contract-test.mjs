import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DEVTOOLS_TIMEOUT_MS,
  resolveDevToolsTimeoutMs
} from './browser/managed-browser-process.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'tests/browser/managed-browser-process.mjs'), 'utf8');
const cleanCloneSource = fs.readFileSync(path.join(root, 'tests/verify-clean-clone.mjs'), 'utf8');
const workflowSource = fs.readFileSync(path.join(root, '.github/workflows/core-regression.yml'), 'utf8');
const checks = [];
const check = (name, passed, details = {}) => checks.push({ name, passed, ...details });

check('default-timeout-at-least-30-seconds', DEFAULT_DEVTOOLS_TIMEOUT_MS >= 30000, { value: DEFAULT_DEVTOOLS_TIMEOUT_MS });
check('default-timeout-resolution', resolveDevToolsTimeoutMs({}, {}) === DEFAULT_DEVTOOLS_TIMEOUT_MS);
check('environment-override', resolveDevToolsTimeoutMs({}, { IRON_BROWSER_DEVTOOLS_TIMEOUT_MS: '61000' }) === 61000);
check('config-override-has-priority', resolveDevToolsTimeoutMs({ devtoolsTimeoutMs: 70000 }, { IRON_BROWSER_DEVTOOLS_TIMEOUT_MS: '61000' }) === 70000);
check('invalid-environment-falls-back', resolveDevToolsTimeoutMs({}, { IRON_BROWSER_DEVTOOLS_TIMEOUT_MS: 'not-an-integer' }) === DEFAULT_DEVTOOLS_TIMEOUT_MS);
check('zero-environment-falls-back', resolveDevToolsTimeoutMs({}, { IRON_BROWSER_DEVTOOLS_TIMEOUT_MS: '0' }) === DEFAULT_DEVTOOLS_TIMEOUT_MS);
check('invalid-config-uses-valid-environment', resolveDevToolsTimeoutMs({ devtoolsTimeoutMs: 'invalid' }, { IRON_BROWSER_DEVTOOLS_TIMEOUT_MS: '61000' }) === 61000);
check('config-is-positive-integer', resolveDevToolsTimeoutMs({ devtoolsTimeoutMs: 1 }, {}) === 1);
check('single-chromium-launch-site', (source.match(/spawn\(resolution\.executable/g) || []).length === 1, { launchCount: (source.match(/spawn\(resolution\.executable/g) || []).length });
check('no-startup-retry-loop', !/retry|best-of-N|restart browser/i.test(source));
check('startup-failure-is-fail-closed', source.includes('terminateManagedBrowser(browser') && source.includes('throw error'));
check('clean-clone-reuses-qualified-input', cleanCloneSource.includes('IRON_CLEAN_CLONE_PERFORMANCE_INPUT') && cleanCloneSource.includes('formalMeasurementRerun: false'));
check('clean-clone-does-not-run-formal-performance', workflowSource.includes('Download same-run qualified D-C.1 performance input') && workflowSource.includes('IRON_CLEAN_CLONE_PERFORMANCE_INPUT:'));

const passed = checks.every((entry) => entry.passed);
const result = { stage: '9-E.1a', contract: 'browser-startup', checks, passed };
console.log(JSON.stringify(result, null, 2));
if (!passed) process.exitCode = 1;
