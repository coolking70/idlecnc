import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'stage9_e_browser_capture_manifest.json',
  'stage9_e_evidence.json',
  'stage9_e_strong_evidence_verdict.json',
  'stage9_e_tamper_results.json',
  'stage9_e_developer_selfcheck.json',
  'stage9_e_machine_evidence.json'
];
for (const relativePath of files) fs.rmSync(path.join(root, relativePath), { force: true });
fs.rmSync(path.join(root, 'screenshots/stage9-E'), { recursive: true, force: true });
console.log(JSON.stringify({ stage: '9-E.1a', removed: [...files, 'screenshots/stage9-E'] }));
