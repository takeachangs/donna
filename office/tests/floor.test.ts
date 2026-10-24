import { expect, it } from 'vitest';
import { projectRoom, secretaryRoom, deliveryRoute } from '../apps/web/src/agency/floor';
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
