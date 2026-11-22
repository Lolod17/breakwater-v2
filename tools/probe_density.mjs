// Node 22 stdlib + raw CDP; all measurements use the real fixed-step simulation.
import assert from 'node:assert/strict';
import { launch, startServer, watchPage } from './cdp.mjs';

const server = await startServer(8093);
const page = await launch({ headless: !process.argv.includes('--headed'), port: 9437 });
const watch = watchPage(page, new URL(server.url).host);
const points = [[32.2, 150], [-112.5, -160], [127.5, -65], [150, 217], [-60, 290]];
try {
  await page.goto(`${server.url}?autostart&seed=1337`);
  await page.waitFor(() => page.evaluate('!!window.__game?.ready'), 60000);
  const baseline = await page.evaluate('window.__game.population()');
  for (const [x, z] of points) {
    const result = await page.evaluate(`(() => {
      const g = window.__game;
      g.teleport(${x}, ${z});
      let minPeds = Infinity, minVehicles = Infinity, minMovingPeds = Infinity, minOnScreen = Infinity, minBestView = Infinity;
      const violations = [];
      let pedContacts = 0, vehicleContacts = 0;
      for (let i = 0; i < 10; i++) {
        const s = g.advance(0.5);
        minPeds = Math.min(minPeds, s.peds.filter(p => Math.hypot(p.x-(${x}), p.z-(${z})) <= 50).length);
        // PASS 17: the pool always sits within 43 m of the player, so peds50 is 18 by construction.
        // What a player sees is live, walking people in view: count those too.
        minMovingPeds = Math.min(minMovingPeds, s.peds.filter(p => p.hp > 0 && p.speed > 0.3 && Math.hypot(p.x-(${x}), p.z-(${z})) <= 50).length);
        minOnScreen = Math.min(minOnScreen, s.peds.filter(p => p.hp > 0 && p.onScreen).length);
        // the staged camera always faces south (at the waterfront: the water), so also take the best
        // of 8 headings from the same eye: live people in clear sight inside that view cone
        let best = 0;
        for (let k = 0; k < 8; k++) {
          const h = k * Math.PI / 4;
          best = Math.max(best, s.peds.filter(p => {
            if (!(p.hp > 0 && p.los)) return false;
            const b = Math.atan2(p.x - s.camera.x, p.z - s.camera.z) - h;
            return Math.abs(Math.atan2(Math.sin(b), Math.cos(b))) < s.camera.hfov / 2;
          }).length);
        }
        minBestView = Math.min(minBestView, best);
        minVehicles = Math.min(minVehicles, s.vehicles.filter(v => v.ai && v.speed > 0.7 && Math.hypot(v.x-(${x}), v.z-(${z})) <= 120).length);
        for (const [kind, list] of [['ped', s.peds], ['vehicle', s.vehicles]]) for (const e of list) {
          if (kind === 'ped' && !g.walkable(e.x, e.z)) violations.push({ kind, id: e.id, reason: 'outside walkable ground' });
          if (s.boxes.some(b => e.x > b.x0 && e.x < b.x1 && e.z > b.z0 && e.z < b.z1 && e.y + 0.5 > b.y0 && e.y < b.y1)) violations.push({ kind, id: e.id, reason: 'building' });
          if (Math.abs(e.y - g.ground(e.x, e.z)) > 0.18) violations.push({ kind, id: e.id, reason: 'ground', y: e.y });
        }
        for (const p of s.props.filter(p => Math.hypot(p.x-(${x}), p.z-(${z})) < 60)) {
          if (s.boxes.some(b => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1 && p.y + 0.1 > b.y0 && p.y < b.y1)) violations.push({ kind: p.kind, reason: 'building' });
          if (Math.abs(p.y - g.ground(p.x, p.z)) > 0.18) violations.push({ kind: p.kind, reason: 'ground' });
        }
        for (let a = 0; a < s.peds.length; a++) for (let b = a+1; b < s.peds.length; b++) {
          if (Math.hypot(s.peds[a].x - s.peds[b].x, s.peds[a].z - s.peds[b].z) < 0.47) pedContacts++;
        }
        for (let a = 0; a < s.vehicles.length; a++) for (let b = a+1; b < s.vehicles.length; b++) {
          const A = s.vehicles[a], B = s.vehicles[b];
          if (A.circles.some(ca => B.circles.some(cb => Math.hypot(A.x+Math.sin(A.yaw)*ca-B.x-Math.sin(B.yaw)*cb, A.z+Math.cos(A.yaw)*ca-B.z-Math.cos(B.yaw)*cb) < A.radius+B.radius-0.08))) vehicleContacts++;
        }
      }
      const s = g.population();
      return { point: [${x},${z}], seconds: 5, peds50: minPeds, movingPeds50: minMovingPeds, pedsOnScreen: minOnScreen, pedsBestView: minBestView, movingVehicles120: minVehicles,
        props60: s.props.filter(p => Math.hypot(p.x-(${x}), p.z-(${z})) <= 60).length,
        violations: violations.length, details: violations.slice(0, 5), pedContacts, vehicleContacts, active: { peds: s.peds.length, vehicles: s.vehicles.length } };
    })()`);
    console.log(JSON.stringify(result));
    assert(result.peds50 >= 8 && result.movingPeds50 >= 8 && result.pedsBestView >= 3 && result.movingVehicles120 >= 6 && result.props60 >= 12 && result.violations === 0 && result.pedContacts === 0 && result.vehicleContacts === 0, 'density/placement target');
  }
  const lifecycle = await page.evaluate(`(() => {
    const g = window.__game;
    for (let i = 0; i < 12; i++) { g.teleport(32.2, 150, true); g.advance(5); }
    let minPeds50 = Infinity, minMoving120 = Infinity;
    for (let i = 0; i < 36; i++) {
      const s = g.advance(5);
      minPeds50 = Math.min(minPeds50, s.peds.filter(p => Math.hypot(p.x-32.2,p.z-150)<50).length);
      minMoving120 = Math.min(minMoving120, s.vehicles.filter(v => v.ai && v.speed>0.7 && Math.hypot(v.x-32.2,v.z-150)<120).length);
    }
    const before = g.population();
    g.teleport(32.2, 150, true); g.advance(5);
    const after = g.population();
    g.gunfire(); g.advance(0.5);
    const gunfire = g.population().peds.filter(p => p.flee > 0).length;
    g.chase(true); g.advance(0.5);
    const chase = g.population().peds.filter(p => p.flee > 0).length;
    g.chase(false);
    return { test: 'lifecycle', simulatedSeconds: 245, before: { peds: before.peds.length, vehicles: before.vehicles.length },
      after: { peds: after.peds.length, vehicles: after.vehicles.length }, minPeds50, minMoving120, resourcesBefore: before.resources, resources: after.resources, gunfireReacted: gunfire, chaseReacted: chase };
  })()`);
  console.log(JSON.stringify(lifecycle));
  assert.equal(lifecycle.after.peds, baseline.peds.length);
  assert.equal(lifecycle.after.vehicles, baseline.vehicles.length);
  assert(lifecycle.gunfireReacted > 0 && lifecycle.chaseReacted > 0);
  assert(lifecycle.minPeds50 >= 8 && lifecycle.minMoving120 >= 6);
  assert.deepEqual(lifecycle.resources, lifecycle.resourcesBefore);
  assert.equal(watch.errors.length, 0);
  assert.equal(watch.offsite.length, 0);
  console.log(JSON.stringify({ consoleErrors: watch.errors.length, offsiteRequests: watch.offsite.length, pass: true }));
} finally {
  await page.close(); server.stop();
}
