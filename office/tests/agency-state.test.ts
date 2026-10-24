import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyWorkspace, parseOffice, watchOffice, type Office } from '../apps/server/src/agency/state';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'office-state-'));
  dirs.push(d);
  return d;
};
/** The producer's write: tmp + rename. */
const write = (file: string, value: unknown) => {
  writeFileSync(file + '.tmp', typeof value === 'string' ? value : JSON.stringify(value));
  renameSync(file + '.tmp', file);
};
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 20));
  expect(ok()).toBe(true);
};

it('shows Donna alone, off the line, for a missing or invalid file', () => {
  for (const text of ['', '{', '[]', 'null', '42']) expect(parseOffice(text)).toBeUndefined();
  const file = join(tmp(), 'office.json'),
    w = watchOffice(file, () => {});
  expect(w.get()).toEqual({ workspace: emptyWorkspace(), state: 'missing', updated: null });
  expect(w.get().workspace.secretary.name).toBe('Donna');
  expect(w.get().workspace.call.state).toBe('off');
  w.close();
});

it('fills missing lists, secretary and call from the empty workspace', () => {
  const w = parseOffice('{"revision":3,"workers":{},"call":"speaking"}')!;
  expect(w.revision).toBe(3);
  expect(w.workers).toEqual([]);
  expect(w.briefings).toEqual([]);
  expect(w.secretary).toEqual(emptyWorkspace().secretary);
  expect(w.call).toEqual({ state: 'off' });
});

it('calls back once now and on every renamed-over write, also in a folder created later, and only on a change', async () => {
  const file = join(tmp(), 'later', 'office.json'),
    seen: Office[] = [],
    w = watchOffice(file, (o) => seen.push(o), 50);
  expect(seen.map((o) => o.state)).toEqual(['missing']);
  mkdirSync(join(file, '..'));
  write(file, { ...emptyWorkspace(), revision: 1, call: { state: 'ringing' } });
  await until(() => seen.length === 2);
  expect(seen[1].state).toBe('file');
  expect(seen[1].workspace.call.state).toBe('ringing');
  expect(seen[1].updated).toMatch(/^\d{4}-/);
  write(file, { ...emptyWorkspace(), revision: 2 });
  await until(() => seen.at(-1)?.workspace.revision === 2);
  const n = seen.length;
  write(file, { ...emptyWorkspace(), revision: 2 });
  await new Promise((r) => setTimeout(r, 200));
  expect(seen.length).toBe(n);
  write(file, '{"revision":');
  await until(() => seen.at(-1)?.state === 'missing');
  expect(w.get().workspace).toEqual(emptyWorkspace());
  w.close();
});
