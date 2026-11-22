// PASS 17 review probe: one measurement per defect found in the review, each
// through the real game code (real key events, real fixed steps, real meshes).
//   node tools/probe_review.mjs
// Sections:
//   carjack   - steal a responding police cruiser with the real F key. Does the
//               stolen car stay a police unit that "sees" its own driver?
//   track     - TrafficDriver._track from every 4 m of the map, 6 legs each:
//               does it ever need more than one reseat (the old unbounded loop)?
//   alloc     - sampled JS heap allocation over 10 simulated seconds on the
//               avenue, top call sites (bytes per simulated second).
//   gait      - pedestrian legs: hip detachment (leg top vs hip socket), stance
//               foot slip (m/s of the planted shoe), idle peds that move at all.
//   siren     - a responding cruiser's own model light bar is lit (lamps.siren),
//               and the count of extra floating light-bar meshes.
//   hud       - district label at the jetty / waterfront / avenue, minimap present.
import { launch, startServer, watchPage } from './cdp.mjs';

const server = await startServer(8094);
const page = await launch({ port: 9338 });
const watch = watchPage(page, new URL(server.url).host);
const out = {};
try {
  await page.goto(`${server.url}?autostart&seed=1337`);
  await page.waitFor(() => page.evaluate('!!window.__game?.ready'), 60000);

  // ---------------------------------------------------------------- carjack
  out.carjack = await page.evaluate(`(() => {
    const g = window.__game;
    g.teleport(32.2, 150, true);
    g.forceWanted(1);
    let s, unit, car, t = 0;
    for (; t < 60 * 30; t++) {
      s = g.probeStep();
      unit = s.units[0];
      car = unit && g.population().vehicles.find(v => v.id === unit.id);
      if (car && unit.distance < 30 && car.speed < 1.5 && ['pursue', 'intercept'].includes(unit.state)) break;
    }
    if (!car) return { error: 'no unit arrived' };
    // stand at the driver door (+x side in car space) and press the real F key
    const off = car.radius + 0.5;
    const x = car.x + Math.cos(car.yaw) * off, z = car.z - Math.sin(car.yaw) * off;
    g.teleport(x, z);
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
    dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF' }));
    for (let i = 0; i < 40; i++) s = g.probeStep();
    const p = g.player();
    const stolenId = car.id;
    const inStolen = p.driving && g.vehicleIdOfPlayer() === stolenId;
    const asUnit = s.units.find(u => u.id === stolenId);
    // sit still in the stolen car for 40 s: who keeps seeing us?
    let seenFrames = 0, ownSees = 0;
    for (let i = 0; i < 60 * 40; i++) {
      s = g.probeStep();
      seenFrames += +s.seen;
      ownSees += +!!s.units.find(u => u.id === stolenId && u.sees);
    }
    return { stolenId, inStolen, stillPoliceUnitAfterTheft: !!asUnit, unitStateAfterTheft: asUnit?.state ?? null,
      ownCarSeesDriverFrames: ownSees, seenFrames40s: seenFrames, wantedAfter40s: s.wanted, heatAfter40s: +s.heat.toFixed(1),
      units: s.units.map(u => [u.id, u.state]) };
  })()`);

  // ---------------------------------------------------------------- track
  out.track = await page.evaluate(`(async () => {
    const { TrafficDriver, allStreets } = await import('/src/vehicles/traffic.js');
    const legs = allStreets();
    let calls = 0, multiReseat = 0, maxReseats = 0, worst = null;
    const t0 = performance.now();
    for (let x = -260; x <= 260; x += 4) for (let z = -260; z <= 300; z += 4) {
      for (let k = 0; k < 6; k++) {
        const [A, B] = legs[(Math.abs(x * 7 + z * 13) + k * 37) % legs.length];
        const v = { x, z, yaw: 0, speed: 0, vx: 0, vz: 0, fwd: 0 };
        const d = new TrafficDriver(v, { int: (a) => a, float: () => 0 }, A, B, {});
        let reseats = 0;
        const orig = d._reseat.bind(d);
        d._reseat = () => { reseats++; if (reseats > 4) throw new Error('loop'); orig(); };
        try { d._track(5); } catch (e) { reseats = Infinity; }
        calls++;
        if (reseats > 1) multiReseat++;
        if (reseats > maxReseats) { maxReseats = reseats; worst = { x, z, leg: [A.x, A.z, B.x, B.z] }; }
      }
    }
    return { calls, multiReseat, maxReseats: maxReseats === Infinity ? 'unbounded' : maxReseats, worst, ms: Math.round(performance.now() - t0) };
  })()`);

  // ---------------------------------------------------------------- alloc
  await page.evaluate('window.__game.teleport(32.2, 150, true), window.__game.advance(2), 0');
  await page.send('HeapProfiler.enable');
  await page.send('HeapProfiler.collectGarbage');
  await page.send('HeapProfiler.startSampling', { samplingInterval: 4096 });
  await page.evaluate('window.__game.advance(10), 0');
  const { profile } = await page.send('HeapProfiler.stopSampling');
  const sites = new Map();
  let total = 0;
  const walk = (n) => {
    const self = n.selfSize;
    total += self;
    if (self) {
      const f = n.callFrame;
      const k = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`;
      sites.set(k, (sites.get(k) || 0) + self);
    }
    for (const c of n.children) walk(c);
  };
  walk(profile.head);
  out.alloc = { simulatedSeconds: 10, kbPerSimSecond: Math.round(total / 1024 / 10),
    top: [...sites].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, b]) => [k, Math.round(b / 1024 / 10) + ' KB/s']) };

  // ---------------------------------------------------------------- gait
  out.gait = await page.evaluate(`(() => {
    const g = window.__game;
    g.teleport(-112.5, -160, true);
    g.advance(1);
    const scene = window.__scene;
    const find = (n) => { let m; scene.traverse(o => { if (o.name === n) m = o; }); return m; };
    const legs = find('pedestrian-thighs'), shoes = find('pedestrian-shoes'), pelvis = find('pedestrian-pelvis');
    const M = new (legs.matrixWorld.constructor)();
    const V = legs.position.constructor;
    const top = new V(), foot = new V();
    let detach = 0, slipSum = 0, slipN = 0, idleMoved = 0, idleN = 0;
    let prevShoe = null, prevIdle = null;
    for (let f = 0; f < 120; f++) {
      const pop = g.advance(1 / 60);
      const shoe = [], idleSig = [];
      pop.peds.forEach((p, i) => {
        const s = p.height / 1.72;
        for (let side = 0; side < 2; side++) {
          const sign = side ? 1 : -1;
          // hip socket on the pelvis batch vs the thigh's origin (the hip joint) - PASS 6e jointed rig
          pelvis.getMatrixAt(i, M);
          foot.set(sign * 0.095, 0, 0).applyMatrix4(M);
          const hipX = foot.x, hipY = foot.y, hipZ = foot.z;
          legs.getMatrixAt(i * 2 + side, M);
          top.set(0, 0, 0).applyMatrix4(M);
          if (p.speed > 0.3) detach = Math.max(detach, Math.hypot(top.x - hipX, top.y - hipY, top.z - hipZ));
          shoes.getMatrixAt(i * 2 + side, M);
          foot.set(0, -0.075, 0.13).applyMatrix4(M); // ball of the foot: the contact the heel peels around
          shoe.push([foot.x, foot.y, foot.z, p.speed]);
        }
        legs.getMatrixAt(i * 2, M);
        idleSig.push(p.speed < 0.15 && p.hp > 0 ? M.elements.slice() : null);
      });
      if (prevShoe) {
        for (let i = 0; i < shoe.length; i += 2) {
          if (shoe[i][3] < 0.5) continue;
          // the lower of the two shoes is the stance foot
          const k = shoe[i][1] <= shoe[i + 1][1] ? i : i + 1;
          slipSum += Math.hypot(shoe[k][0] - prevShoe[k][0], shoe[k][2] - prevShoe[k][2]) * 60; slipN++;
        }
        idleSig.forEach((m, i) => { if (m && prevIdle[i]) { idleN++; if (m.some((e, j) => Math.abs(e - prevIdle[i][j]) > 1e-5)) idleMoved++; } });
      }
      prevShoe = shoe; prevIdle = idleSig;
    }
    return { hipDetachMaxM: +detach.toFixed(3), stanceFootSlipMs: +(slipSum / Math.max(1, slipN)).toFixed(3),
      idleFramesAnimated: idleN ? +(idleMoved / idleN).toFixed(2) : null, idleSamples: idleN };
  })()`);

  // ---------------------------------------------------------------- siren
  out.siren = await page.evaluate(`(() => {
    const g = window.__game;
    g.teleport(32.2, 150, true);
    g.forceWanted(2);
    let s;
    for (let i = 0; i < 60 * 6; i++) s = g.probeStep();
    g.advance(1 / 60);
    const lit = g.sirenLamps();
    let floating = 0;
    // PASS 4 drew a second, floating bar (red/blue glow boxes) above each responding cruiser.
    window.__scene.traverse(o => { if (o.isMesh && !o.isInstancedMesh && o.material?.color && o.material.color.r === 5 && Math.abs(o.material.color.g - 0.025) < 1e-6 && o.parent?.visible) floating++; });
    return { responding: s.units.filter(u => u.state !== 'patrol').length, modelBarLit: lit, floatingBars: floating };
  })()`);

  // ---------------------------------------------------------------- hud
  out.hud = await page.evaluate(`(async () => {
    const g = window.__game, r = {};
    const wait = () => new Promise(res => setTimeout(res, 300));   // the HUD text refreshes every 250 ms
    for (const [name, x, z] of [['jetty', -60, 280], ['waterfront', 150, 217], ['avenue', 32.2, 150]]) {
      g.teleport(x, z, true); await wait(); g.probeStep({ steps: 2, drawFrame: true });
      r[name] = document.getElementById('district').textContent;
    }
    const mm = document.getElementById('minimap');
    r.minimap = !!mm && !mm.hidden && mm.width > 0;
    if (r.minimap) {
      const d = mm.getContext('2d').getImageData(0, 0, mm.width, mm.height).data;
      let drawn = 0; for (let i = 3; i < d.length; i += 4) drawn += d[i] > 0;
      r.minimapDrawnPixels = drawn;
    }
    return r;
  })()`);
  // ---------------------------------------------------------------- behind
  // camera -> pedestrian -> player, aim along that line: can the shot hit the
  // pedestrian standing behind the shooter (between them and the camera)?
  out.behind = await page.evaluate(`(() => {
    const g = window.__game, res = [];
    for (const [x, z] of [[32.2, 150], [-112.5, -160], [127.5, -65], [150, 217]]) {
      g.teleport(x, z, true);
      const me = g.player(), chest = { x: me.x, y: me.y + 1.42, z: me.z };
      const p = g.population().peds.filter(p => p.hp).map(p => ({ ...p, d: Math.hypot(p.x - me.x, p.z - me.z) }))
        .filter(p => p.d > 1.5 && p.d < 9 && g.aimClear(p.x, p.y + p.height * 0.72, p.z)).sort((a, b) => a.d - b.d)[0];
      if (!p) { res.push({ at: [x, z], ped: null }); continue; }
      const bx = p.x - me.x, bz = p.z - me.z, l = Math.hypot(bx, bz);
      const from = { x: p.x + bx / l * 1.5, y: p.y + p.height * 0.72 + 0.2, z: p.z + bz / l * 1.5 };
      const dx = chest.x - from.x, dy = chest.y - from.y, dz = chest.z - from.z, dl = Math.hypot(dx, dy, dz);
      const s = g.probeStep({ shotFrom: { from, dir: { x: dx / dl, y: dy / dl, z: dz / dl } }, steps: 0 });
      res.push({ at: [x, z], ped: p.id, behindBy: +p.d.toFixed(2), hit: s.combat.lastShot });
    }
    return { trials: res.length, hitBehind: res.filter(r => r.hit?.kind === 'pedestrian' && r.hit.id === r.ped).length, res };
  })()`);

  // ---------------------------------------------------------------- stale sighting
  // wanted clears (here: forced to 0); does the old sighting survive to steer the next response?
  out.stale = await page.evaluate(`(() => {
    const g = window.__game;
    g.teleport(32.2, 150, true); g.forceWanted(2);
    let s; for (let i = 0; i < 60 * 15 && !(s = g.probeStep()).lastSeen; i++);
    const seenAt = s.lastSeen;
    g.forceWanted(0); s = g.probeStep({ steps: 2 });
    return { sightingBeforeClear: seenAt && [+seenAt.x.toFixed(1), +seenAt.z.toFixed(1)], lastSeenAfterClear: s.lastSeen ?? null };
  })()`);

  out.consoleErrors = watch.errors.length;
  out.offsiteRequests = watch.offsite.length;
  if (watch.errors.length) out.errors = watch.errors.slice(0, 5);
} catch (e) {
  out.error = String(e.message || e);
  out.errors = watch.errors.slice(0, 5);
} finally {
  for (const [k, v] of Object.entries(out)) console.log(JSON.stringify({ [k]: v }));
  await page.close();
  server.stop();
}
