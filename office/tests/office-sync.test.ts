import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { adapt, briefed, briefSpot, deskCaption, donnaLine, hired, lounge, projectRoom, seat, secretaryRoom } from '../apps/web/src/agency/floor';
import type { Workspace } from '../apps/web/src/agency/types';

// office.json after every step of a recorded brain run (delegate, take, hiring note, 2 spawns, worker tools, stops, say,
// spoken), from tests/office_sync.py --snapshots: the producer's timeline, placed by the office's own rules (#65).
type Timeline = { step: string; workspace: Workspace }[];
const load = (f: string): Timeline => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const timeline = load('office-sync.json');
const inSuite = (p: { x: number; z: number }) =>
  p.x >= secretaryRoom.x &&
  p.x <= secretaryRoom.x + secretaryRoom.width &&
  p.z >= secretaryRoom.z &&
  p.z <= secretaryRoom.z + secretaryRoom.depth;

function places(timeline: Timeline) {
  let seats = new Map<string, number>();
  for (const { step, workspace } of timeline) {
    const w = adapt(workspace),
      workers = w.workers.filter((k) => !k.lead);
    seats = seat(workers.filter((k) => !briefed(k)), seats); // as Scene: briefed rows never take a lounge seat
    workers.filter(briefed).forEach((k, i) => {
      expect(inSuite(briefSpot(i)), step).toBe(true);
      expect(k.currentAction, step).toBe('Being briefed');
    });
    for (const k of workers.filter((k) => k.status === 'working')) {
      expect(seats.has(k.id), step).toBe(false); // at a desk
      expect(deskCaption(k), step).toBe(k.currentAction);
    }
    for (const k of workers.filter((k) => k.status === 'done')) expect(seats.has(k.id), step).toBe(true);
    for (const k of w.workers) expect(k.name, step).toBeTruthy(); // every label has a name
    expect(donnaLine(w.workers), step).not.toBe('');
    for (const b of w.briefings) expect(workers.some((k) => k.id === b.workerId && !briefed(k)), step).toBe(true); // adapt: a worker with a desk walks it
  }
}
it('places every snapshot of a recorded run: briefed with Donna, working at desks, done in the lounge, all named', () => {
  places(timeline);
  const rows = timeline.flatMap(({ workspace }) => workspace.workers.filter((k) => !k.lead));
  expect(new Set(rows.map((k) => k.status))).toEqual(new Set(['queued', 'working', 'done']));
  expect(rows.some(hired)).toBe(true);
});

// #83: the same run with a Marketing team hired while the app is built (tests/office_sync.py, office_rooms.jsonl): a second
// project row is a second room (projectRoom(1), across the hall), its workers sit there, the first room is untouched.
it('draws a team as its own room: two rooms working at once, each with its own desks and result', () => {
  const rooms = load('office-sync-rooms.json');
  places(rooms);
  const both = rooms.find(({ workspace }) => {
    const live = workspace.workers.filter((k) => !k.lead && k.status === 'working');
    return new Set(live.map((k) => k.projectId)).size === 2;
  });
  expect(both, 'a step with both rooms working').toBeTruthy();
  const [main, team] = both!.workspace.projects;
  expect(team.name).toBe('Marketing');
  expect(team.id).toBe(`${main.id}#marketing`);
  const hit = (a: { x: number; z: number; width: number; depth: number }, b: typeof a) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.z < b.z + b.depth && b.z < a.z + a.depth;
  for (const r of [projectRoom(0, 2), projectRoom(1, 2)]) expect(hit(r, secretaryRoom) || hit(r, lounge)).toBe(false);
  expect(hit(projectRoom(0, 2), projectRoom(1, 2))).toBe(false);
  const last = rooms.at(-1)!.workspace;
  expect(last.briefings.map((b) => b.projectId).sort()).toEqual([main.id, team.id].sort());
});
