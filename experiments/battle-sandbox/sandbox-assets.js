const spriteCache = new Map();

export function getSpriteCanvas(key, width, height, painter) {
  if (spriteCache.has(key)) return spriteCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  painter(context, width, height);
  spriteCache.set(key, canvas);
  return canvas;
}

export function clearSpriteCache() { spriteCache.clear(); }

export function drawBadge(context, x, y, color, label) {
  const sprite = getSpriteCanvas(`badge-${color}-${label}`, 44, 18, (ctx) => {
    ctx.fillStyle = 'rgba(7, 14, 18, .78)'; ctx.roundRect(1, 1, 42, 16, 4); ctx.fill();
    ctx.fillStyle = color; ctx.fillRect(5, 6, 6, 6); ctx.font = '700 9px sans-serif'; ctx.fillText(label, 15, 12);
  });
  context.drawImage(sprite, x - 22, y - 9);
}

