import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const client = path.join(dist, 'client');
const server = path.join(dist, 'server');

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(client, { recursive: true });
await fs.mkdir(server, { recursive: true });

await Promise.all([
  fs.copyFile(path.join(root, 'index.html'), path.join(client, 'index.html')),
  fs.cp(path.join(root, 'css'), path.join(client, 'css'), { recursive: true }),
  fs.cp(path.join(root, 'js'), path.join(client, 'js'), { recursive: true }),
  fs.cp(path.join(root, 'public'), path.join(client, 'public'), { recursive: true }),
]);

await fs.writeFile(path.join(server, 'index.js'), `
const assetPath = (request) => {
  const url = new URL(request.url);
  return url.pathname === '/' ? '/index.html' : url.pathname;
};

const withHeaders = (response) => {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'public, max-age=3600');
  return new Response(response.body, { status: response.status, headers });
};

const renderHtml = async (request, response) => {
  if (!response.ok || response.headers.get('content-type')?.includes('text/html') !== true) {
    return response;
  }
  const html = await response.text();
  const imageUrl = new URL('/public/og.png', request.url).href;
  return new Response(html.replaceAll('__OG_IMAGE_URL__', imageUrl), {
    status: response.status,
    headers: response.headers,
  });
};

const worker = {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const asset = await env.ASSETS.fetch(new Request(new URL(assetPath(request), request.url), request));
    return withHeaders(await renderHtml(request, asset));
  },
};

export default worker;
`);

console.log('Static Sites build complete: dist/client + dist/server/index.js');
