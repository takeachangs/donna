export type Point = { x: number; z: number };
export type Footprint = {
  x: number;
  z: number;
  width: number;
  depth: number;
  side: 'left' | 'right' | 'secretary' | 'lounge';
};
export const secretaryRoom: Footprint = { x: -4, z: 12, width: 8, depth: 9, side: 'secretary' };
export const secretaryPosition: Point = { x: -1.6, z: 17.65 };
export function projectRoom(index: number, workers = 0): Footprint {
  const row = Math.floor(index / 2),
    left = index % 2 === 0;
  // Expand outwards for more desks; the shared corridor and existing doors stay put.
  const width = Math.max(10, Math.ceil(workers / 2) * 2.8 + 2);
  return { x: left ? -4 - width : 4, z: -row * 12, width, depth: 10, side: left ? 'left' : 'right' };
}
export function deliveryRoute(room: Footprint, home: Point): Point[] {
  const edge = room.side === 'left' ? room.x + room.width - 1 : room.x + 1;
  return [
    { x: edge, z: home.z },
    { x: edge, z: room.z + 5 },
    { x: 0, z: room.z + 5 },
    { x: 0, z: 11 },
    { x: 0, z: 13 },
    { x: 1.5, z: 13 },
    { x: 1.5, z: 17.5 },
  ];
}
/** East of Donna's suite, same z band; its door (north wall, x 4.1–6.5) faces the end of the hall. Constant, so project rooms never move. */
export const lounge: Footprint = { x: 4, z: 12, width: 8, depth: 9, side: 'lounge' };
export type LoungeSpot = Point & { face: Point; pose: 'sit' | 'sip' | 'idle' };
// Fill order: couch, coffee machine, couch, water cooler, couch, standing by the TV. World coordinates.
export const loungeSpots: LoungeSpot[] = [
  { x: 8.45, z: 16.15, face: { x: 8.45, z: 12 }, pose: 'sit' },
  { x: 10.75, z: 18.4, face: { x: 11.6, z: 18.3 }, pose: 'sip' },
  { x: 10.15, z: 16.15, face: { x: 10.15, z: 12 }, pose: 'sit' },
  { x: 10.7, z: 20.2, face: { x: 11.45, z: 20.2 }, pose: 'sip' },
  { x: 9.3, z: 16.15, face: { x: 9.3, z: 12 }, pose: 'sit' },
  { x: 11.2, z: 14.2, face: { x: 9.3, z: 12.2 }, pose: 'idle' },
];
/** Hall end → lounge door → just in front of the spot → the spot. */
export function loungeLeg(s: Point): Point[] {
  return [{ x: 5.3, z: 11 }, { x: 5.3, z: 13 }, { x: s.x, z: s.z - 1 }, s];
}
/** Desk to a lounge spot; the walk back is this reversed minus the spot, plus home. */
export function loungeRoute(room: Footprint, home: Point, s: Point): Point[] {
  return [...deliveryRoute(room, home).slice(0, 4), ...loungeLeg(s)];
}
/** From where a delivering worker stands at Donna's desk (last point of deliveryRoute, {x:1.5,z:17.5}) to a lounge spot. */
export function afterReport(s: Point): Point[] {
  return [{ x: 1.5, z: 13 }, { x: 0, z: 13 }, { x: 0, z: 11 }, ...loungeLeg(s)];
}
type Who = { id: string; projectId: string; status: string; lead?: boolean };
type Work = { projectId: string; status: string };
/** On a break: not a lead, own work delivered (status 'review' or 'done'), and no assignment in the same project is still open ('queued'|'working'|'waiting'). Project-wide on purpose: the team rests once the lead's review is done, so the reporter walks desk → Donna → lounge. */
export function resting(w: Who, assignments: Work[]): boolean {
  return (
    !w.lead &&
    (w.status === 'review' || w.status === 'done') &&
    !assignments.some(
      (a) => a.projectId === w.projectId && (a.status === 'queued' || a.status === 'working' || a.status === 'waiting'),
    )
  );
}
/** Next lounge seating (worker id → index into loungeSpots). Entries for ids NOT in `workers` are kept untouched (they are walking or about to report). Listed workers that are no longer resting lose their entry. Listed resting workers without an entry take the lowest free index; if all 6 are taken they get none (they stay at their desk). Returns a new Map; never mutates `current`. */
export function seat(workers: Who[], assignments: Work[], current: Map<string, number>): Map<string, number> {
  const out = new Map(current);
  for (const w of workers) {
    if (!resting(w, assignments)) {
      out.delete(w.id);
      continue;
    }
    if (out.has(w.id)) continue;
    // ponytail: a 7th resting worker gets no seat and stays at the desk; add standing spots if teams get bigger.
    const taken = new Set(out.values()),
      i = loungeSpots.findIndex((_, k) => !taken.has(k));
    if (i >= 0) out.set(w.id, i);
  }
  return out;
}
/** Walking speed (units/s) of every trip; errand meet-ups time against it. */
export const pace = 13;
/** A voice tool call that concerns a room or a worker: the server's `tool_started`. */
export type ToolCall = { callId: string; name: string; projectId?: string; workerId?: string };
/** A worker on the floor. free: its body is at its desk (no trip, no lounge seat), so it can get up. */
export type Desk = { id: string; projectId: string; home: Point; free: boolean };
/** Donna's walk for one tool call. points: from her desk outward; face: where she looks on arrival. meet: the worker who gets up, walks its points (none = stands up at the desk) after wait seconds so both arrive together, then looks at face. glow: reduced motion, light the room instead. note: delegate/create hand a note over. */
export type Errand = {
  room: string;
  points: Point[];
  face?: Point;
  glow?: true;
  note?: true;
  meet?: { id: string; points: Point[]; wait: number; face: Point };
};
/** The call's room is projectId, else the worker's room; undefined when it is not on the floor. message_worker: in front of that worker's desk, the worker turns round. Otherwise the doorway, where the named worker, else the free worker nearest the door, comes to meet her; a delegate/create note into a room with no workers goes to its empty desk. */
export function errand(
  call: ToolCall,
  rooms: (Footprint & { id: string })[],
  desks: Desk[],
  reduce: boolean,
): Errand | undefined {
  const worker = desks.find((d) => d.id === call.workerId),
    room = rooms.find((r) => r.id === (call.projectId ?? worker?.projectId));
  if (!room) return undefined;
  if (reduce) return { room: room.id, points: [], glow: true };
  const left = room.side === 'left',
    wall = left ? room.x + room.width : room.x,
    doorZ = room.z + 5,
    edge = left ? wall - 1 : wall + 1,
    door = { x: left ? wall + 1 : wall - 1, z: doorZ };
  const out = [
      { x: -0.3, z: 17.65 },
      { x: -0.3, z: 13 },
      { x: 0, z: 11 },
      { x: 0, z: doorZ },
    ],
    note = call.name === 'delegate_work' || call.name === 'create_project' ? { note: true as const } : {};
  const toDesk = (h: Point) => {
    const stand = { x: h.x, z: h.z + 0.9 };
    return { stand, points: [...out, { x: edge, z: doorZ }, { x: edge, z: stand.z }, stand], face: h };
  };
  if (call.name === 'message_worker' && worker) {
    const { stand, points, face } = toDesk(worker.home);
    return {
      room: room.id,
      points,
      face,
      ...(worker.free
        ? { meet: { id: worker.id, points: [], wait: len([secretaryPosition, ...points]) / pace, face: stand } }
        : {}),
      ...note,
    };
  }
  if (note.note && !desks.some((d) => d.projectId === room.id)) {
    const { points, face } = toDesk({ x: room.x + room.width / 2, z: room.z + 3 + 1.65 });
    return { room: room.id, points, face, ...note };
  }
  const points = [...out, door],
    free = desks.filter((d) => d.projectId === room.id && d.free),
    gap = (d: Desk) => Math.hypot(d.home.x - edge, d.home.z - doorZ);
  const m =
    free.find((d) => d.id === call.workerId) ??
    free.reduce<Desk | undefined>((b, d) => (!b || gap(d) < gap(b) ? d : b), undefined);
  const mp = m && [
    { x: edge, z: m.home.z },
    { x: edge, z: doorZ },
  ];
  return {
    room: room.id,
    points,
    face: { x: edge, z: doorZ },
    ...(m && mp
      ? {
          meet: {
            id: m.id,
            points: mp,
            wait: Math.max(0, (len([secretaryPosition, ...points]) - len([m.home, ...mp])) / pace),
            face: door,
          },
        }
      : {}),
    ...note,
  };
}
const len = (p: Point[]) => p.reduce((s, q, i) => (i ? s + Math.hypot(q.x - p[i - 1].x, q.z - p[i - 1].z) : 0), 0);
/** Turn back where she is: she is at or heading to points[index], so retrace points[index-1]…points[0], then home (index 0: just home). */
export function turnBack(points: Point[], index: number, home: Point): Point[] {
  return [...points.slice(0, index)].reverse().concat(home);
}
/** The next call to walk: queued calls that already finished are stale and dropped. Returns it and the rest of the queue. */
export function nextCall(queue: ToolCall[], finished: Set<string>): [ToolCall | undefined, ToolCall[]] {
  const q = queue.filter((c) => !finished.has(c.callId));
  return [q[0], q.slice(1)];
}
