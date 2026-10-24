// Read only reviewed result snapshots registered by herd.py, never arbitrary filesystem paths.
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Workspace } from '../../../web/src/agency/types';

const mime: Record<string, string> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
};
const inside = (base: string, file: string) => {
  const part = relative(base, file);
  return part !== '..' && !part.startsWith('../') && !part.startsWith('..\\') && !isAbsolute(part);
};

export function serveResult(req: IncomingMessage, res: ServerResponse, path: string, home: string, workspace: Workspace) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const m = /^\/agency-api\/results\/([a-f0-9]{24})\/(result\.([a-z]+))$/.exec(path);
  if (!m || !mime[m[3]] || !workspace.briefings.some((b) => b.artifacts?.some((a) => a.id === m[1] && a.file === m[2]))) return false;
  let file: string, size: number;
  try {
    const root = realpathSync(home), base = realpathSync(join(root, 'results'));
    file = realpathSync(join(base, m[1], m[2]));
    if (!inside(root, base) || !inside(base, file)) return false;
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > 10 * 1024 * 1024) return false;
    size = stat.size;
  } catch { return false; }
  res.writeHead(200, {
    'Content-Type': mime[m[3]], 'Content-Length': size, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    // Generated HTML gets an opaque origin: its script cannot call the office API or read the office tab.
    'Content-Security-Policy': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'",
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  return true;
}
