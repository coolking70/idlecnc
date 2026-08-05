import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archive = path.join(root, 'iron-command-stage8-2E-A-formal-sidecar-integration.zip');
const manifestPath = path.join(root, 'tests/stage8-2E-A-boundary.json');
const hashFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const boundaryHash = (manifest) => crypto.createHash('sha256').update(manifest.formalBoundaryFiles.slice().sort().map((file) => `${file}\0${hashFile(path.join(root, file))}\n`).join('')).digest('hex');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (boundaryHash(manifest) !== manifest.formalBoundaryHash) throw new Error('formal boundary manifest is stale');
const outputPath = path.join(root, 'tests/outputs/stage8-2E-A-full-test-output.txt');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const output = execFileSync('npm', ['test'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
fs.writeFileSync(outputPath, output);
const tempArchive = path.join(root, `.stage8-2E-A-${process.pid}.zip`);
execFileSync('zip', ['-rq', tempArchive, '.', '-x', '*.zip', 'node_modules/*', 'output/*', 'tmp/*', '*.log', '*.tmp', '*.backup', '*/.*'], { cwd: root, stdio: 'inherit' });
fs.renameSync(tempArchive, archive);
execFileSync(process.execPath, ['tests/verify-stage8-2E-A-delivery-package.mjs', archive], { cwd: root, stdio: 'inherit' });
console.log(`delivery package: ${archive}`);
console.log(`sha256: ${hashFile(archive)}`);
