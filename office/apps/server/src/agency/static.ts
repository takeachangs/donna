import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Serve only a built frontend, never the repository, .env, project memory or logs.
export function serveWeb(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  root = resolve('dist/web'),
): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return false;
  if (!existsSync(root)) return false;
  const base = realpathSync(root),
    file = resolve(base, '.' + (decoded === '/' ? '/index.html' : decoded));
  if (!file.startsWith(base + sep) || !mime[extname(file)] || !existsSync(file)) return false;
  const actual = realpathSync(file);
  if (!actual.startsWith(base + sep) || !statSync(actual).isFile()) return false;
  res.writeHead(200, {
    'Content-Type': mime[extname(actual)],
    'Content-Length': statSync(actual).size,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(actual).pipe(res);
  return true;
}
