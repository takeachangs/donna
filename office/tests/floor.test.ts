import { expect, it } from 'vitest';
import {
  phoneButton,
  briefSpot,
  briefed,
  deskCaption,
  donnaLine,
  entranceRoute,
  hired,
  projectRoom,
  secretaryRoom,
  deliveryRoute,
  loungeSpots,
  onTheLine,
  phoneRoute,
  phoneSpot,
} from '../apps/web/src/agency/floor';
it('grows project rooms outward without overlaps or moving existing doorways', () => {
  const rooms = Array.from({ length: 20 }, (_, i) => projectRoom(i, i % 3 === 0 ? 12 : 2));
  for (let i = 0; i < rooms.length; i++)
    for (const b of [...rooms.slice(i + 1), secretaryRoom]) {
      const a = rooms[i];
      expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.z + a.depth <= b.z || b.z + b.depth <= a.z).toBe(true);
    }
  expect(projectRoom(0, 12).x + projectRoom(0, 12).width).toBe(-4);
  expect(projectRoom(1, 12).x).toBe(4);
});
it('routes both wings through their door and common corridor into Donna’s room', () => {
  for (const index of [0, 1, 2, 7]) {
    const room = projectRoom(index),
      home = { x: room.x + 4, z: room.z + 3.75 },
      route = deliveryRoute(room, home);
    expect(route[1].z).toBe(room.z + 5);
    expect(route[2]).toEqual({ x: 0, z: room.z + 5 });
    expect(route.at(-1)).toEqual({ x: 1.5, z: 17.5 });
  }
});
it('puts the call through to a worker with a desk only, and walks them to the phone from the desk or the lounge', () => {
  const ws = [{ id: 'a' }, { id: 'brain', lead: true }];
  expect(onTheLine({ state: 'speaking', with: 'a' }, ws)).toBe('a');
  for (const call of [
    { state: 'off', with: 'a' },
    { state: 'speaking', with: 'donna' },
    { state: 'speaking' },
    { state: 'speaking', with: 'brain' },
    undefined,
  ])
    expect(onTheLine(call, ws)).toBeUndefined();
  const room = projectRoom(0),
    home = { x: room.x + 4, z: room.z + 3.75 };
  for (const route of [phoneRoute(room, home), phoneRoute(room, home, loungeSpots[0])]) {
    expect(route.at(-1)).toEqual(phoneSpot);
    expect(route.at(-2)).toEqual({ x: 0, z: 13 });
  }
  expect(phoneRoute(room, home)[0].z).toBe(home.z);
  expect(phoneRoute(room, home, loungeSpots[0])[0]).toEqual({ x: loungeSpots[0].x, z: loungeSpots[0].z - 1 });
});
it('walks a fresh hire in from the entrance phone to its desk', () => {
  const room = projectRoom(0),
    home = { x: room.x + 4, z: room.z + 3.75 },
    route = entranceRoute(room, home);
  expect(route[0]).toEqual(phoneSpot);
  expect(route[1]).toEqual({ x: 0, z: 13 });
  expect(route.at(-1)).toEqual(home);
  expect(route).toEqual([...phoneRoute(room, home)].reverse().concat(home));
});
it('reads Donna’s line off the lead row, blank without one', () => {
  expect(donnaLine([{ currentAction: 'Write a.py' }, { lead: true, currentAction: ' Hiring Ava and Ben ' }])).toBe(
    'Hiring Ava and Ben',
  );
  for (const ws of [[], [{ lead: true }], [{ lead: true, currentAction: '  ' }], [{ currentAction: 'Write a.py' }]])
    expect(donnaLine(ws)).toBe('');
});
it('captions a desk with the action while the worker works, else its role', () => {
  const w = { role: 'Builder', status: 'working', currentAction: 'Write index.html' };
  expect(deskCaption(w)).toBe('Write index.html');
  expect(deskCaption({ ...w, status: 'done' })).toBe('Builder');
  expect(deskCaption({ ...w, currentAction: undefined })).toBe('Builder');
  expect(deskCaption({ ...w, currentAction: ' ' })).toBe('Builder');
});
it('stands queued workers by Donna, each on its own spot inside her suite', () => {
  expect(briefed({ status: 'queued' })).toBe(true);
  for (const w of [{ status: 'queued', lead: true }, { status: 'working' }, { status: 'done' }])
    expect(briefed(w)).toBe(false);
  const spots = [0, 1, 2, 3].map(briefSpot);
  expect(new Set(spots.map((p) => `${p.x},${p.z}`)).size).toBe(4);
  for (const p of spots) {
    expect(p.x).toBeGreaterThan(secretaryRoom.x);
    expect(p.x).toBeLessThan(secretaryRoom.x + secretaryRoom.width);
    expect(p.z).toBeGreaterThan(secretaryRoom.z);
    expect(p.z).toBeLessThan(secretaryRoom.z + secretaryRoom.depth);
  }
});
it('badges a worker only while its action is the producer’s "Hired: …"', () => {
  expect(hired({ status: 'working', currentAction: 'Hired: Builds the page' })).toBe(true);
  expect(hired({ status: 'working', currentAction: 'Write index.html' })).toBe(false);
  expect(hired({ status: 'done', currentAction: 'Hired: Builds the page' })).toBe(false);
  expect(hired({ status: 'working' })).toBe(false);
});

it('phone button: Call Donna when the phone runs and the line is off, Hang up on a call, disabled without a phone (#75)', () => {
  expect(phoneButton('off', 'armed')).toEqual({ cmd: 'call', key: 'agency.call_donna' });
  for (const s of ['ringing', 'listening', 'thinking', 'speaking'])
    expect(phoneButton(s, 'armed')).toEqual({ cmd: 'hangup', key: 'agency.hang_up' });
  for (const s of ['off', 'speaking']) expect(phoneButton(s, 'absent')).toEqual({ key: 'agency.phone_absent' });
});
