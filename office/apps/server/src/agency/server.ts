// The office server: the built page, GET health and workspace, /agency-ws, which streams office.json, and POST phone (#75),
// which writes the Call Donna / Hang up button's command for bridge.py --ring. Nothing else.
import { createServer, type ServerResponse } from 'node:http';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';
import { serveWeb } from './static.js';
import { serveResult } from './results.js';
import { log } from './log.js';
import { officeFile, phoneState, watchOffice, type Office } from './state.js';

const version = (() => {
  const v = JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')).version;
  try {
    return `${v}+${execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()}`;
  } catch {
    return v;
  }
})();
const file = officeFile(),
  home = dirname(file),
  clients = new Set<WebSocket>(),
  message = (o: Office) => JSON.stringify({ type: 'workspace', workspace: o.workspace });
let seen = '';
const office = watchOffice(file, (o) => {
  const now = `${o.state === 'file' ? 'drawing the file' : 'no valid file, Donna alone'}, call ${o.workspace.call.state}`;
  if (now !== seen) log('office')((seen = now));
  const m = message(o);
  for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(m);
});
const local = (origin: string | undefined) => !origin || /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin);
const json = (res: ServerResponse, data: unknown, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};
const server = createServer((req, res) => {
  if (!local(req.headers.origin)) return json(res, { error: 'Local origins only' }, 403);
  const u = new URL(req.url || '/', 'http://localhost');
  if (u.pathname === '/agency-api/health') {
    const o = office.get();
    return json(res, { ok: true, version, state: o.state, updated: o.updated, phone: phoneState(home) });
  }
  if (u.pathname === '/agency-api/phone' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => (body += d).length > 1024 && req.destroy());
    req.on('end', () => {
      let cmd: unknown;
      try {
        cmd = JSON.parse(body).cmd;
      } catch {}
      if (cmd !== 'call' && cmd !== 'hangup') return json(res, { error: 'cmd must be call or hangup' }, 400);
      const f = join(home, 'phone.cmd');
      writeFileSync(f + '.tmp', cmd);
      renameSync(f + '.tmp', f); // whole or absent: the bridge reads it every 250 ms
      json(res, { ok: true, cmd });
    });
    return;
  }
  if (u.pathname === '/agency-api/workspace') return json(res, office.get().workspace);
  if (serveResult(req, res, u.pathname, home, office.get().workspace)) return;
  if (!u.pathname.startsWith('/agency-api/') && serveWeb(req, res, u.pathname)) return;
  return json(res, { error: 'Not found' }, 404);
});
const wss = new WebSocketServer({ server, path: '/agency-ws', maxPayload: 1024 });
wss.on('connection', (client, req) => {
  if (!local(req.headers.origin)) {
    client.close(1008);
    return;
  }
  clients.add(client);
  client.send(message(office.get()));
  client.on('close', () => clients.delete(client));
});
// ws re-emits the http server's listen error on wss, ahead of any server listener.
wss.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`Port ${process.env.AGENCY_PORT || 3003} is in use; stop the other office server or set AGENCY_PORT.`);
  process.exit(1);
});
server.listen(Number(process.env.AGENCY_PORT || 3003), '127.0.0.1', () => {
  const address = server.address();
  console.log(`Office: http://127.0.0.1:${typeof address === 'object' && address ? address.port : ''} drawing ${file}`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    office.close();
    for (const ws of clients) ws.close();
    server.close();
    setTimeout(() => process.exit(0), 500).unref();
  });
