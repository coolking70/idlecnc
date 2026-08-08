import fs from 'node:fs';
import { OFFLINE_ASSET_MANIFEST } from '../js/battle-presentation/environment/asset-provider.js';

fs.writeFileSync('assets/battle/asset-manifest.json', `${JSON.stringify(OFFLINE_ASSET_MANIFEST, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: '8.2G-D-B', assets: OFFLINE_ASSET_MANIFEST.assets.length, directions: OFFLINE_ASSET_MANIFEST.directions }));
