import { afterAll, beforeAll, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WebSocket } from 'ws';

let child: ChildProcess, base: string, dir: string, exit: Promise<void>;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'office-http-'));
  child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/agency/server.ts'], {
    cwd: resolve('.'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HIGGS_HOME: dir, AGENCY_PORT: '0' },
  });
  exit = new Promise((r) => child.once('exit', () => r()));
  base = await new Promise<string>((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(Error('Server startup timed out: ' + output)), 8000);
    child.once('exit', () => {
      clearTimeout(timeout);
      reject(Error('Server exited before readiness: ' + output));
    });
    child.stderr?.on('data', (d) => (output += d));
    child.stdout?.on('data', (d) => {
      output += d;
      const m = output.match(/Office: (http:\/\/127\.0\.0\.1:\d+)/);
      if (m) {
        clearTimeout(timeout);
        resolve(m[1]);
      }
    });
  });
});
afterAll(async () => {
  if (child) {
    child.kill();
    await exit;
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
});
const get = async (path: string) => (await fetch(base + path)).json();

it('serves health, the workspace and nothing else under /agency-api', async () => {
  const h = await get('/agency-api/health');
  expect(h).toMatchObject({ ok: true, state: 'missing', updated: null });
  expect(h.version).toMatch(/^\d+\.\d+\.\d+/);
  const w = await get('/agency-api/workspace');
  expect(w.secretary.name).toBe('Donna');
  expect(w.call).toEqual({ state: 'off' });
  expect(w.workers).toEqual([]);
  expect((await fetch(base + '/agency-api/projects', { method: 'POST', body: '{}' })).status).toBe(404);
  expect((await fetch(base + '/agency-api/health', { headers: { Origin: 'http://evil.example' } })).status).toBe(403);
});

it('sends the workspace on connect and again when office.json changes', async () => {
  const ws = new WebSocket(base.replace('http', 'ws') + '/agency-ws'),
    got: any[] = [];
  ws.on('message', (m) => got.push(JSON.parse(String(m))));
  const until = async (n: number) => {
    for (let i = 0; i < 150 && got.length < n; i++) await new Promise((r) => setTimeout(r, 20));
    expect(got.length).toBeGreaterThanOrEqual(n);
  };
  await until(1);
  expect(got[0]).toMatchObject({ type: 'workspace', workspace: { revision: 0, call: { state: 'off' } } });
  const file = join(dir, 'office.json');
  writeFileSync(file + '.tmp', JSON.stringify({ revision: 7, call: { state: 'speaking' }, projects: [] }));
  renameSync(file + '.tmp', file);
  await until(2);
  expect(got.at(-1)).toMatchObject({ type: 'workspace', workspace: { revision: 7, call: { state: 'speaking' } } });
  expect((await get('/agency-api/health')).state).toBe('file');
  ws.close();
});
