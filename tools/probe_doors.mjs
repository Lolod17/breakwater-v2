import assert from 'node:assert/strict';

try {
  const { on } = await import('../game/src/core/events.js');
  const Doors = await import('../game/src/world/doors.js');
  const { buildLayout } = await import('../game/src/world/layout.js');
  const { CITY } = await import('../game/src/config.js');

  const list = Doors.doors();
  assert.ok(Array.isArray(list) && list.length >= 8, `at least 8 doors registered (got ${list.length})`);

  const layout = buildLayout();
  const ids = new Set();
  const districts = {};
  for (const d of list) {
    assert.ok(typeof d.id === 'string' && d.id.length > 0, 'door has an id');
    assert.ok(!ids.has(d.id), `unique door id ${d.id}`);
    ids.add(d.id);
    assert.ok(Number.isFinite(d.x) && Number.isFinite(d.z), `finite x/z for ${d.id}`);
    assert.ok(Number.isFinite(d.yaw), `finite yaw for ${d.id}`);
    assert.ok(['core', 'midtown', 'waterfront'].includes(d.district), `known district for ${d.id}`);
    assert.ok(typeof d.interior === 'string' && d.interior.length > 0, `interior key for ${d.id}`);
    districts[d.district] = (districts[d.district] || 0) + 1;
    // at a real building front: on the pavement ring, just outside a block's building lot
    assert.equal(layout.groundHeight(d.x, d.z), CITY.kerbH, `${d.id} stands on the pavement`);
    assert.ok(layout.walkable(d.x, d.z), `${d.id} is walkable`);
    const front = layout.blocks.find((b) =>
      d.x >= b.lot.x0 - 1.5 && d.x <= b.lot.x1 + 1.5 && d.z >= b.lot.z0 - 1.5 && d.z <= b.lot.z1 + 1.5 &&
      (d.x < b.lot.x0 || d.x > b.lot.x1 || d.z < b.lot.z0 || d.z > b.lot.z1));
    assert.ok(front, `${d.id} sits just outside a building lot front`);
  }

  // nearestDoor finds each door at its own position
  for (const d of list) {
    const hit = Doors.nearestDoor(d.x, d.z, Doors.doorRadius());
    assert.ok(hit && hit.id === d.id, `nearestDoor finds ${d.id} at its own position`);
  }
  // ...and returns null far away / outside the radius
  assert.equal(Doors.nearestDoor(10000, 10000, 2.2), null, 'far away returns null');
  assert.equal(Doors.nearestDoor(list[0].x, list[0].z, 0), null, 'zero radius returns null');
  const edge = Doors.nearestDoor(list[0].x + 3, list[0].z, 2.2);
  assert.equal(edge, null, '3 m away with radius 2.2 returns null');

  // deterministic for the game seed
  assert.deepEqual(Doors.init(1337), list, 'same seed rebuilds the same registry');

  // door:inRange is edge-triggered through core/events.js
  const events = [];
  on('door:inRange', (p) => events.push(p));
  const d0 = list[0];
  const r = Doors.doorRadius();
  Doors.track(d0.x + r + 5, d0.z);
  assert.equal(events.length, 0, 'outside every radius: no event');
  Doors.track(d0.x, d0.z);
  assert.equal(events.length, 1, 'entering a radius emits door:inRange');
  assert.equal(events[0].id, d0.id, 'event carries the door id');
  assert.equal(events[0].interior, d0.interior, 'event carries the interior key');
  Doors.track(d0.x + 0.5, d0.z);
  assert.equal(events.length, 1, 'staying inside does not re-emit');
  Doors.track(d0.x + r + 5, d0.z);
  Doors.track(d0.x, d0.z);
  assert.equal(events.length, 2, 'leaving and re-entering emits again');

  console.log(JSON.stringify({ doors: list.length, districts, events: events.length, sample: list[0], pass: true }));
  process.exit(0);
} catch (e) {
  console.error(JSON.stringify({ pass: false, failed: e.message }));
  process.exit(1);
}
