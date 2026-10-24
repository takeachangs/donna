import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { adapt, briefed, briefSpot, deskCaption, donnaLine, hired, seat, secretaryRoom } from '../apps/web/src/agency/floor';
import type { Workspace } from '../apps/web/src/agency/types';

// office.json after every step of a recorded brain run (delegate, take, hiring note, 2 spawns, worker tools, stops, say,
// spoken), from tests/office_sync.py --snapshots: the producer's timeline, placed by the office's own rules (#65).
const timeline: { step: string; workspace: Workspace }[] = JSON.parse(
  readFileSync(new URL('./fixtures/office-sync.json', import.meta.url), 'utf8'),
);
const inSuite = (p: { x: number; z: number }) =>
  p.x >= secretaryRoom.x &&
  p.x <= secretaryRoom.x + secretaryRoom.width &&
  p.z >= secretaryRoom.z &&
  p.z <= secretaryRoom.z + secretaryRoom.depth;

it('places every snapshot of a recorded run: briefed with Donna, working at desks, done in the lounge, all named', () => {
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
  const rows = timeline.flatMap(({ workspace }) => workspace.workers.filter((k) => !k.lead));
  expect(new Set(rows.map((k) => k.status))).toEqual(new Set(['queued', 'working', 'done']));
  expect(rows.some(hired)).toBe(true);
});
