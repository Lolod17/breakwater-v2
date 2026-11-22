// PASS 8 final screenshots: four 1280x720 JPEGs from the running game (real renderer, real HUD and
// minimap DOM), each staged deterministically from the seeded start through the game's own code:
// __game.stage() places the player / car and runs the fixed-step simulation, forceWanted() and
// missionStart() are the same calls the probes use, probeStep() advances the real simulation and draws
// through the normal render path (camera rig, HUD, minimap). Nothing is composited or edited.
//   node tools/shots_final.mjs [--headed] [--out screenshots] [--only 1-city,2-chase] [--port 8098]
// Each scene loads the game fresh. Prints per shot: file, bytes, JPEG quality (stepped down until the file is
// <= 250 KiB, under the scorer's 256 KiB cap), draw calls, triangles, the scene's own facts, and the scene check
// (people on roofs, floating cars, overlapping cars, people inside cars or the player, the camera inside a car,
// HUD boxes outside the viewport). Exits 1 if any shot fails its check, a scene finds no frame, or the page logs
// an error or makes an off-site request.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, startServer, watchPage } from './cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const val = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const outDir = resolve(ROOT, val('--out', 'screenshots'));
const only = val('--only', null)?.split(',');
const port = Number(val('--port', 8098));

// Each scene is a page-side async function body; `g` is window.__game. It returns facts for the log.
const SCENES = {
  // 1. The city wide: on foot on the harbour promenade at dusk, looking up the waterfront: the downtown skyline and
  //    its rooftop billboard, the waterfront road's traffic and walkers, the harbour water and the terminal's cranes.
  '1-city': `
    await g.stage({ x: 100, z: 219.5, yaw: Math.PI / 2, wish: { x: 1, z: 0, sprint: false }, run: 1.6, time: 34, camYaw: 0.6, pitch: 0.18, dist: 10 });
    return null;`,
  // 2. The chase: the player's car crawls east down the dock road from x = 150 toward the port gate and the terminal
  //    at wanted 3, and the real police response dispatches (a slow target gets units facing it, so they arrive
  //    head-on). The frame is the first drawn one with a unit within 24 m, the car rolling forward at 1.5 m/s or
  //    more with no tyre slip for 0.75 s (no smoke over it), and, with the camera straight behind or turned toward
  //    the water as the mouse turns it, a cruiser in view 5.5-20 m away, none under the lens, the camera 2 m clear
  //    of every other car's body and the player's car near the middle of the frame.
  //    Wanted is held at 3 (no decay, no escalation from the chase's own bumps).
  '2-chase': `
    await g.stage({ car: { use: 'hero', x: 150, z: 201.75, yaw: Math.PI / 2, speed: 2.5, cruise: 2.5, ignoreSignals: true,
      route: [[120, 200], [200, 200]] }, camOrbit: 0, camPitch: 0 });
    g.forceWanted(3);
    let shot = null;
    const framed = () => {
      const cops = g.diag().cars.filter((c) => c.type === 'police' && c.ndc.z < 1);
      const inView = cops.filter((c) => Math.abs(c.ndc.x) < 0.8 && Math.abs(c.ndc.y) < 0.8 && c.dist > 5.5 && c.dist < 20);
      // nothing against the lens: the camera at least 2 m clear of every other car's box (its own length, width
      // and height), and the player's own car near the middle of the frame
      const own = g.player().vehicle?.id, d = g.diag(), cp = d.cam;
      const clear = g.vehicles().every((v) => {
        if (v.id === own) return true;
        const dims = g.vehicleDims(v.id), car = g.debugCar(v.id), s = Math.sin(car.yaw), c = Math.cos(car.yaw);
        const dx = cp.x - v.x, dz = cp.z - v.z, along = Math.abs(dx * s + dz * c) - dims.length / 2, across = Math.abs(dx * c - dz * s) - dims.width / 2;
        const up = cp.y - (v.position.y + dims.height);
        return Math.hypot(Math.max(0, along), Math.max(0, across), Math.max(0, up)) > 2;
      });
      const ownInView = d.car && Math.abs(d.car.ndc.x) < 0.5 && Math.abs(d.car.ndc.y) < 0.6 && d.car.ndc.z < 1;
      const near = clear && ownInView ? [] : [1, 2];
      const forward = (g.player().vehicle?.gear ?? 0) >= 1 && (g.player().vehicle?.speed ?? 0) >= 1.5;
      return inView.length && forward && cops.every((c) => c.dist > 4.5) && near.length <= 1 ? inView[0] : null;
    };
    let calm = 0;   // steps since the player's tyres last slipped (slip >= 0.28 emits tyre smoke)
    for (let i = 0; i < 60 * 50 && !shot; i++) {
      const st = g.probeStep({ drawFrame: i % 6 === 0 });
      calm = (g.debugCar(g.player().vehicle?.id)?.slip ?? 1) < 0.28 ? calm + 1 : 0;
      if (st.wanted !== 3) g.forceWanted(3);
      if (i % 6) continue;
      if (!st.units.some((u) => u.distance > 4 && u.distance < 24 && u.state !== 'patrol')) continue;
      if ((g.player().vehicle?.speed ?? 0) < 1.5 || calm < 45) continue;   // no fresh tyre smoke over the car   // a chase, not a jam: the car is moving
      // a cruiser on the bumper: turn the camera off the tail as a player does with the mouse, either side
      for (const orbit of [0, -0.5, -0.8, 0.5, 0.8]) {   // straight behind first, then toward the water and the port
        g.carLook(orbit, 0.04);
        for (let k = 0; k < 6; k++) g.probeStep({ drawFrame: true });
        const cop = framed();
        if (cop) { shot = { i, orbit, cop, speed: +g.player().vehicle.speed.toFixed(1) }; break; }
      }
    }
    // the sim is frozen from here: let the wanted toasts leave on their 3.9 s timer, then draw the same instant again
    await new Promise((r) => setTimeout(r, 4200));
    g.probeStep({ steps: 0, drawFrame: true });
    return { shot, units: g.status().units.map((u) => [u.id, +u.distance.toFixed(1), u.state]), wanted: g.status().wanted, x: +g.player().x.toFixed(1) };`,
  // 3. The street: on foot in the Old Market, walkers on the pavement, traffic in the street, the market's low
  //    brick and stucco blocks with balconies and lit shopfronts.
  '3-street': `
    await g.stage('marketFoot');
    return null;`,
  // 4. The last route: THE LAST ROUTE just past the port gate (165, 200). The gate tripped wanted 3 and Halden's two
  //    hunter cars; the HUD carries the jetty objective with the LEDGER meter and the story line, and the camera,
  //    turned as the mouse turns it, looks past the gate's barrier to the container terminal and its cranes.
  // 4. The last route: THE LAST ROUTE just past the port gate (165, 200). The gate tripped wanted 3 and Halden's two
  //    hunter cars; the HUD carries the jetty objective with the LEDGER meter and the story line, and the camera,
  //    turned as the mouse turns it, looks along the dock road to the container terminal, its cranes and the bay.
  '4-last-route': `
    await g.stage({ car: { use: 'hero', x: 128, z: 201.75, yaw: Math.PI / 2, speed: 10, cruise: 11, ignoreSignals: true,
      route: [[120, 200], [200, 200]] }, run: 0.2, camOrbit: 0, camPitch: 0 });
    g.missionStart(4);
    for (let i = 0; i < 60 * 12; i++) { g.probeStep({ drawFrame: i % 6 === 0 }); if (g.status().wanted >= 3) break; }
    for (let i = 0; i < 60 * 1.5; i++) g.probeStep({ drawFrame: i % 6 === 0 });
    await new Promise((r) => setTimeout(r, 4200));     // the gate's toasts leave on a 3.9 s timer
    g.carLook(-0.55, 0.1);
    for (let i = 0; i < 8; i++) g.probeStep({ drawFrame: true });
    return { objective: g.missions().objective, ledger: g.missions().ledger, wanted: g.status().wanted, x: +g.player().x.toFixed(1) };`,
};

// Scene check run after every scene, from the game's own state (not the image): living pedestrians in view
// and their height above the ground under them (a person on a roof shows as lift > 0.5 m), cars within 90 m of
// the camera and their lift (a floating car > 0.3 m), car-car overlap of the cars' own collision circles, people
// standing inside a car's circles, and any visible HUD element whose box leaves the 1280x720 viewport.
const SCENE_CHECK = `(() => {
  const g = window.__game, pop = g.population(), cam = pop.camera;
  const near = (o, r) => Math.hypot(o.x - cam.x, o.z - cam.z) < r;
  const peds = pop.peds.filter((p) => p.hp > 0 && p.onScreen);
  const pedLift = peds.map((p) => p.y - g.ground(p.x, p.z));
  const cars = pop.vehicles.filter((v) => near(v, 90));
  const carLift = cars.map((v) => Math.abs(v.y - g.ground(v.x, v.z)));
  const centres = (v) => v.circles.map((c) => ({ x: v.x + Math.sin(v.yaw) * c, z: v.z + Math.cos(v.yaw) * c, r: v.radius }));
  const carOverlap = [], pedInCar = [];
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    const hit = centres(cars[i]).some((a) => centres(cars[j]).some((b) => Math.hypot(a.x - b.x, a.z - b.z) < a.r + b.r - 0.15));
    if (hit) carOverlap.push([cars[i].id, cars[j].id]);
  }
  for (const p of pop.peds.filter((p) => p.hp > 0 && near(p, 90))) for (const v of cars)
    if (centres(v).some((c) => Math.hypot(p.x - c.x, p.z - c.z) < c.r - 0.05)) pedInCar.push([p.id, v.id]);
  const hudClipped = [...document.querySelectorAll('#hud .hud-group, #hud .hud-group > *, #toasts > *, #prompt, #keys')]
    .filter((el) => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden')
    .map((el) => ({ id: el.id || el.className, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5))
    .map(({ id, r }) => [id, Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]);
  // the player on foot against walkers (two body radii of ~0.3 m) and against cars
  const pl = g.player(), pedOnPlayer = [];
  if (!pl.driving) for (const p of pop.peds.filter((p) => p.hp > 0)) if (Math.hypot(p.x - pl.x, p.z - pl.z) < 0.6) pedOnPlayer.push(p.id);
  if (!pl.driving) for (const v of cars) if (centres(v).some((c) => Math.hypot(pl.x - c.x, pl.z - c.z) < c.r + 0.2)) pedOnPlayer.push('car' + v.id);
  // the render camera inside a car's body (its oriented box from the car's own length, width and height)
  const cp = g.diag().cam, camInCar = [];
  for (const v of g.vehicles()) {
    const t = pop.vehicles.find((o) => o.id === v.id); if (!t) continue;
    const dx = cp.x - v.x, dz = cp.z - v.z, s = Math.sin(t.yaw), c = Math.cos(t.yaw);
    const along = dx * s + dz * c, across = dx * c - dz * s, dims = g.vehicleDims ? g.vehicleDims(v.id) : null;
    const half = dims ? dims.length / 2 : t.radius * 2.4, w = dims ? dims.width / 2 : t.radius, h = dims ? dims.height : 3.6;
    if (Math.abs(along) < half && Math.abs(across) < w && cp.y < v.position.y + h) camInCar.push(v.id);
  }
  // cruisers inside the frame (projected body centre), nearest first, distance from the camera in metres
  const police = g.diag().cars.filter((c) => c.type === 'police' && Math.abs(c.ndc.x) < 1 && Math.abs(c.ndc.y) < 1).map((c) => c.dist);
  const r2 = (a) => +Math.max(0, ...a).toFixed(2);
  const hud = { wanted: document.querySelector('#wanted')?.getAttribute('aria-label'), district: document.querySelector('#district')?.textContent,
    objective: document.querySelector('#mission')?.hidden ? null : document.querySelector('#mission-objective')?.textContent };
  return { pedsOnScreen: peds.length, maxPedLift: r2(pedLift), carsNear: cars.length, maxCarLift: r2(carLift),
    carOverlap, pedInCar, pedOnPlayer, camInCar, policeInFrame: police, hudClipped, hud, viewport: [innerWidth, innerHeight],
    ok: r2(pedLift) <= 0.5 && r2(carLift) <= 0.3 && !carOverlap.length && !pedInCar.length && !pedOnPlayer.length && !camInCar.length && !hudClipped.length };
})()`;
const SCENES_VIEW = Object.fromEntries(Object.keys(SCENES).map((k) => [k, SCENE_CHECK]));

const failed = [];
const server = await startServer(port);
const page = await launch({ headless: !argv.includes('--headed'), port: 9348 });
const watch = watchPage(page, new URL(server.url).host);
mkdirSync(outDir, { recursive: true });
try {
  for (const [name, body] of Object.entries(SCENES)) {
    if (only && !only.includes(name)) continue;
    // a fresh load per scene: simulation streams (traffic refills, crowd, police forks) carry state from one
    // staged scene to the next, so each shot is made from the same seeded start, whatever ran before it
    await page.goto(`${server.url}?autostart&seed=1337`);
    await page.waitFor(() => page.evaluate('!!(window.__game && window.__game.ready)'), 60000);
    const facts = await page.evaluate(`(async () => { const g = window.__game; ${body} })()`);
    const extra = SCENES_VIEW[name] ? await page.evaluate(SCENES_VIEW[name]) : null;
    await new Promise((r) => setTimeout(r, 150));
    const frame = await page.evaluate('(() => { const f = window.__game.frame(); return { calls: f.calls, triangles: f.triangles }; })()');
    let quality = 90, data;
    for (;;) {
      ({ data } = await page.send('Page.captureScreenshot', { format: 'jpeg', quality }));
      if (Buffer.byteLength(data, 'base64') <= 250 * 1024 || quality <= 50) break;
      quality -= 4;
    }
    const file = join(outDir, `${name}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(JSON.stringify({ file, bytes: Buffer.byteLength(data, 'base64'), quality, ...frame, facts, extra }));
    if (!extra?.ok || (facts && 'shot' in facts && !facts.shot)) failed.push(name);
  }
} finally {
  const pass = !failed.length && !watch.errors.length && !watch.offsite.length;
  console.log(JSON.stringify({ consoleErrors: watch.errors.length, offsiteRequests: watch.offsite.length, errors: watch.errors.slice(0, 5), failed, pass }));
  await page.close();
  server.stop();
  process.exitCode = pass ? 0 : 1;
}
