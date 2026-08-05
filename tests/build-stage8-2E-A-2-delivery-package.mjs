import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archive = path.join(root, 'iron-command-stage8-2E-A-2-browser-evidence-final.zip');
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const outputDir = path.join(root, 'tests/outputs'); fs.mkdirSync(outputDir, { recursive: true });
const run = (label, command, args, options = {}) => { console.log(`START ${label}`); const output = execFileSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, ...options }); console.log(`PASS ${label}`); return output; };

const preflight = run('npm test preflight', 'npm', ['test']);
fs.writeFileSync(path.join(outputDir, 'stage8-2E-A-2-full-test-output.txt'), preflight);
const browser = run('browser evidence', process.execPath, ['tests/browser/formal-battle-evidence.mjs']);
fs.writeFileSync(path.join(outputDir, 'stage8-2E-A-2-browser-evidence-output.txt'), browser);
const finalTests = run('npm test final', 'npm', ['test']);
fs.writeFileSync(path.join(outputDir, 'stage8-2E-A-2-full-test-output.txt'), finalTests);
const temp = path.join(root, `.stage8-2E-A-2-${process.pid}.zip`);
run('create zip', 'zip', ['-rq', temp, '.', '-x', '*.zip', 'node_modules/*', 'output/*', 'tmp/*', '*.log', '*.tmp', '*.backup', '*/.*']);
fs.renameSync(temp, archive);
run('verify extracted delivery', process.execPath, ['tests/verify-stage8-2E-A-2-delivery-package.mjs', archive], { stdio: 'inherit' });
console.log(`delivery package: ${archive}`);
console.log(`sha256: ${hash(archive)}`);

