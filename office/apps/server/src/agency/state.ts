// The office draws one file, written by Donna's brain: $HIGGS_HOME/office.json (docs/office-state.md in the repo root).
import { readFileSync, statSync, watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Workspace } from '../../../web/src/agency/types';

export type Office = { workspace: Workspace; state: 'file' | 'missing'; updated: string | null };

export const officeFile = () => join(process.env.HIGGS_HOME || join(homedir(), '.higgs'), 'office.json');

// ponytail: char-female-b, not the contract's char-female-a, which is not a shipped model (the NPC would be a placeholder).
/** Donna alone, off the line: what the office shows without a valid file. */
export const emptyWorkspace = (): Workspace => ({
  revision: 0,
  call: { state: 'off' },
  secretary: { id: 'mara', name: 'Donna', role: 'Secretary', voice: 'nora', characterKey: 'char-female-b' },
  projects: [],
  workers: [],
  assignments: [],
  decisions: [],
  briefings: [],
  activity: [],
});

const lists = ['projects', 'workers', 'assignments', 'decisions', 'briefings', 'activity'] as const;

/** The file's text as a workspace, or undefined when it is not a JSON object. A missing list, secretary or call takes the empty workspace's. */
export function parseOffice(text: string): Workspace | undefined {
  let w: any;
  try {
    w = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!w || typeof w !== 'object' || Array.isArray(w)) return undefined;
  const out = { ...emptyWorkspace(), ...w };
  for (const k of lists) if (!Array.isArray(out[k])) out[k] = [];
  if (!out.secretary || typeof out.secretary !== 'object') out.secretary = emptyWorkspace().secretary;
  if (typeof out.call?.state !== 'string') out.call = { state: 'off' };
  return out;
}

/** Calls `changed` now and whenever the file's text changes. fs.watch is on the directory, since the writer renames a
 * temp file over office.json (a watch on the file itself ends there); the poll covers a directory that does not exist yet. */
export function watchOffice(file: string, changed: (o: Office) => void, pollMs = 1000) {
  let last: string | undefined,
    current: Office = { workspace: emptyWorkspace(), state: 'missing', updated: null },
    watcher: FSWatcher | undefined;
  const check = () => {
    let text = '',
      updated: string | null = null;
    try {
      text = readFileSync(file, 'utf8');
      updated = statSync(file).mtime.toISOString();
    } catch {}
    if (text === last) return;
    last = text;
    const workspace = parseOffice(text);
    current = workspace
      ? { workspace, state: 'file', updated }
      : { workspace: emptyWorkspace(), state: 'missing', updated };
    changed(current);
  };
  check();
  try {
    watcher = watch(dirname(file), (_, name) => {
      if (!name || name === basename(file)) check();
    });
    watcher.on('error', () => watcher?.close());
  } catch {}
  const timer = setInterval(check, pollMs);
  timer.unref();
  return {
    get: () => current,
    close() {
      clearInterval(timer);
      watcher?.close();
    },
  };
}
