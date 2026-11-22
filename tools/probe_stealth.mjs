// PASS 14b probe: weapon wheel, stealth, outfits (logic). Seeded, fixed 60 Hz steps.
//   node tools/probe_stealth.mjs
// Checks:
//   wheel   - Tab-hold opens it, the street runs at 20 %, it lists only held weapons,
//             refuses one not owned, equips the highlighted one on release; a crowbar
//             bought into the bag then shows up and equips; combat reads its data
//   noise   - standing quiet, crouch-walk quieter than walking, sprint and a gunshot loud
//   sight   - night and fog lower visibility, crouching lowers it further
//   crime   - an unseen (dark, foggy, crouched, quiet) crime leaves wanted at 0; the same
//             crime in daylight with bystanders around raises it; a gunshot is heard anyway
//   outfit  - an unowned outfit is refused; changing out of sight while wanted drops one
//             star only after the cooldown
//   save    - save, scramble, Continue: equipped weapon and outfit (id + colours) come back
// Prints one JSON line with pass: true, or exits 1.
import { launch, startServer, watchPage } from './cdp.mjs';

const server = await startServer(8141);
const page = await launch({ port: 9451 });
const watch = watchPage(page, new URL(server.url).host);
try {
  await page.goto(`${server.url}?autostart&seed=1337`);
  await page.waitFor(() => page.evaluate('window.__game?.ready'), 60000);
  const r = await page.evaluate(`(() => {
    const g = window.__game, out = {};
    g.newGame();
    g.teleport(32.2, 150, true);
    g.setWeather('clear', 0); g.setClock(12 * 60);

    // ---- weapon wheel
    const w = {};
    w.start = g.loadout();
    const opened = g.wheel({ hold: true });
    w.opened = { open: opened.open, options: opened.options, timeScale: opened.timeScale };
    const t0 = g.simTime(); g.wheel({ steps: 30 }); w.slowSeconds = +(g.simTime() - t0).toFixed(4);   // 30 steps at 20 %
    w.refuseSelect = g.wheel({ select: 'crowbar' }).picked;
    w.refuseEquip = g.equip('crowbar');
    w.pickFists = g.wheel({ select: 'fists' }).picked;
    const released = g.wheel({ hold: false });
    w.afterRelease = { open: released.open, equipped: g.loadout().equipped, combat: g.status().combat.weapon, timeScale: released.timeScale };
    const t1 = g.simTime(); g.step(30); w.normalSeconds = +(g.simTime() - t1).toFixed(4);
    w.boughtCrowbar = g.inventoryAdd('crowbar', 1);
    const reopened = g.wheel({ hold: true });
    w.reopenedOptions = reopened.options;
    w.pickCrowbar = g.wheel({ select: 'crowbar' }).picked;
    g.wheel({ hold: false });
    const c = g.status().combat;
    w.crowbar = { equipped: g.loadout().equipped, weapon: c.weapon, melee: c.melee };
    // the pistol's numbers come from data too: firing uses its interval / magazine
    g.wheel({ hold: true }); g.wheel({ select: 'pistol' }); g.wheel({ hold: false });
    w.pistolEquipped = g.loadout().equipped;
    out.wheel = w;

    // ---- noise
    const n = {};
    g.teleport(32.2, 150, true); g.setWeather('clear', 0); g.setClock(12 * 60);
    g.step(5); n.still = g.stealth().noise;
    g.walk({ x: 0, z: 1, sprint: false }, 60); n.jog = g.stealth().noise;
    g.walk({ x: 0, z: -1, sprint: true }, 60); n.sprint = g.stealth().noise; n.sprintGait = g.stealth().gait;
    g.crouch(true);
    g.walk({ x: 0, z: 1, sprint: true }, 60); n.crouchWalk = g.stealth().noise; n.crouchGait = g.stealth().gait;
    g.crouch(false); g.step(30);
    const p = g.player();
    g.probeStep({ shot: { x: p.x + 3, y: p.y + 0.2, z: p.z + 8 }, steps: 1 });
    n.gunshot = g.stealth().noise;
    g.step(240); n.afterQuiet = g.stealth().noise;
    out.noise = n;

    // ---- visibility
    const v = {};
    g.crouch(false);
    g.setWeather('clear', 0); g.setClock(12 * 60); v.dayClear = g.stealth().visibility;
    g.setClock(23 * 60); v.nightClear = g.stealth().visibility;
    g.setWeather('fog', 0); v.nightFog = g.stealth().visibility;
    g.crouch(true); v.nightFogCrouched = g.stealth().visibility;
    g.setClock(12 * 60); v.dayFogCrouched = g.stealth().visibility;
    out.visibility = v;

    // ---- crimes: unseen vs seen (quiet assault through the real report gate)
    const k = {};
    g.teleport(32.2, 150, true); g.step(10);
    g.setWeather('fog', 0); g.setClock(23 * 60); g.crouch(true); g.step(2);
    k.unseen = g.crime('assault');
    k.unseenStatus = { wanted: g.status().wanted, heat: g.status().heat };
    g.crouch(false); g.setWeather('clear', 0); g.setClock(12 * 60); g.step(2);
    k.bystanders = g.nearby(g.player().x, g.player().z, 45).peds.length;
    k.seen = g.crime('assault');
    k.seenStatus = { wanted: g.status().wanted, heat: g.status().heat };
    // a pistol shot in the dark is still heard (real fire path)
    g.teleport(32.2, 150, true); g.step(10);
    g.setWeather('fog', 0); g.setClock(23 * 60); g.crouch(true); g.step(2);
    const q = g.player();
    g.probeStep({ shot: { x: q.x + 3, y: q.y + 0.2, z: q.z + 8 }, steps: 1 });
    k.darkShot = { report: g.stealth().lastReport, wanted: g.status().wanted, heat: g.status().heat };
    out.crime = k;

    // ---- outfits and the disguise star drop
    const o = {};
    g.teleport(32.2, 150, true); g.crouch(false); g.setWeather('clear', 0); g.setClock(12 * 60);
    o.ownedAtStart = g.loadout().outfit.owned;
    o.refuseUnowned = g.wear('denim');
    o.bought = g.inventoryAdd('windbreaker', 1);
    g.forceWanted(2, { x: -180, z: -180 });         // reported across town: the response starts far away
    g.step(1);
    o.before = { wanted: g.status().wanted, seen: g.status().seen };
    o.wore = g.wear('windbreaker');
    o.armed = g.loadout().outfit.disguise;
    let seenFrames = 0, levelAt25 = null;
    for (let i = 1; i <= 60 * 3.2; i++) {
      const s = g.probeStep();
      seenFrames += +s.seen;
      if (i === 150) levelAt25 = s.wanted;
    }
    o.levelAt25 = levelAt25;
    o.after = { wanted: g.status().wanted, seenFrames };
    o.outfit = g.loadout().outfit;
    out.outfit = o;

    // ---- save and reload keep weapon and outfit
    const sv = {};
    g.forceWanted(0, { x: 0, z: 0 });
    g.equip('crowbar');
    sv.before = { weapon: g.loadout().equipped, outfit: g.loadout().outfit.outfitId };
    sv.write = !!g.save().ok;
    const data = g.readSave().data;
    sv.stored = { loadout: data?.loadout, outfit: data?.outfit };
    g.equip('pistol'); g.wear('courier');
    sv.scrambled = { weapon: g.loadout().equipped, outfit: g.loadout().outfit.outfitId };
    sv.cont = g.continueGame().ok;
    const after = g.loadout();
    sv.after = { weapon: after.equipped, combat: g.status().combat.weapon, outfit: after.outfit.outfitId, colours: after.outfit.colours };
    out.save = sv;
    return out;
  })()`);

  const w = r.wheel, n = r.noise, v = r.visibility, k = r.crime, o = r.outfit, s = r.save;
  const checks = {
    wheelOpens: w.opened.open && w.opened.timeScale === 0.2 && !w.opened.options.includes('crowbar') && w.opened.options.includes('pistol'),
    wheelSlowsTime: Math.abs(w.slowSeconds - 30 / 60 * 0.2) < 1e-6 && Math.abs(w.normalSeconds - 0.5) < 1e-6,
    wheelRefusesUnowned: w.refuseSelect === false && w.refuseEquip === false,
    wheelEquipsHeld: w.pickFists && !w.afterRelease.open && w.afterRelease.equipped === 'fists' && w.afterRelease.combat === 'fists' && w.afterRelease.timeScale === 1,
    wheelOffersBought: w.boughtCrowbar && w.reopenedOptions.includes('crowbar') && w.pickCrowbar && w.crowbar.equipped === 'crowbar' && w.crowbar.melee,
    loudActions: n.still < 0.05 && n.crouchWalk < n.jog && n.jog < n.sprint && n.sprint >= 0.5 && n.gunshot >= 0.99 && n.afterQuiet < 0.05
      && n.sprintGait === 'sprint' && n.crouchGait === 'crouch',
    nightLowersVisibility: v.nightClear < v.dayClear && v.nightFog < v.nightClear && v.nightFogCrouched < v.nightFog && v.dayFogCrouched > v.nightFogCrouched,
    unseenCrimeIgnored: !k.unseen.report && k.unseenStatus.wanted === 0 && k.unseenStatus.heat === 0,
    seenCrimeRaises: k.bystanders > 0 && k.seen.report && k.seen.seen && k.seenStatus.wanted >= 1,
    gunshotHeard: k.darkShot.report?.heard && k.darkShot.wanted >= 1,
    outfitRefusesUnowned: o.refuseUnowned === false && !o.ownedAtStart.includes('denim'),
    outfitDropsStar: o.before.wanted === 2 && !o.before.seen && o.wore && o.armed.armed && o.levelAt25 === 2
      && o.after.wanted === 1 && o.after.seenFrames === 0 && o.outfit.outfitId === 'windbreaker',
    savePersists: s.write && s.stored.loadout?.weapon === 'crowbar' && s.stored.outfit?.outfitId === 'windbreaker'
      && s.scrambled.weapon === 'pistol' && s.scrambled.outfit === 'courier' && s.cont
      && s.after.weapon === 'crowbar' && s.after.combat === 'crowbar' && s.after.outfit === 'windbreaker'
      && s.after.colours.jacket === '#1f6f8b' && JSON.stringify(s.stored.outfit.colours) === JSON.stringify(s.after.colours),
    noConsoleErrors: !watch.errors.length && !watch.offsite.length,
  };
  const pass = Object.values(checks).every(Boolean);
  console.log(JSON.stringify({ pass, checks, ...r, consoleErrors: watch.errors, offsiteRequests: watch.offsite.length }));
  if (!pass) process.exitCode = 1;
} finally {
  await page.close();
  server.stop();
}
