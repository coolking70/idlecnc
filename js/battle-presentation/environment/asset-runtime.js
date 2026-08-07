import { OFFLINE_ASSET_MANIFEST, assetEntry } from './asset-provider.js';

export function createAssetRuntime(manifest = OFFLINE_ASSET_MANIFEST) {
  const records = new Map((manifest.assets || []).map((asset) => [asset.id, { assetId: asset.id, source: asset.source, status: 'unloaded', image: null, error: null }]));
  const disabled = new Set();
  function ensure(assetId) {
    const record = records.get(assetId); if (!record) return record; if (disabled.has(assetId)) { record.status = 'failed'; record.error = 'asset_disabled_for_fallback_test'; return record; } if (record.status === 'ready' || record.status === 'loading' || record.status === 'failed') return record;
    if (typeof Image !== 'function') { record.status = 'failed'; record.error = 'Image unavailable'; return record; }
    const image = new Image(); record.image = image; record.status = 'loading';
    image.onload = () => { record.status = 'ready'; };
    image.onerror = () => { record.status = 'failed'; record.error = 'asset_load_failed'; };
    image.src = typeof location === 'object' && location?.href ? new URL(record.source, location.href).href : record.source;
    return record;
  }
  function ensureAll() { for (const id of records.keys()) ensure(id); return snapshot(); }
  function draw(context, assetId, x, y, width, height, rotation = 0) {
    const record = ensure(assetId); if (!record || record.status !== 'ready' || !record.image) return false;
    context.save(); context.translate(x, y); context.rotate(rotation); context.drawImage(record.image, -width / 2, -height / 2, width, height); context.restore(); return true;
  }
  function snapshot() { return [...records.values()].map(({ assetId, source, status, error }) => ({ assetId, source, status, error: error || null })).sort((a, b) => a.assetId.localeCompare(b.assetId)); }
  return { manifest, ensure, ensureAll, draw, snapshot, setDisabled(assetId, value = true) { if (value) disabled.add(assetId); else disabled.delete(assetId); const record = records.get(assetId); if (record && value) { record.status = 'failed'; record.error = 'asset_disabled_for_fallback_test'; } else if (record && !value && record.error === 'asset_disabled_for_fallback_test') { record.status = 'unloaded'; record.error = null; record.image = null; } return snapshot(); }, clearDisabled() { disabled.clear(); for (const record of records.values()) if (record.error === 'asset_disabled_for_fallback_test') { record.status = 'unloaded'; record.error = null; record.image = null; } return snapshot(); }, get(assetId) { return records.get(assetId) || null; }, allReady() { return snapshot().every((item) => item.status === 'ready'); }, assetEntry: (id) => assetEntry(manifest, id) };
}
