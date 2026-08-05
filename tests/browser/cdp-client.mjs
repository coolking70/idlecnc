import http from 'node:http';
import net from 'node:net';

function waitForServer(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(server.address().port); };
    server.once('error', onError); server.once('listening', onListening);
  });
}

export async function listenEphemeral(server) { server.listen(0, '127.0.0.1'); return waitForServer(server); }

export async function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = ''; response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    }).on('error', reject);
  });
}

export function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

export function waitForOutput(stream, pattern, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => { cleanup(); reject(new Error(`timed out waiting for ${pattern}`)); }, timeoutMs);
    const onData = (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(pattern);
      if (match) { cleanup(); resolve(match); }
    };
    const onError = (error) => { cleanup(); reject(error); };
    const cleanup = () => { clearTimeout(timer); stream.off('data', onData); stream.off('error', onError); };
    stream.on('data', onData); stream.on('error', onError);
  });
}

export function waitForWebSocket(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => { try { socket.close(); } catch {} reject(new Error(`timed out opening ${url}`)); }, timeoutMs);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(socket); }, { once: true });
    socket.addEventListener('error', (event) => { clearTimeout(timer); reject(event.error || new Error('CDP websocket error')); }, { once: true });
  });
}

export class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.events = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8'));
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id); this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message || 'CDP command failed'));
        else pending.resolve(message.result);
      } else if (message.method) for (const listener of this.events.get(message.method) || []) listener(message.params || {});
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    if (!this.events.has(method)) this.events.set(method, new Set());
    this.events.get(method).add(listener);
    return () => this.events.get(method)?.delete(listener);
  }

  async evaluate(expression, awaitPromise = true, returnByValue = true) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'page evaluation failed');
    return returnByValue ? result.result?.value : result.result;
  }

  async screenshot(path) {
    const result = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const fs = await import('node:fs/promises');
    await fs.writeFile(path, Buffer.from(result.data, 'base64'));
  }

  close() { try { this.socket.close(); } catch {} }
}

export function localStaticServer(rootDir) {
  return http.createServer(async (request, response) => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const urlPath = decodeURIComponent((request.url || '/').split('?')[0]);
    const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const file = path.resolve(rootDir, relative);
    if (!file.startsWith(path.resolve(rootDir) + path.sep)) { response.writeHead(403); response.end(); return; }
    try {
      const data = await fs.readFile(file);
      const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream';
      response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); response.end(data);
    } catch { response.writeHead(404); response.end('not found'); }
  });
}
