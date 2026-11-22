// Police probe: force wanted 3 on the seeded hero-car drive, run the real
// simulation for 20 s at fixed 60 Hz, then hide one block away and measure how
// long the units take to lose the chase.
//   node tools/probe_police.mjs
// Reports: units spawned, distance to player over time (every 2 s, plus per-unit
// minimum), frames where any cruiser body overlaps a wall or a kerb slab (checked
// every tick after collision resolution), how often the cruiser hard-stop had to
// roll a move back, three-point turns, and chase-loss time.
// Targets: penetrations 0, >= 2 units pursuing, chase lost <= 45 s after hiding.
import { launch, startServer, watchPage } from './cdp.mjs';

const server = await startServer(8092);
const page = await launch({ port: 9334 });
const watch = watchPage(page, new URL(server.url).host);
try {
  await page.goto(`${server.url}?autostart&seed=1337`);
  await page.waitFor(() => page.evaluate('window.__game?.ready'), 60000);
  const result = await page.evaluate(`(async () => {
    const g = window.__game;
    await g.stage({car: {use: 'hero', x: 38.25, z: 150, yaw: 0, speed: 11, cruise: 15, route: [[40, 120], [40, 200]]}});
    g.forceWanted(3);
    const distances = [], spawned = new Set(), pursuing = new Set(), minDistance = {};
    let wallFrames = 0, kerbFrames = 0, concurrent = 0, status;
    const step = () => {
      status = g.probeStep();
      wallFrames += +status.units.some(u => u.wall);
      kerbFrames += +status.units.some(u => u.kerb);
      for (const u of status.units) {
        spawned.add(u.id);
        minDistance[u.id] = Math.min(minDistance[u.id] ?? Infinity, +u.distance.toFixed(1));
      }
    };
    for (let tick = 1; tick <= 1200; tick++) {
      step();
      const active = status.units.filter(u => ['pursue', 'intercept'].includes(u.state));
      active.forEach(u => pursuing.add(u.id));
      concurrent = Math.max(concurrent, active.length);
      if (tick % 120 === 0) {
        const p = g.player();
        distances.push({ t: tick / 60, at: [+p.x.toFixed(1), +p.z.toFixed(1)],
          units: status.units.map(u => [u.id, +u.distance.toFixed(1), u.state]) });
      }
    }
    const beforeHide = { level: status.wanted, seen: status.seen, incident: status.incident };
    // Hide: stop on foot at the nearest pavement spot 45-110 m away (one block over)
    // that no unit can see now, nor from any road point within 70 m of a unit
    // (so a cruiser rolling on along its street does not simply drive into view).
    // Police keep their state and last sighting.
    const p = g.player(), S = [-200, -120, -40, 40, 120, 200], spots = [], road = [];
    for (const s of S) for (const k of [-7.5, 7.5]) for (let m = -190; m <= 190; m += 10) spots.push([s + k, m], [m, s + k]);
    for (const s of S) for (let m = -200; m <= 200; m += 5) road.push([s, m], [m, s]);
    const cars = g.vehicles().filter(v => status.units.some(u => u.id === v.id));
    const watched = road.filter(([x, z]) => cars.some(c => Math.hypot(c.x - x, c.z - z) < 70));
    const hide = spots.map(([x, z]) => ({ x, z, d: Math.hypot(x - p.x, z - p.z) }))
      .filter(o => o.d > 45 && o.d < 110 && g.walkable(o.x, o.z) && !g.exposed(o.x, o.z)
        && !watched.some(([x, z]) => g.sightline(x, z, o.x, o.z)))
      .sort((a, b) => a.d - b.d)[0];
    g.teleport(hide.x, hide.z);
    let lostChaseSeconds = null, clearedSeconds = null, seenWhileHidden = 0;
    for (let tick = 1; tick <= 2700; tick++) {
      step();
      seenWhileHidden += +status.seen;
      if (lostChaseSeconds === null && status.units.every(u => ['lose', 'return', 'patrol'].includes(u.state))) lostChaseSeconds = +(tick / 60).toFixed(2);
      if (!status.wanted) { clearedSeconds = +(tick / 60).toFixed(2); break; }
    }
    return { forced: 3, chaseSeconds: 20, unitsSpawned: spawned.size, pursuing: pursuing.size, concurrent, distances, minDistance,
      turnabouts: status.units.map(u => [u.id, u.turnabouts]),
      // substeps where a cruiser's move would have overlapped a wall or kerb and was
      // rolled back to its last clear pose (the mechanism that keeps penetrations at 0)
      hardStops: status.units.map(u => [u.id, u.hardStops]),
      beforeHide, hiddenAt: [hide.x, hide.z], hideDistance: +hide.d.toFixed(1), seenWhileHiddenFrames: seenWhileHidden,
      lostChaseSeconds, clearedSeconds, wallFrames, kerbFrames,
      states: status.units.map(u => u.states), end: { wanted: status.wanted, seen: status.seen, incident: status.incident } };
  })()`);
  const pass = result.unitsSpawned >= 2 && result.concurrent >= 2 && result.beforeHide.level > 0 && !result.beforeHide.incident
    && result.wallFrames === 0 && result.kerbFrames === 0 && result.lostChaseSeconds !== null && result.lostChaseSeconds <= 45
    && result.clearedSeconds !== null && !result.end.incident && !watch.errors.length && !watch.offsite.length;
  console.log(JSON.stringify({ ...result, consoleErrors: watch.errors.length, offsiteRequests: watch.offsite.length, pass }));
  if (!pass) process.exitCode = 1;
} finally {
  await page.close();
  server.stop();
}
