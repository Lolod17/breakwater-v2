// Combat probe: fire 10 rounds through the real Combat.fire path (same ray,
// muzzle-clearance check and damage code the mouse uses) at the nearest live
// pedestrian in clear sight, then reload, then shoot a police unit, then walk
// onto an ammo pickup. Fixed 60 Hz steps, seeded.
//   node tools/probe_combat.mjs
// Reports: hits, damage applied, ammo decrement, reload time, heat change,
// recoil / muzzle flash on the shot frame, police hit + reaction, pickup.
import { launch, startServer, watchPage } from './cdp.mjs';

const server = await startServer(8093);
const page = await launch({ port: 9335 });
const watch = watchPage(page, new URL(server.url).host);
try {
  await page.goto(`${server.url}?autostart&seed=1337`);
  await page.waitFor(() => page.evaluate('window.__game?.ready'), 60000);
  const result = await page.evaluate(`(() => {
    const g = window.__game;
    g.teleport(32.2, 150, true);
    const before = g.status(), player = g.player(), rounds = [];
    let targetId, shotFrame;
    for (let i = 0; i < 10; i++) {
      const targets = g.population().peds.filter(p => p.hp && g.aimClear(p.x, p.y + p.height * 0.72, p.z))
        .sort((a, b) => (a.id === targetId ? -1 : b.id === targetId ? 1 :
          Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z)));
      const p = targets[0];
      if (!p) throw new Error('No live target in sight for round ' + (i + 1));
      targetId = p.id;
      const fired = g.probeStep({ shot: { x: p.x, y: p.y + p.height * 0.72, z: p.z }, steps: 0 }).combat;
      if (i === 0) shotFrame = { recoil: fired.recoil, flash: fired.flash };
      const { combat } = g.probeStep({ steps: 12 });
      rounds.push({ aim: targetId, hit: combat.lastShot, ammo: combat.ammo });
    }
    const after = g.status();
    let reloaded = g.probeStep({ reload: true, steps: 0 });
    let ticks = 0;
    while (reloaded.combat.reload && ticks < 180) { ticks++; reloaded = g.probeStep(); }

    // Police: raise wanted, let a cruiser arrive, shoot its body or the officer.
    g.forceWanted(2);
    let police = null, s;
    for (let t = 0; t < 60 * 20 && !police; t++) {
      s = g.probeStep();
      const unit = s.units.find(u => u.hp > 0 && u.distance < 40);
      const car = unit && g.population().vehicles.find(v => v.id === unit.id);
      if (car && g.aimClear(car.x, car.y + 0.78, car.z)) police = { id: unit.id, x: car.x, y: car.y + 0.78, z: car.z };
    }
    let policeShot = null;
    if (police) {
      const hpBefore = s.units.find(u => u.id === police.id).hp;
      const shot = g.probeStep({ shot: police, steps: 1 });
      const unit = shot.units.find(u => u.id === police.id);
      policeShot = { unit: police.id, hit: shot.combat.lastShot, hpBefore, hpAfter: unit.hp, reacting: unit.hit > 0 };
    }

    // Pickup: stand on the ammo pickup by the avenue.
    const reserveBeforePickup = g.status().combat.reserve;
    g.teleport(32.2, 172);
    const picked = g.probeStep({ steps: 2 }).combat;
    return { rounds, shots: after.combat.shots, hits: after.combat.hits, damageApplied: after.combat.damage,
      ammoBefore: before.combat.ammo, ammoAfter: after.combat.ammo, ammoAfterReload: reloaded.combat.ammo,
      reserveBefore: after.combat.reserve, reserveAfter: reloaded.combat.reserve, reloadSeconds: +(ticks / 60).toFixed(3),
      heatBefore: before.heat, heatAfter: after.heat, wantedAfter: after.wanted, shotFrame, policeShot,
      pickup: { reserveBefore: reserveBeforePickup, reserveAfter: picked.reserve } };
  })()`);
  const pass = result.shots === 10 && result.hits === 10 && result.damageApplied > 0 && result.ammoAfter === 0
    && result.ammoAfterReload === 10 && result.reserveBefore - result.reserveAfter === 10
    && Math.abs(result.reloadSeconds - 1.35) < 0.001 && result.heatAfter - result.heatBefore === 40
    && result.shotFrame.flash && result.shotFrame.recoil > 0
    && result.policeShot?.hit?.damage > 0 && result.policeShot.hpAfter < result.policeShot.hpBefore && result.policeShot.reacting
    && result.pickup.reserveAfter === result.pickup.reserveBefore + 12
    && !watch.errors.length && !watch.offsite.length;
  console.log(JSON.stringify({ ...result, consoleErrors: watch.errors.length, offsiteRequests: watch.offsite.length, pass }));
  if (!pass) process.exitCode = 1;
} finally {
  await page.close();
  server.stop();
}
