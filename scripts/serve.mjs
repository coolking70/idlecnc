/**
 * scripts/serve.mjs —— 零依赖本地静态服务器
 *
 * 目的：ES Module 无法通过 file:// 协议加载，必须经由 HTTP 服务器访问。
 * 本脚本只使用 Node 内置模块（node:http / node:fs / node:path / node:url），
 * 不引入任何第三方依赖，符合“纯前端 + 零依赖”的项目约束。
 *
 * 用法：
 *   node scripts/serve.mjs            # http://127.0.0.1:8000
 *   node scripts/serve.mjs 8080       # 指定端口
 *   PORT=8080 node scripts/serve.mjs  # 通过环境变量指定端口
 *
 * 安全性：
 *   - 只允许访问项目根目录内的文件，任何 ../ 穿越都会被拒绝（403）；
 *   - 只响应 GET / HEAD，其它方法返回 405；
 *   - 目录访问自动回落到 index.html，不做目录列表。
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/** 项目根目录（scripts/ 的上一级） */
const ROOT = path.resolve(__dirname, '..');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.argv[2] || process.env.PORT || 8000);

/** 扩展名 → Content-Type */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

/**
 * 把请求 URL 解析成安全的磁盘路径。
 * @returns {{ok:true, file:string} | {ok:false, status:number, message:string}}
 */
export function resolveRequestPath(urlPath, root = ROOT) {
  let pathname;
  try {
    pathname = decodeURIComponent(String(urlPath || '/').split('?')[0].split('#')[0]);
  } catch (err) {
    return { ok: false, status: 400, message: 'Bad Request' };
  }
  // 反斜杠一律视为分隔符，避免 Windows 下绕过检查
  pathname = pathname.replace(/\\/g, '/');
  if (pathname.includes('\0')) return { ok: false, status: 400, message: 'Bad Request' };

  // 目录访问回落到 index.html
  if (pathname.endsWith('/')) pathname += 'index.html';

  const target = path.resolve(root, `.${pathname.startsWith('/') ? '' : '/'}${pathname}`);
  const rel = path.relative(root, target);
  // 越界判定：relative 结果以 .. 开头或是绝对路径 → 试图跳出根目录
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, status: 403, message: 'Forbidden' };
  }
  return { ok: true, file: target };
}

/** 内容类型 */
export function contentTypeOf(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function sendError(res, status, message) {
  const body = `${status} ${message}`;
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

export function createServer(root = ROOT) {
  return http.createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendError(res, 405, 'Method Not Allowed');
      return;
    }

    const resolved = resolveRequestPath(req.url, root);
    if (!resolved.ok) {
      sendError(res, resolved.status, resolved.message);
      return;
    }

    let file = resolved.file;
    try {
      let stat = await fsp.stat(file);
      if (stat.isDirectory()) {
        file = path.join(file, 'index.html');
        stat = await fsp.stat(file);
      }

      res.writeHead(200, {
        'Content-Type': contentTypeOf(file),
        'Content-Length': stat.size,
        // 原型开发期禁用缓存，改代码后刷新即可生效
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file)
        .on('error', () => { res.destroy(); })
        .pipe(res);
    } catch (err) {
      sendError(res, 404, 'Not Found');
    }
  });
}

/** 直接执行时才启动监听（被测试 import 时不会占端口） */
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(__filename);

if (invokedDirectly) {
  const server = createServer(ROOT);
  server.listen(PORT, HOST, () => {
    console.log('钢铁指令 / IRON COMMAND —— 本地开发服务器已启动');
    console.log(`  根目录：${ROOT}`);
    console.log(`  地址：  http://${HOST}:${PORT}/`);
    console.log('  按 Ctrl+C 停止。');
  });
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`端口 ${PORT} 已被占用，请换一个端口：node scripts/serve.mjs 8080`);
    } else {
      console.error('服务器启动失败：', err);
    }
    process.exit(1);
  });
}

export { ROOT, PORT, HOST };
