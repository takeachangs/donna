import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { serveWeb } from '../apps/server/src/agency/static';

let server: Server, base: string, dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'agency-static-'));
  mkdirSync(join(dir, 'web'));
  writeFileSync(join(dir, 'web/index.html'), '<title>Personal Agency</title>');
  writeFileSync(join(dir, 'web/agency-mic.js'), '// worklet');
  writeFileSync(join(dir, '.env'), 'PRIVATE');
  server = createServer((req, res) => {
    if (!serveWeb(req, res, new URL(req.url!, 'http://localhost').pathname, join(dir, 'web'))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => {
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  if (!resolve(dir).startsWith(resolve(tmpdir()) + sep + 'agency-static-')) throw Error('Unexpected test directory');
  rmSync(dir, { recursive: true, force: true });
});
it('serves the production entry and same-origin microphone worklet', async () => {
  expect(await (await fetch(base)).text()).toContain('Personal Agency');
  const worklet = await fetch(base + '/agency-mic.js');
  expect(worklet.headers.get('content-type')).toContain('javascript');
  expect(worklet.status).toBe(200);
});
it('serves HEAD without a body and does not accept mutations', async () => {
  const response = await fetch(base, { method: 'HEAD' });
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('');
  expect((await fetch(base, { method: 'POST' })).status).toBe(404);
});
it('never exposes source, private data or encoded traversal', async () => {
  for (const p of [
    '/.env',
    '/../.env',
    '/%2e%2e%2f.env',
    '/..%5c.env',
    '/artifacts/agency/workspace.json',
    '/apps/server/src/agency/server.ts',
    '/%00',
  ])
    expect((await fetch(base + p)).status).toBe(404);
});
