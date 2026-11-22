// BREAKWATER — entry point. Boots the renderer, builds the seeded district,
// spawns the player and the vehicle fleet, and runs the fixed-step loop. Exposes window.__game for
// the verification tools in tools/.
import * as THREE from '../vendor/three.min.js';
import { RNG, seedFromURL } from './rng.js';
import { createLoop, STEP } from './loop.js';
import { Input } from './input.js';
import { createRenderer } from './render/renderer.js';
import { createEnvironment } from './render/sky.js';
import { buildWorld } from './world/world.js';
import { Player } from './player/player.js';
import { ChaseCamera } from './camera/chaseCamera.js';
import { Hud } from './hud.js';
import { MOOD } from './config.js';
import { autopilotRoute, SHOTS } from './debug.js';
import { VehicleManager } from './vehicles/vehicleManager.js';
import { VehicleRenderer } from './vehicles/vehicleRenderer.js';
import { VehicleEffects } from './vehicles/vehicleEffects.js';
import { TrafficDriver } from './vehicles/traffic.js';
import { VehicleCamera } from './camera/vehicleCamera.js';
import { CameraRig } from './camera/cameraRig.js';
import { Driving } from './player/driving.js';
import { VehicleAudio } from './audio/vehicleAudio.js';
import { CITY } from './config.js';
import { Crowd } from './pedestrians/crowd.js';
import { Wanted } from './police/wanted.js';
import { Police } from './police/police.js';
import { Helicopter, PoliceVisuals } from './police/visuals.js';
import { Combat } from './player/combat.js';
import * as Weapons from './player/weapons.js';
import { WeaponWheel, WHEEL_KEY } from './player/weaponWheel.js';
import { Stealth, CROUCH_KEY, CRIME_NOISE } from './player/stealth.js';
import * as Outfits from './player/outfits.js';
import { Vehicle } from './vehicles/vehicle.js';
import { MissionMarker } from './missions/marker.js';
import { Missions, MISSIONS } from './missions/missions.js';
import { STORY } from './missions/story.js';
import * as Side from './missions/side.js';
import { readSave, writeSave, clearSave, collectSave, restoreSections } from './save.js';
import * as Time from './env/time.js';
import * as Weather from './env/weather.js';
import * as Wallet from './econ/wallet.js';
import * as Inventory from './econ/inventory.js';
import * as Doors from './world/doors.js';
import * as Life from './world/life.js';
import * as Factions from './econ/factions.js';
import * as Garage from './econ/garage.js';
import * as Shop from './econ/shop.js';
import * as Collectibles from './econ/collectibles.js';
import * as Achievements from './core/achievements.js';
import { on, emit } from './core/events.js';
import { applyRecord } from './vehicles/customParts.js';
import { GarageMenu, SITE as CUSTOMS_SITE } from './garageMenu.js';
import { Radio, STATIONS } from './audio/radio.js';
import { Feedback } from './ui/feedback.js';
import { Title, titleCamera } from './ui/title.js';
import { Interiors, resetWardrobe } from './world/interiors.js';
import { buildCharacter } from './player/character.js';
import { PhotoMode, FILTERS as PHOTO_FILTERS } from './ui/photoMode.js';
import { SpeedLines } from './ui/speedLines.js';
import * as Daylight from './render/daylight.js';
import { Rain } from './render/rain.js';
import { savedLook, lookPalette } from './player/outfit.js';
import { outfitPalette } from './world/interiors.js';

const BUILD = '2.8.0';

const params = new URLSearchParams(location.search);
const autostart = params.has('autostart');
const seed = seedFromURL(1337);
const canvas = document.getElementById('game');
const hud = new Hud();

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function boot() {
  hud.progress(0.05, 'Starting renderer');
  await nextFrame();
  const gfx = createRenderer(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 6000);
  scene.environment = createEnvironment(gfx.renderer);
  scene.environmentIntensity = 0.9;
  hud.progress(0.15, 'Laying out the grid');
  await nextFrame();

  const rng = new RNG(seed);
  const world = buildWorld(scene, rng, (f, l) => hud.progress(f, l));
  Doors.init(seed);
  Weather.init(seed);
  Life.init(seed);
  // PASS 16: the clock and the weather drive the sun, sky, fog, lamps, wet roads and rain
  const rain = new Rain(scene);
  const daylight = Daylight.bind({ scene, world, fx: world.fx, lm: world.lm, rain });
  let exposure = MOOD.exposure;
  const applyLook = () => {
    Daylight.update(Time.totalMinutes(), Weather.weights(), Weather.wetness());
    exposure = Daylight.apply(daylight);
  };
  // rain streaks are lit by the sun by day and the lamps by night; placed after the camera moved
  // PASS 16: the harbour tags (twenty since PASS 15) (econ/collectibles.js): one instanced mesh, a bobbing, spinning gold tag each
  Collectibles.init(seed);
  const tagMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.32, 0).scale(0.75, 1.15, 0.75),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.1, 0.55) }), Collectibles.TOTAL);
  tagMesh.frustumCulled = false; tagMesh.name = 'harbour-tags';
  scene.add(tagMesh);
  const _tagM = new THREE.Matrix4(), _tagQ = new THREE.Quaternion(), _tagP = new THREE.Vector3(), _tagS = new THREE.Vector3(), _tagY = new THREE.Vector3(0, 1, 0);
  const drawTags = (t) => {
    let n = 0;
    for (const c of Collectibles.list()) {
      if (c.found) continue;
      _tagP.set(c.x, world.groundHeight(c.x, c.z) + 0.95 + Math.sin(t * 2 + n) * 0.12, c.z);
      _tagQ.setFromAxisAngle(_tagY, t * 1.8 + n);
      _tagM.compose(_tagP, _tagQ, _tagS.set(1, 1, 1));
      tagMesh.setMatrixAt(n++, _tagM);
    }
    tagMesh.count = n;
    tagMesh.visible = n > 0;
    tagMesh.instanceMatrix.needsUpdate = true;
  };
  const rainLit = () => { const L = Daylight.LOOK; return 0.35 + 0.65 * Math.min(1, L.sunIntensity / 2.4 + L.lamps * 0.3); };
  const input = new Input(canvas);
  hud.initMap(world.layout, CITY);
  const player = new Player(world, world.materials);
  scene.add(player.object, player.blob);
  player.spawn(32.2, 150, 0);   // east-side pavement of the avenue, facing south toward the harbour
  const chase = new ChaseCamera(new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 6000), world.colliders, world.groundHeight);
  chase.snap(player.pos, player.yaw);

  hud.progress(0.93, 'Parking the cars');
  await nextFrame();
  // ?parked=N / ?traffic=N override the fleet size (budget gates with many cars in view)
  const fleet = {};
  for (const k of ['parked', 'traffic']) if (params.has(k)) fleet[k] = Math.max(0, Math.min(80, Number(params.get(k)) | 0));
  const vehicles = new VehicleManager(world, rng.fork('vehicles'), fleet);
  world.vehiclesManager = vehicles;
  const crowd = new Crowd(scene, world, rng.fork('crowd'));
  vehicles.pedestrians = crowd.peds;
  vehicles.populate(player.pos, player.yaw, 1, true);
  const carRender = new VehicleRenderer(scene, world.lm);
  const effects = new VehicleEffects(scene, vehicles.ground);
  const carCam = new VehicleCamera(world.colliders, world.groundHeight);
  const rig = new CameraRig(camera);
  const driving = new Driving(player, vehicles, rig, chase, carCam);
  const audio = new VehicleAudio();
  const radio = new Radio(audio);
  const feedback = new Feedback(audio);
  on('side:completed', (p) => feedback.emit('complete', simTime, 'JOB DONE', '+$' + p.reward));
  on('side:failed', (p) => feedback.emit('fail', simTime, 'JOB FAILED', p.reason ?? ''));
  const title = new Title({ gesture: () => audio._init() });
  title.active = !autostart;           // the first frames (and the shader warm-up) use the title camera
  const wanted = new Wanted();
  const police = new Police(world, vehicles, wanted, rng.fork('police'), new Helicopter(scene, world));
  const policeVisuals = new PoliceVisuals(scene, world.lm);
  driving.onTake = (v) => police.detach(v);
  // PASS 14b: stealth gates every crime. It reaches the wanted level only when
  // it is heard (noise) or seen by a witness (visibility); see stealth.js.
  const stealth = new Stealth();
  const wheel = new WeaponWheel();
  let probeWheel = false;            // tools hold the wheel open without the Tab key
  let lastReport = null;
  const _eye = new THREE.Vector3(), _ray = new THREE.Vector3();
  const sightTo = (x, y, z, target, range) => {
    _ray.set(target.x - x, target.y - y, target.z - z);
    const length = _ray.length();
    if (length > range) return false;
    if (length < 0.01) return true;
    _eye.set(x, y, z);
    return world.colliders.raycast(_eye, _ray.divideScalar(length), length) >= length - 0.025;
  };
  // Anyone with a clear line of sight to `target` within `range`: police officers and
  // cruisers, or a standing bystander (not the victim) who would call it in.
  const witnessOf = (target, exclude) => (range) => {
    for (const u of police.units) {
      if (u.hp <= 0) continue;
      const o = u.officer ?? u.car;
      if (sightTo(o.x, u.officer ? o.y + 1.45 : u.car.gY + 1.18, o.z, target, range)) return true;
    }
    for (const p of crowd.peds) {
      if (!p.hp || p === exclude || Math.abs(p.x - target.x) > range || Math.abs(p.z - target.z) > range) continue;
      if (sightTo(p.x, p.y + p.height * 0.92, p.z, target, range)) return true;
    }
    return false;
  };
  const reportCrime = (kind, at, { noise = CRIME_NOISE[kind], exclude = null } = {}) => {
    const target = { x: at.x, y: (driving.driving && driving.vehicle ? driving.vehicle.gY : player.pos.y) + 0.95, z: at.z };
    const r = stealth.report(noise, witnessOf(target, exclude));
    lastReport = { kind, ...r, at: +simTime.toFixed(2) };
    if (r.report) wanted.crime(kind, at, simTime);
    return r;
  };
  const combat = new Combat(scene, world, player, crowd, police, (weapon) => {
    if (weapon.kind !== 'firearm') { stealth.bang(weapon.noise); return; }
    reportCrime('shot', player.pos, { noise: weapon.noise });
    crowd.gunfire(player.pos.x, player.pos.z);
    Life.reportGunfire(player.pos.x, player.pos.z);
    audio.shot();
  });
  // a melee hit on a person is an assault (firearm hits are already covered by the shot)
  combat.onHit = (weapon, hit) => {
    if (weapon.kind === 'melee') reportCrime('assault', player.pos, { noise: weapon.noise, exclude: hit.kind === 'pedestrian' ? hit.target : null });
  };
  const life = { hp: 100, money: 250, immunity: 0, incident: null };
  // PASS 16: life.money is the balance the HUD shows and the save writes. Earnings and
  // purchases that go through the wallet (side jobs, shops, customs) land here too;
  // 'sync:*' moves are the wallet catching up with life.money, so they are skipped.
  // (Before: a side-job payout only reached the wallet, and the next sync spent it back.)
  on('money:changed', (p) => {
    if (typeof p?.reason === 'string' && p.reason.startsWith('sync:')) return;
    life.money = Math.max(0, Math.min(10_000_000, life.money + p.delta));
  });
  // PASS 16: harbour tags and achievements announce themselves
  on('collectible:found', (p) => feedback.toast('objective', 'HARBOUR TAG', `${p.found} / ${p.total} found  +$${p.reward}`));
  on('achievement:unlocked', (p) => feedback.toast('complete', `ACHIEVEMENT \u00b7 ${p.title}`, p.text));
  // PASS 10c: Breakwater Customs. Purchases go through wallet.spend; the gameplay
  // balance (life.money) is reconciled into the wallet on entry and read back after.
  const syncWallet = () => {
    const d = Math.round(life.money) - Wallet.balance();
    if (d > 0) Wallet.earn(d, 'sync:life'); else if (d < 0) Wallet.spend(-d, 'sync:life');
  };
  const customs = new GarageMenu(scene, world.lm, {
    ground: (x, z) => world.groundHeight(x, z),
    balance: () => Wallet.balance(),
    syncWallet,
    opened: () => effects.reset(),
    // the car in the garage becomes the player's car: the one a save restores
    adoptCar: (v) => {
      for (const o of vehicles.vehicles) o.owned = o === v;
      missions.owned = { type: v.type.name, paint: '#' + v.paint.getHexString() };
    },
    afterPurchase: (rec, v) => {
      life.money = Wallet.balance();
      applyRecord(v, rec);
      missions.owned = { type: v.type.name, paint: rec.colour };
    },
    leave: (v) => {
      carCam.snap({ x: v.x, y: v.gY, z: v.z, yaw: v.yaw, type: v.type });
      rig.snapMode(true);
      camera.fov = 60; camera.updateProjectionMatrix();
      autosave('garage');
    },
  });
  // ---- PASS 11: enterable interiors (safehouse, two shops, the customs workshop, a bar)
  let lastCar = null;             // the car the player drove last (the garage terminal can bring it in)
  // Wardrobe: rebuild the player's body with the outfit palette, in whichever scene it is in.
  let wornPalette = null;          // PASS 15b: the palette the body was last built with (tool hook)
  const restyle = (palette) => {
    wornPalette = { ...palette };
    const old = player.char, parent = player.object.parent;
    const next = buildCharacter(world.lm, palette);
    next.root.position.copy(old.root.position); next.root.rotation.copy(old.root.rotation); next.root.visible = old.root.visible;
    if (parent) { parent.remove(old.root); parent.add(next.root); }
    old.root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    player.char = next; player.object = next.root;
  };
  const interiors = new Interiors(scene, {
    player, env: scene.environment, restyle,
    syncWallet, balance: () => Wallet.balance(), afterSpend: () => { life.money = Wallet.balance(); },
    // bed: heal, clear 1-2 stars only if no police saw the player walk in, then save
    slept: ({ seenEntering }) => {
      life.hp = 100;
      const level = wanted.level;
      let cleared = 0;
      if (level > 0 && !seenEntering) { cleared = Math.min(2, level); wanted.force(level - cleared, interiors.site.door); }
      const r = autosave('sleep');
      return { cleared, saved: !!r.ok, stillWanted: level > 0 && !cleared };
    },
    // garage terminal: hand the player's car to the existing customs menu (GarageMenu)
    customise: () => {
      if (wanted.level > 0) return { ok: false, message: 'Not with the police on you.' };
      const mine = (v) => vehicles.vehicles.includes(v) && !v.mission && v.type.name !== 'police' && !(v.driver && v.driver !== 'player');
      const cands = vehicles.vehicles.filter((v) => (v.owned || v === lastCar) && mine(v))
        .sort((a, b) => Math.hypot(a.x - CUSTOMS_SITE.x, a.z - CUSTOMS_SITE.z) - Math.hypot(b.x - CUSTOMS_SITE.x, b.z - CUSTOMS_SITE.z));
      const v = cands[0];
      if (!v || Math.hypot(v.x - CUSTOMS_SITE.x, v.z - CUSTOMS_SITE.z) > 150) return { ok: false, message: 'No car of yours nearby. Drive one here, or onto the turntable outside (G).' };
      leaveInterior();
      driving.enterNow(v);
      if (!customs.enter(v)) return { ok: false, message: 'The workshop is busy.' };
      return { ok: true };
    },
  });
  // Door in range + E: the street simulation stops and the room is built.
  const enterInterior = (site) => {
    const seen = wanted.level > 0 && (police.seen || wanted.unseen < 2);
    driving.candidate = null;
    if (!interiors.enter(site, { seen })) return false;
    customs.showPrompt(false);
    return true;
  };
  // Exit door: back on the street door's spot and heading, the camera to the side (not inside the facade).
  const leaveInterior = () => {
    const at = interiors.exit(scene);
    if (!at) return false;
    chase.snap(player.pos, player.yaw);
    chase.yaw = player.yaw + Math.PI * 0.4;
    camera.fov = 60; camera.updateProjectionMatrix();
    return at;
  };
  const _doorFocus = { x: 0, z: 0, yaw: 0, speed: 0 };
  const doorFocus = () => { const d = interiors.site.door; Object.assign(_doorFocus, { x: d.x, z: d.z, yaw: d.yaw }); return _doorFocus; };
  let wasSeated = false;          // PASS 15: vehicle:entered / vehicle:exited edge
  const renderInterior = (alpha, dt) => {
    input.consumeLook();
    interiors.frame(camera, alpha, dt);
    _target.copy(player.object.position);
    gfx.render(interiors.room.scene, camera, { exposure: MOOD.exposure, time: simTime });
    audio.update(null, dt);
    audio.sirens([], _target, simTime, 0);
    radio.update(false);
    hud.vehicle(driving);
    hud.playerStatus(wanted, police, life, combat, true);
    hud.minimap(performance.now(), doorFocus(), camera, police, wanted, false, missions.marks());
    hud.mission(Side.hud() ?? missions.hud());
    hud.sidePrompt(null);
    hud.update(performance.now(), clockNow(), doorFocus(), { fps: loop.stats.fps, ...gfx.frame, cars: 0 });
  };

  // ---- PASS 15b: photo mode (frozen simulation, free camera) and speed lines
  const photo = new PhotoMode({ ground: (x, z) => world.groundHeight(x, z) });
  const speedLines = new SpeedLines(document.getElementById('speedlines'));
  let lastAlpha = 1;
  const canPhoto = () => started && !title.active && !customs.open && !interiors.inside && !life.incident;
  // the audio clock (engine, radio, sirens) stops with the world; also if audio first starts during photo mode
  const holdAudio = () => { if (audio.ctx?.state === 'running' && !holdAudio.asked) { holdAudio.asked = true; audio.ctx.suspend().catch(() => {}); } };
  // world state on entering / leaving photo mode (tool hook: leaving must give back exactly what entering saw)
  const photoSnaps = { enter: null, exit: null };
  const worldSnap = () => ({ simTime, minutes: Time.totalMinutes(), day: Time.dayNumber(), hp: life.hp, money: life.money, wanted: wanted.heat,
    player: { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw }, driving: driving.state,
    car: driving.vehicle ? { id: driving.vehicle.id, x: driving.vehicle.x, z: driving.vehicle.z, yaw: driving.vehicle.yaw, speed: driving.vehicle.speed } : null,
    fleet: vehicles.vehicles.reduce((h, v) => h + v.x * 1.7 + v.z * 3.1 + v.speed, 0), peds: crowd.peds.reduce((h, p) => h + p.x + p.z * 2, 0),
    camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z, qx: camera.quaternion.x, qy: camera.quaternion.y, qz: camera.quaternion.z, qw: camera.quaternion.w, fov: camera.fov } });
  const enterPhoto = () => {
    photoSnaps.enter = worldSnap(); photoSnaps.exit = null;
    if (!photo.enter(camera, _target)) return false;
    holdAudio.asked = false; holdAudio();
    return true;
  };
  const exitPhoto = () => {
    if (!photo.exit(camera)) return false;
    photoSnaps.exit = worldSnap();
    holdAudio.asked = false;
    audio.ctx?.resume().catch(() => {});
    input.consumeLook();
    return true;
  };

  const marker = new MissionMarker(scene);
  const missions = new Missions({ world, vehicles, driving, player, wanted, life, chase, crowd, marker, rng: rng.fork('missions'),
    onSaved: (reason) => autosave(reason) });
  Side.setStoryGuard(() => missions.phase === 'active' || missions.phase === 'choice');
  const safePoints = [[32.2, 150], [-112.5, -160], [127.5, -65], [150, 218], [-60, 270], [-112.5, 25], [32.2, -80]];

  gfx.resize(camera);
  addEventListener('resize', () => gfx.resize(camera));

  let simTime = 0;
  let saveClock = 0;
  let started = autostart;     // no autosave while the start card is up (it would overwrite the save before Continue)
  let auto = null;
  let probeWish = null;
  const incident = (arrest) => {
    if (life.incident) return;
    const loss = Math.min(life.money, arrest ? wanted.level * 15 + 10 : 25);
    life.money -= loss;
    life.incident = { title: arrest ? 'ARRESTED' : 'FLATLINED', message: arrest ? `Fine $${loss} · Release pending` : `Lost $${loss} · Returning to safety`, time: 2.6 };
    wanted.reset();
    if (driving.vehicle) {
      driving.vehicle.ctrl.throttle = 0;
      driving.vehicle.ctrl.brake = 1;
    }
  };
  const hurt = amount => {
    if (life.immunity > 0 || life.incident) return;
    life.hp = Math.max(0, life.hp - amount);
    life.immunity = 0.55;
    if (!life.hp) incident(false);
  };
  const release = () => {
    const { x, z } = player.pos;
    const byDistance = (a, b) => Math.hypot(a[0] - x, a[1] - z) - Math.hypot(b[0] - x, b[1] - z);
    const clear = ([x, z]) => world.layout.walkable(x, z) && !world.colliders.resolveCircle({ x, z }, 0.4, 0.16, 1.8)
      && !vehicles.pushWalker({ x, z }, 0.45);
    const points = [...safePoints].sort(byDistance);
    const [sx, sz] = points.find(clear) ?? points[0];
    driving.reset();
    player.spawn(sx, sz);
    chase.snap(player.pos, 0);
    player.autoWish = null; auto = null; probeWish = null;
    life.hp = 100; life.immunity = 2; life.incident = null;
    if (missions.phase === 'idle') autosave('incident');
  };
  vehicles.onPair = (a, b, speed, nx, nz) => {
    missions.onPair(a, b, speed);
    const v = driving.driving ? driving.vehicle : null;
    if (!v || (a !== v && b !== v) || speed < 2.5 || life.incident) return;
    const other = a === v ? b : a, sign = a === v ? -1 : 1;
    const initiated = (v.vx * nx + v.vz * nz) * sign;
    const policeApproach = -(other.vx * nx + other.vz * nz) * sign;
    if (initiated > 2 && initiated >= policeApproach * 0.65 && !missions.exempt(other)) reportCrime(other.type.name === 'police' ? 'cruiser' : 'collision', v);
    if (other.policeUnit?.siren && policeApproach > 5 && speed > 6) hurt(Math.min(46, (speed - 3) * 2.8));
  };
  crowd.onContact = (p, v) => {
    if (!p.hp || !driving.driving || v !== driving.vehicle || v.speed < 2.7 || life.incident) return;
    reportCrime('pedestrian', v, { exclude: p });
    crowd.damage(p, Math.min(60, v.speed * 4));
  };
  const walkerContact = v => {
    if (v.policeUnit?.siren && v.speed > 6) hurt(Math.min(42, (v.speed - 2) * 2.8));
  };
  const _ped = { x: 0, z: 0 };
  const _policePosition = { x: 0, y: 0, z: 0 };
  // PASS 7: feedback watches the state after every fixed step (so tools that only step see it too)
  const update = (dt) => {
    // PASS 15b photo mode: no simulation step at all while it is open (clock, traffic, police, missions hold)
    if (photo.active) { if (photo.step(input) === 'exit') exitPhoto(); input.clearTaps(); return; }
    if (canPhoto() && input.tap('KeyP')) { enterPhoto(); input.clearTaps(); return; }
    // PASS 14b weapon wheel: held open with Tab on foot; the street runs at 20 % meanwhile
    const wheelOk = started && !title.active && !interiors.inside && !customs.open && !life.incident && driving.state === 'foot';
    if (wheelOk && (probeWheel || input.down(WHEEL_KEY))) {
      wheel.show();
      for (let i = 1; i <= 9; i++) if (input.tap(`Digit${i}`)) wheel.select(wheel.options[i - 1]);
    } else if (wheel.open) {
      const id = wheel.close();
      if (id) feedback.toast('objective', 'WEAPON', Weapons.weapon(id).name);
    }
    combat.locked = wheel.open;
    simStep(dt * wheel.timeScale);
    if (started && !customs.open) {
      const mh = Side.hud() ?? missions.hud();
      feedback.update({ objective: mh.objective, phase: mh.phase, wanted: wanted.level, hp: life.hp, result: mh.result, incident: !!life.incident }, simTime);
    }
  };
  const simStep = (dt) => {
    simTime += dt;
    if (title.active) titleStep(dt);
    Time.advance(dt);
    Weather.update(dt);
    if (interiors.inside) {                       // PASS 11: inside a room the street is paused (no traffic, crowd, police, missions)
      if (interiors.step(dt, input) === 'exit') leaveInterior();
      input.clearTaps();
      return;
    }
    const lifeFocus = driving.vehicle ?? player.pos;
    Life.update(dt, { x: lifeFocus.x, z: lifeFocus.z, wanted: wanted.level, driving: driving.driving,
      speed: driving.driving ? driving.vehicle.speed : player.speed });
    if (customs.open) { customs.step(dt); input.clearTaps(); return; }
    missions.update(dt, input);
    if (Side.running() && (missions.phase === 'active' || missions.phase === 'choice')) Side.cancel();
    saveClock += dt;
    if (started && saveClock > 20 && missions.phase === 'idle' && !life.incident) autosave('periodic');
    if (life.incident) {
      life.incident.time -= dt;
      if (life.incident.time <= 0) release();
      input.clearTaps();
      return;
    }
    life.immunity = Math.max(0, life.immunity - dt);
    if (auto) auto.step(player);
    if (probeWish) player.autoWish = probeWish;
    const walking = driving.preStep(dt, input);
    // PASS 14b: C toggles crouch on foot, O changes into the next owned outfit
    if (driving.state !== 'foot') stealth.crouched = false;
    else if (input.tap(CROUCH_KEY)) stealth.toggleCrouch(true);
    player.crouched = stealth.crouched;
    if (walking && driving.state === 'foot' && input.tap(Outfits.OUTFIT_KEY)) {
      const id = Outfits.cycle({ wanted, seen: police.seen });
      if (id) feedback.toast('objective', 'OUTFIT', Outfits.OUTFITS[id].name);
    }
    if (walking) {
      player.update(dt, input, chase.yaw);
      vehicles.pushWalker(player.pos, 0.34, walkerContact);
    }
    const pv = driving.driving ? driving.vehicle : null;
    vehicles.playerVehicle = driving.vehicle;
    const canCustom = !!pv && driving.state === 'driving' && pv.speed < 3 && customs.onBay(pv) && pv.type.name !== 'police' && !pv.mission
      && missions.phase === 'idle' && wanted.level === 0 && !Side.running();
    customs.showPrompt(canCustom);
    if (canCustom && input.tap('KeyG')) { customs.enter(pv); input.clearTaps(); return; }
    // PASS 7 radio: R or . next station, , previous (only in a car; R reloads on foot)
    if (pv && driving.state === 'driving') {
      if (input.tap('KeyR', 'Period')) radio.next();
      else if (input.tap('Comma')) radio.prev();
    }
    const focus = pv ?? player.pos;
    // PASS 16: side jobs start at their spots (E), on foot or in a car as the job needs
    const sideSpot = !Side.running() && missions.phase === 'idle' && wanted.level === 0 && !combat.aiming
      ? Side.spotAt(focus.x, focus.z) : null;
    const sideOk = !!sideSpot && (sideSpot.needsCar ? !!pv && driving.state === 'driving' : driving.state === 'foot' || (!!pv && driving.state === 'driving'));
    hud.sidePrompt(sideSpot ? (sideOk ? `Start ${sideSpot.label}` : `${sideSpot.label} \u00b7 needs a car`) : null);
    if (sideOk && input.tap('KeyE') && Side.startSpot(sideSpot)) feedback.toast('objective', Side.hud()?.title ?? 'SIDE JOB', 'Job started');
    Side.update(dt, focus);
    if (started) Collectibles.collectAt(focus.x, focus.z);       // PASS 16: harbour tags (on foot or driving through)
    // PASS 16: money paid straight into life.money (missions, arrests) reaches the wallet the shops and the save read
    if (started && Math.round(life.money) !== Wallet.balance()) syncWallet();
    Object.assign(_policePosition, { x: focus.x, y: pv ? pv.gY : focus.y, z: focus.z });
    combat.update(dt, simTime, input, walking && !life.incident, chase.camera);
    police.update(dt, _policePosition, pv, pv ? { x: pv.vx, z: pv.vz } : player.vel, () => incident(true));
    stealth.update(dt, { foot: walking ? { speed: player.speed, sprint: player.sprint } : null, car: pv && driving.driving ? { speed: pv.speed } : null });
    if (Outfits.update(dt, wanted, police.seen, focus)) feedback.toast('complete', 'DISGUISED', 'One star dropped');
    if (life.incident) { input.clearTaps(); return; }
    _ped.x = player.pos.x; _ped.z = player.pos.z;
    vehicles.populate(player.pos, player.yaw, dt);
    vehicles.step(dt, simTime, driving.state === 'foot' ? _ped : null);
    if (walking) vehicles.pushWalker(player.pos, 0.34, walkerContact);
    Doors.track(player.pos.x, player.pos.z);
    // PASS 11: E at one of the five interior doors (on foot, no story mission or side job running)
    const doorSite = walking && driving.state === 'foot' && !combat.aiming && missions.phase === 'idle' && !Side.running()
      ? interiors.siteAt(player.pos.x, player.pos.z) : null;
    interiors.showStreetPrompt(doorSite);
    if (doorSite && input.tap('KeyE') && enterInterior(doorSite)) { input.clearTaps(); return; }
    if (driving.vehicle) lastCar = driving.vehicle;
    crowd.setChase(wanted.level > 0 && police.seen);
    crowd.update(dt, player, vehicles.vehicles, driving.driving);
    effects.step(dt, vehicles.vehicles, player.pos);
    if (pv && driving.driving) {
      if (pv.impact > 1.5) { carCam.shake(Math.min(0.9, pv.impact * 0.09)); Life.reportCrash(pv.x, pv.z); stealth.bang(Math.min(1, 0.45 + pv.impact * 0.08)); }
      if (pv.bump) carCam.shake(pv.bump * 0.25);
    }
    input.clearTaps();
  };
  const _target = new THREE.Vector3();
  const frameCamera = (alpha, dt, look) => {
    if (driving.driving) {
      const pose = driving.pose(alpha);
      carCam.update(dt, pose, look);
      _target.set(pose.x, pose.y, pose.z);
      // keep the on-foot camera trailing so the exit blend starts from a sane pose
      chase.pivot.set(pose.x, pose.y + 1.55, pose.z);
    } else {
      player.render(alpha);
      _target.copy(player.object.position);
      chase.aiming = combat.aiming;
      chase.recoil = combat.recoil;
      chase.update(dt, _target, player, look);
      if (rig.w > 0 && driving.state === 'entering') carCam.update(dt, driving.pose(1), null);
    }
    rig.apply(dt, chase.camera, carCam.cam);
    combat.render(camera, driving.state === 'foot');
    return _target;
  };
  const _res = new THREE.Vector2();
  const draw = (alpha, photoPass = null) => {
    applyLook();                       // PASS 16: sun / sky / fog / lamps for this clock and weather, before the shadow follows the sun
    world.followShadow(_target);
    world.fx.begin();
    world.update(simTime, camera);
    carRender.update(customs.open ? customs.visibleCars(vehicles.vehicles) : vehicles.vehicles, alpha, camera, driving.driving ? driving.vehicle : null, world.fx, simTime);
    if (customs.open) customs.light(carRender.spot);
    policeVisuals.render(police.units, simTime, alpha, world.fx);
    missions.render(simTime);
    const sw = Side.waypoint();
    if (sw) marker.set({ ...sw, y: world.groundHeight(sw.x, sw.z) }, simTime);
    effects.render();
    gfx.renderer.getDrawingBufferSize(_res);
    world.fx.end(camera, simTime, _res);
    rain.update(camera, simTime, Daylight.LOOK.rain, rainLit());
    drawTags(simTime);
    gfx.render(scene, camera, { exposure, time: simTime, photo: photoPass });
  };
  const render = (alpha, dt) => {
    if (photo.active) {
      // the frozen frame, seen from the free camera; the HUD is hidden and not updated
      photo.frame(camera, dt, input.consumeLook(), input);
      holdAudio();
      draw(lastAlpha, photo.params(camera));
      if (photo.shotPending) photo.capture(canvas);
      return;
    }
    lastAlpha = alpha;
    if (interiors.inside) { renderInterior(alpha, dt); return; }
    if (customs.open) { input.consumeLook(); customs.frame(camera); _target.set(customs.vehicle.x, 0, customs.vehicle.z); }
    else if (title.active) { input.consumeLook(); player.render(alpha); _target.set(...titleCamera(camera, titleScene.t)); }
    else if (wheel.open) { const look = input.consumeLook(); wheel.point(look.x, look.y); if (look.wheel) wheel.step(look.wheel); frameCamera(alpha, dt, NO_LOOK); }
    else frameCamera(alpha, dt, input.consumeLook());
    draw(alpha);
    audio.update(driving.driving ? driving.vehicle : null, dt);
    audio.sirens(life.incident ? [] : police.units, _target, simTime, driving.driving ? carCam.yaw : chase.yaw);
    hud.vehicle(driving);
    hud.playerStatus(wanted, police, life, combat, driving.state === 'foot');
    hud.weaponWheel(wheel.state(), stealth.crouched && driving.state === 'foot');
    // HUD clock: wall time in play; simulation time in the tools' still mode (stage() sets ui-still), so a staged
    // frame's minimap pulse and siren flash depend on the simulation alone, not on how long the tool waited
    const hudNow = document.body.classList.contains('ui-still') ? simTime * 1000 : performance.now();
    hud.minimap(hudNow, mapFocus(), camera, police, wanted, false, mapMarks());
    const mh = Side.hud() ?? missions.hud();
    hud.mission(mh);
    if (life.incident || title.active || customs.open) hud.sidePrompt(null);
    const inCar = driving.driving && driving.state === 'driving' && !title.active && !customs.open;
    // PASS 15: announce getting in / out of a vehicle (the radio listens)
    const seated = driving.state === 'driving' && !!driving.vehicle;
    if (seated !== wasSeated) { wasSeated = seated; emit(seated ? 'vehicle:entered' : 'vehicle:exited', { type: driving.vehicle?.type?.name ?? null }); }
    radio.update(inCar && !life.incident);
    if (driving.driving) hud.radio(radio.nowPlaying());
    hud.radioPanel(STATIONS, radio.index, radio.tunedAt, inCar);
    speedLines.update(inCar && driving.vehicle ? Math.abs(driving.vehicle.fwd) * 3.6 : 0, dt, document.body.classList.contains('ui-still'));
    hud.update(hudNow, clockNow(), driving.driving ? driving.vehicle : player,
      { fps: loop.stats.fps, ...gfx.frame, cars: carRender.drawn });
  };
  const clockNow = () => ({ day: Time.dayNumber(), minutes: Time.totalMinutes(), weather: Weather.current() });
  // PASS 16: a running side job shows its target (not the story contact); idle, the three job spots show as blips
  const mapMarks = () => {
    const sw = Side.waypoint();
    if (sw) return [{ x: sw.x, z: sw.z, kind: 'objective', pin: true }];
    const out = missions.marks();
    if (missions.phase === 'idle') for (const sp of Side.SPOTS) out.push({ x: sp.x, z: sp.z, kind: 'side' });
    return out;
  };
  const _mapFocus = { x: 0, z: 0, yaw: 0 };
  const mapFocus = () => {
    const v = driving.driving ? driving.vehicle : null;
    _mapFocus.x = v ? v.x : player.pos.x; _mapFocus.z = v ? v.z : player.pos.z; _mapFocus.yaw = v ? v.yaw : player.yaw;
    _mapFocus.speed = v ? v.speed : player.speed;
    return _mapFocus;
  };
  // ---- PASS 7 title scene: the city keeps running; the player is hidden and takes
  // no input; a car drives up the avenue past the camera every ~13 s.
  const TITLE_CARS = [['sports', '#ff6a1a'], ['sedan', '#1d2633'], ['suv', '#e8e4dc'], ['sports', '#00a6c8']];
  const titleScene = { t: 0, car: null, carT: 0, n: 0 };
  const TITLE_SPOT = [72, 214, -Math.PI / 2];    // the hidden player stands on the promenade so traffic and crowd fill the shot
  if (title.active) { player.spawn(...TITLE_SPOT); crowd.reset(player.pos); vehicles.populate(player.pos, TITLE_SPOT[2], 1, true); }
  function titleCar() {
    if (titleScene.car) vehicles.vehicles = vehicles.vehicles.filter((v) => v !== titleScene.car);
    const [type, paint] = TITLE_CARS[titleScene.n++ % TITLE_CARS.length];
    // westbound on the waterfront street, from just behind the camera into the sunset
    titleScene.car = vehicles.spawn(type, 126, 198.25, -Math.PI / 2, chauffeur, { route: [[120, 200], [40, 200]], cruise: 14, paint });
    titleScene.carT = 0;
  }
  function titleStep(dt) {
    titleScene.t += dt;
    titleScene.carT += dt;
    input.clearTaps();
    player.autoWish = { x: 0, z: 0 };
    player.object.visible = player.blob.visible = false;
    const c = titleScene.car;
    if (!c || titleScene.carT > 13 || !vehicles.vehicles.includes(c)) titleCar();
  }
  function leaveTitle() {
    title.hide();
    const tr = document.getElementById('transition');      // PASS 15b: dip and sweep into play
    tr.classList.remove('play'); void tr.offsetWidth; tr.classList.add('play');
    titleScene.car = null;               // the world reset that follows removes it from the fleet
    player.autoWish = null;
    player.object.visible = player.blob.visible = true;
    camera.fov = 60; camera.updateProjectionMatrix();
  }
  const loop = createLoop({ update, render });

  hud.progress(0.95, 'Compiling shaders');
  await nextFrame();
  gfx.renderer.compile(scene, camera);
  render(0, STEP);
  hud.progress(1, 'Ready');
  hud.ready(autostart);
  if (title.active) title.show();
  document.getElementById('build-version').textContent = `BUILD ${BUILD}`;
  document.getElementById('title-seed').textContent = String(seed);
  loop.start();

  // ---- save / load ------------------------------------------------------------
  // Schema v2: every registered system serializes itself (clock, weather, wallet,
  // inventory, ...); the gameplay-owned sections are overridden here. What a save
  // holds: money, mission progress (+ ending), the checkpoint (the next mission's
  // contact), wanted heat and the owned car. Mid-mission state is not saved:
  // a reload resumes at that mission's contact.
  function buildSave() {
    const ownedCar = vehicles.vehicles.find((v) => v.owned);
    const link = ownedCar?.garageId ?? null;
    if (link !== Garage.active() && (link === null || Garage.get(link))) Garage.setActive(link);
    return collectSave({
      player: { checkpoint: missions.checkpoint(), wanted: Math.round(wanted.heat * 100) / 100 },
      wallet: { money: Math.max(0, Math.round(life.money)) },
      garage: { owned: missions.owned },
      missions: { progress: missions.progress, ending: missions.ending },
    });
  }
  let lastSave = null;
  let appliedLook = null;
  function autosave(reason) {
    saveClock = 0;
    if (!started) return { skipped: true };
    const r = writeSave(buildSave());
    lastSave = { reason, ok: !!r.ok, error: r.error ?? null, at: +simTime.toFixed(2) };
    return r;
  }
  // The player's car after a reload takes the hero car's slot in the fleet, so the
  // vehicle count is the same as a fresh start (no duplicate cars).
  function restoreOwned(owned, park) {
    const old = vehicles.hero;
    const v = new Vehicle(old.id, owned.type, new THREE.Color(owned.paint));
    v.owned = true;
    v.place(park.x, park.z, park.yaw);
    v.settle(vehicles.ground.height, 1);
    vehicles.vehicles[vehicles.vehicles.indexOf(old)] = v;
    vehicles.hero = v;
  }
  // Rebuild the seeded world, then lay the save over it. Idempotent: loading twice
  // gives the same world as loading once.
  function applySave(data) {
    loop.stop();
    resetWorld();
    simTime = 0;
    life.money = data.money;
    missions.progress = data.mission; missions.ending = data.ending; missions.owned = data.owned;
    const c = data.checkpoint;
    player.spawn(c.x, c.z, c.yaw);
    chase.snap(player.pos, c.yaw);
    crowd.reset(player.pos);
    vehicles.populate(player.pos, c.yaw, 1, true);
    if (data.owned) restoreOwned(data.owned, missions.parkSpot());
    if (data.wanted > 0) { wanted.heat = data.wanted; wanted.report = { x: c.x, z: c.z }; }
    restoreSections(data);                          // clock, weather, wallet, inventory, ... back to their systems
    // PASS 15b: a saved outfitId / colours (when the save has them) over the wardrobe look
    const look = savedLook();
    if (look) restyle(lookPalette(outfitPalette(), look));
    appliedLook = look;
    // PASS 10c: the restored car wears what the garage fitted (its record is the active one)
    const rec = data.owned && Garage.active() ? Garage.get(Garage.active()) : null;
    if (rec && rec.typeId === data.owned.type) { applyRecord(vehicles.hero, rec); missions.owned = { type: rec.typeId, paint: rec.colour }; }
    missions.declined = missions.contactIndex;      // don't open the briefing the moment we land on the contact
    frameCamera(1, STEP, NO_LOOK); draw(1);
    loop.start();
  }
  function continueGame() {
    const save = readSave();
    if (!save.data) return { ok: false, error: save.error ?? 'no save' };
    try { applySave(save.data); } catch (e) { console.warn('save rejected while loading', e); return { ok: false, error: String(e.message ?? e) }; }
    return { ok: true, data: save.data };
  }
  function newGame() {
    loop.stop();
    resetWorld();
    simTime = 0;
    missions.progress = 0; missions.ending = null; missions.owned = null;
    Garage.reset();
    Factions.reset();
    Time.reset();
    Weather.init(seed);         // PASS 16: a new game also starts clear and dry,
    Wallet.reset();             // with the opening balance, an empty bag and full shelves
    Inventory.reset();
    Shop.restock();
    Collectibles.reset();
    Achievements.reset();
    Weapons.reset();            // PASS 14b: pistol in hand, courier clothes
    Outfits.reset();
    resetWardrobe();
    player.spawn(32.2, 150, 0);
    chase.snap(player.pos, 0);
    crowd.reset(player.pos);
    vehicles.populate(player.pos, 0, 1, true);
    missions.say(STORY.intro, 4);
    if (readSave().data || readSave().error) clearSave();
    frameCamera(1, STEP, NO_LOOK); draw(1);
    loop.start();
  }
  addEventListener('pagehide', () => { if (started && missions.phase === 'idle' && !life.incident) autosave('pagehide'); });

  const startSave = readSave();
  hud.saveState(startSave);
  if (title.active) title.show();          // again, now that Continue is shown or hidden: focus starts on the first row
  const play = (fn) => (e) => { e.stopPropagation(); if (started) return; started = true; leaveTitle(); fn(); hud.hideStart(); input.requestLock(); };
  // New game always rebuilds the seeded world (the city has been ticking behind the start card)
  // and clears any save; it also queues the intro lines.
  const fresh = play(() => newGame());
  const resume = play(() => { if (!continueGame().ok) newGame(); });
  document.getElementById('continue').addEventListener('click', resume);
  document.getElementById('play').addEventListener('click', fresh);
  canvas.addEventListener('click', () => { if (!started) return; hud.hideStart(); input.requestLock(); });
  for (const [id, which] of [['choice-press', 'press'], ['choice-deal', 'deal']]) {
    document.getElementById(id).addEventListener('click', (e) => { e.stopPropagation(); missions.choose(which); });
  }

  const info = gfx.renderer.info;
  const _vp = new THREE.Matrix4(), _frustum = new THREE.Frustum(), _probeV = new THREE.Vector3(), _probeDir = new THREE.Vector3();
  const NO_LOOK = { x: 0, y: 0, wheel: 0 };
  // Put the world back to its seeded start: fleet, effects, player on foot.
  const resetWorld = () => {
    if (photo.active) exitPhoto();
    if (interiors.inside) leaveInterior();
    driving.reset();
    vehicles.reset();
    vehicles.playerVehicle = null;
    wanted.reset(); police.reset(); combat.reset(); stealth.reset(); wheel.reset();
    probeWheel = false; lastReport = null; player.crouched = false;
    Object.assign(life, { hp: 100, money: 250, immunity: 0, incident: null });
    effects.reset();
    feedback.reset();
    missions.reset();
    Side.cancel();
    Life.reset();
    crowd.reset(player.pos);
    auto = null;
    probeWish = null;
    player.autoWish = null;
  };
  const S = CITY.streets;
  const nodeOf = (x, z) => ({ i: S.indexOf(x), j: S.indexOf(z), x, z });
  // An AI chauffeur for the player's car (gate autopilot and staged drives).
  const chauffeur = (v, from, to, opts) => new TrafficDriver(v, rng.fork('autopilot'), nodeOf(...from), nodeOf(...to), opts);

  window.__scene = scene;
  window.__world = world;   // PASS 17c: tools/probe_walls.mjs reads colliders, layout and drawn meshes
  window.__gfx = gfx;
  window.__game = {
    ready: true,
    seed,
    env: () => ({ minutes: Time.minutes(), hour: Time.hour(), weather: Weather.current(), wetness: +Weather.wetness().toFixed(3) }),
    wallet: () => ({ balance: Wallet.balance() }),
    collectibles: () => ({ total: Collectibles.TOTAL, found: Collectibles.foundCount(), radius: Collectibles.PICK_RADIUS, reward: Collectibles.REWARD, tags: Collectibles.list(), drawn: tagMesh.visible ? tagMesh.count : 0 }),
    achievements: () => Achievements.list(),
    hudMoney: () => document.getElementById('money')?.textContent ?? null,
    toasts: () => feedback.toasts.map((t) => ({ kind: t.kind, head: t.head, text: t.text })),
    // ---- PASS 16 tool hooks: clock, weather and the live look
    setClock(minutes) { Time.restore({ minutes: ((minutes % 1440) + 1440) % 1440, day: Time.dayNumber() }); return this.env(); },
    setWeather(state, wetness) { const ok = Weather.snap(state, wetness); return ok ? this.env() : null; },
    daylight() {
      applyLook();                                   // the look for the current clock + weather (setClock / step do not draw)
      rain.update(camera, simTime, Daylight.LOOK.rain, rainLit());
      const L = Daylight.LOOK, sky = scene.children.find((o) => o.material?.uniforms?.uZenith);
      const hex = (c) => '#' + c.getHexString();
      return { hour: +L.hour.toFixed(3), weather: L.weather, sunDir: L.sunDir.toArray().map((v) => +v.toFixed(4)), sunIntensity: +L.sunIntensity.toFixed(4),
        sunColor: hex(L.sunColor), skyZenith: hex(L.skyZenith), skyHorizon: hex(L.skyHorizon), fogColor: hex(L.fogColor), fogDensity: +L.fogDensity.toFixed(6),
        hemiIntensity: +L.hemiIntensity.toFixed(4), lamps: +L.lamps.toFixed(4), glow: +L.glow.toFixed(4), exposure: +L.exposure.toFixed(4), wet: +L.wet.toFixed(4),
        wetCover: +L.wetCover.toFixed(4), rain: +L.rain.toFixed(4), rainVisible: rain.mesh.visible, bound: daylight.bound.length, extra: daylight.extra.length,
        // what the GPU actually gets
        applied: { sun: +world.sun.intensity.toFixed(4), fog: +scene.fog.density.toFixed(6), fogColor: hex(scene.fog.color), lmStrength: +world.lm.uniforms.uLmStrength.value.toFixed(4),
          glowGain: +world.fx.gain.value.toFixed(4), skyLive: !!sky && sky.material.uniforms.uZenith.value === L.skyZenith, exposure: +exposure.toFixed(4) },
        mood: { sunDir: MOOD.sunDir.toArray().map((v) => +v.toFixed(4)), sunIntensity: MOOD.sunIntensity, sunColor: hex(MOOD.sunColor), skyZenith: hex(MOOD.skyZenith),
          skyHorizon: hex(MOOD.skyHorizon), fogColor: hex(MOOD.fogColor), fogDensity: MOOD.fogDensity, hemiIntensity: MOOD.hemiIntensity, exposure: MOOD.exposure } };
    },
    // draw one frame and average the canvas (sky band at the top, street band at the bottom) in the same task
    // luma(from, to): the same from a fixed camera pose (an open view, so the sky and the street are both in frame)
    luma(from = null, to = null) {
      loop.stop();
      if (from && to) {
        camera.position.set(...from); camera.lookAt(...to); camera.fov = 60; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
        _target.set(...to);
        draw(1);
      } else render(1, STEP);
      const c = document.createElement('canvas'); c.width = 64; c.height = 36;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(canvas, 0, 0, 64, 36);
      const d = g.getImageData(0, 0, 64, 36).data;
      const band = (y0, y1) => { let r = 0, gg = 0, b = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < 64; x++) { const i = (y * 64 + x) * 4; r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; } return { r: r / n, g: gg / n, b: b / n, l: (0.3 * r + 0.55 * gg + 0.15 * b) / n }; };
      return { all: band(0, 36), top: band(0, 8), bottom: band(24, 36), calls: gfx.frame.calls };
    },
    // PASS 10c tool hooks: the garage menu and the customised look of a car
    customs: {
      site: () => ({ ...CUSTOMS_SITE }),
      state: () => customs.state(),
      enter() { const v = driving.vehicle; if (!v || driving.state !== 'driving') return false; const ok = customs.enter(v); if (ok) render(1, STEP); return ok; },
      select: (key, id) => customs.select(key, id),
      buy() { const r = customs.buy(); render(1, STEP); return r; },
      leave() { const ok = customs.leave(); if (ok) render(1, STEP); return ok; },
      garage: () => ({ list: Garage.list(), active: Garage.active() }),
    },
    look(id = driving.vehicle?.id) {
      const v = vehicles.vehicles.find((o) => o.id === id);
      if (!v) return null;
      return { id: v.id, type: v.type.name, garageId: v.garageId ?? null, owned: !!v.owned, paint: '#' + v.paint.getHexString(), look: v.look ?? null };
    },
    // what the renderer drew for the car last frame: its instance attributes and bolt-on meshes
    carDraw(id = driving.vehicle?.id) {
      const v = vehicles.vehicles.find((o) => o.id === id);
      if (!v) return null;
      const out = { parts: {}, wheels: {}, glow: carRender.glow.count };
      for (const [n, m] of Object.entries(carRender.parts)) out.parts[n] = m.visible ? m.count : 0;
      for (const [n, m] of Object.entries(carRender.wheelStyles)) out.wheels[n] = m.visible ? m.count : 0;
      const mesh = v.drawMesh, ix = v.drawIndex;
      if (!mesh || ix >= mesh.count) return { ...out, body: null };
      const a = mesh.geometry.attributes, e = new THREE.Matrix4(), p = new THREE.Vector3();
      mesh.getMatrixAt(ix, e); p.setFromMatrixPosition(e);
      out.body = { mesh: mesh.name, iCustom: Array.from(a.iCustom.array.slice(ix * 4, ix * 4 + 4)), iLivery: Array.from(a.iLivery.array.slice(ix * 4, ix * 4 + 3)).map((x) => +x.toFixed(3)),
        iPaint: Array.from(a.iPaint.array.slice(ix * 3, ix * 3 + 3)).map((x) => +x.toFixed(3)), y: +(p.y - v.gY).toFixed(4) };
      out.spot = '#' + carRender.spot.color.getHexString(); out.spotBase = '#' + carRender.spotBase.getHexString();
      return out;
    },
    inventory: () => Inventory.list(),
    inventoryAdd: (id, n = 1) => Inventory.add(id, n),         // PASS 14b tool hook (weapon / clothing ownership)
    inventoryRemove: (id, n = 1) => Inventory.remove(id, n),
    doors: () => Doors.doors(),
    // ---- PASS 11 tool hooks: interiors (enter/leave go through the real E-at-door path in the probe)
    interiors: () => interiors.state(),
    // stand on an interactable inside the current room (bed, wardrobe, counter, terminal, exit)
    interiorGoto(id) {
      const u = interiors.room?.use.find((o) => o.id === id);
      if (!u) return false;
      const a = Math.atan2(u.x - player.pos.x, u.z - player.pos.z);
      player.spawn(u.x, u.z, a);
      return true;
    },
    stats: world.stats,
    frame: () => ({ fps: loop.stats.fps, calls: gfx.frame.calls, triangles: gfx.frame.triangles,
      geometries: info.memory.geometries, textures: info.memory.textures, carsDrawn: carRender.drawn, carLods: { ...carRender.levels }, res: gfx.resolution() }),
    player: () => ({ x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, speed: player.speed, phase: player.phase,
      driving: driving.driving, vehicle: driving.vehicle ? { id: driving.vehicle.id, type: driving.vehicle.type.name, speed: driving.vehicle.speed, gear: driving.vehicle.gear } : null }),
    // PASS 10a2: every car in the fleet with its model and collection tier (null for
    // everyday / police bodies), position (y: ground under the wheels) and speed (m/s, km/h)
    vehicles: () => vehicles.vehicles.map((v) => ({ id: v.id, type: v.type.name, model: v.type.label, tier: v.type.tier,
      position: { x: +v.x.toFixed(2), y: +v.gY.toFixed(2), z: +v.z.toFixed(2) }, x: +v.x.toFixed(2), z: +v.z.toFixed(2),
      speed: +v.speed.toFixed(2), kmh: +(v.speed * 3.6).toFixed(1), ai: !!(v.driver && v.driver !== 'player'), parked: !v.driver, sleeping: v.sleeping })),
    population: () => {
      // on screen: chest inside the render camera's frustum, within 60 m, with a clear line from the camera
      _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _frustum.setFromProjectionMatrix(_vp);
      // los: clear line from the camera eye within 60 m (any direction); onScreen: also inside the current view
      const los = (p) => {
        _probeV.set(p.x, p.y + p.height * 0.6, p.z);
        const d = _probeV.distanceTo(camera.position);
        if (d > 60) return false;
        _probeDir.subVectors(_probeV, camera.position).normalize();
        return world.colliders.raycast(camera.position, _probeDir, d) >= d - 0.05;
      };
      const seen = (p) => los(p) && _frustum.containsPoint(_probeV.set(p.x, p.y + p.height * 0.6, p.z));
      return { peds: crowd.peds.map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, height: p.height, hp: p.hp, speed: p.actualSpeed, flee: p.flee, los: los(p), onScreen: seen(p) })), camera: { x: camera.position.x, z: camera.position.z, hfov: 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect) },
      vehicles: vehicles.vehicles.map((v) => ({ id: v.id, x: v.x, y: v.gY, z: v.z, yaw: v.yaw, radius: v.type.radius, circles: v.type.circles, speed: v.speed, ai: !!(v.driver && v.driver !== 'player') })),
      props: world.props.locations, caps: { peds: 18, vehicles: vehicles.cap },
      resources: { objects: scene.children.length, geometries: info.memory.geometries, textures: info.memory.textures },
      boxes: world.colliders.boxes.filter((b) => b.tag === 'building'),
    }; },
    ground: (x, z) => world.groundHeight(x, z),
    walkable: (x, z) => world.layout.walkable(x, z),
    gunfire(x = player.pos.x, z = player.pos.z) { crowd.gunfire(x, z); Life.reportGunfire(x, z); },
    // PASS 13b: living world, encounters and NPC reactions (logic probe hooks)
    life: () => Life.snapshot(),
    lifeOffer: (kind, at) => Life.forceOffer(kind, at),
    lifeAccept: (id) => Life.accept(id),
    lifeIgnore: (id) => Life.ignore(id),
    lifeReaction: (x, z) => Life.reactionFor({ x, z }, Life.playerState()),
    chase(active = true) { crowd.setChase(active); },
    status() {
      return { wanted: wanted.level, heat: wanted.heat, unseen: wanted.unseen,
        hp: life.hp, money: life.money, incident: life.incident?.title ?? null, ...police.snapshot(driving.vehicle ?? player.pos), combat: combat.status() };
    },
    // ---- PASS 14b tool hooks: weapon wheel, stealth, outfits
    loadout: () => ({ equipped: Weapons.equipped().id, held: Weapons.held(), wheel: wheel.state(), outfit: Outfits.status() }),
    // hold: open (true) / release (false) the wheel as the Tab key does; select: highlight a weapon on it
    wheel({ hold, select, point, steps = 0 } = {}) {
      loop.stop();
      if (hold !== undefined) probeWheel = !!hold;
      if (hold) { update(STEP); steps = Math.max(0, steps - 1); }
      const picked = select === undefined ? null : wheel.select(select);
      if (point) wheel.point(point.x, point.y);
      for (let i = 0; i < steps; i++) update(STEP);
      if (hold === false) update(STEP);
      return { picked, ...wheel.state(), simTime };
    },
    equip: (id) => Weapons.equip(id),
    stealth: () => ({ ...stealth.status(), lastReport }),
    crouch(on) { if (stealth.crouched !== !!on) stealth.toggleCrouch(true); return stealth.status(); },
    // a crime through the same report gate every in-game crime uses
    crime(kind, opts) { const r = reportCrime(kind, player.pos, opts); return { ...r, wanted: wanted.level, heat: wanted.heat }; },
    wear: (id) => Outfits.wear(id, { wanted, seen: police.seen }),
    teleport(x, z, reset = false) {
      loop.stop();
      if (interiors.inside) leaveInterior();
      if (reset) resetWorld();
      driving.reset(); auto = null; player.autoWish = null; probeWish = null;
      player.spawn(x, z, 0); chase.snap(player.pos, 0);
      crowd.reset(player.pos); vehicles.populate(player.pos, 0, 1, true);
      frameCamera(1, STEP, NO_LOOK); draw(1);
    },
    // ---- PASS 5 tool hooks: missions and save
    missions: () => missions.status(),
    side: () => Side.state(),
    sideStart: (kind, opts) => Side.start(kind, opts),
    sideCancel: () => Side.cancel(),
    sideUpdate: (dt, pos) => { Side.update(dt, pos); return Side.state(); },
    missionLog: () => missions.log.slice(),
    missionDefs: () => MISSIONS.map((m) => ({ id: m.id, reward: m.reward, contact: m.contact, park: m.park })),
    // a key press as the keyboard delivers it (consumed by the next fixed step)
    tap(code) { input.taps.add(code); },
    // the player's car pose and handling numbers, for scripted driving
    car() {
      const v = driving.vehicle;
      return v ? { id: v.id, type: v.type.name, x: v.x, z: v.z, yaw: v.yaw, fwd: v.fwd, speed: v.speed, wheelbase: v.type.wheelbase, steerLock: v.type.steerLock, length: v.type.length, width: v.type.width } : null;
    },
    // nearby cars and pedestrians (cheap; no visibility tests)
    nearby(x, z, r = 40) {
      const pv = driving.vehicle;
      return { cars: vehicles.vehicles.filter((v) => v !== pv && Math.hypot(v.x - x, v.z - z) < r).map((v) => ({ id: v.id, x: v.x, z: v.z, yaw: v.yaw, speed: v.speed, fwd: v.fwd, half: v.type.length / 2, w: v.type.width / 2, mission: v.mission ? (v.mission.hostile ? 'hostile' : 'mission') : null, hp: v.mission?.hp ?? null, driven: !!v.driver, type: v.type.name, police: !!v.policeUnit })),
        peds: crowd.peds.filter((p) => p.hp > 0 && Math.hypot(p.x - x, p.z - z) < r).map((p) => ({ x: p.x, z: p.z })) };
    },
    // drive the player's car with scripted controls for n fixed steps (same path as the keyboard: v.ctrl)
    drive(ctrl, steps = 1) {
      loop.stop();
      const v = driving.vehicle;
      if (v && driving.state === 'driving') { driving.scripted = true; Object.assign(v.ctrl, ctrl); }
      for (let i = 0; i < steps; i++) update(STEP);
      driving.scripted = false;
    },
    walk(wish, steps = 1) {
      loop.stop();
      probeWish = wish; player.autoWish = wish;
      for (let i = 0; i < steps; i++) update(STEP);
      probeWish = null; player.autoWish = null;
    },
    step(steps = 1) { loop.stop(); for (let i = 0; i < steps; i++) update(STEP); },
    // draw the current state (scene, HUD, minimap, mission panels) without advancing the simulation
    drawNow(frames = 1) { loop.stop(); for (let i = 0; i < frames; i++) render(1, STEP); },
    // redraw the scene as staged (no camera update, no simulation step)
    drawStill() { loop.stop(); draw(1); },
    // pose the render camera explicitly and draw (visual probes; the world is not reset)
    view(from, to, fov = 50) {
      loop.stop();
      camera.position.set(...from); camera.lookAt(...to); camera.fov = fov; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      _target.set(...to);
      draw(1);
      camera.fov = 60; camera.updateProjectionMatrix();
    },
    choose(which) { return missions.choose(which); },
    save: () => autosave('tool'),
    readSave: () => readSave(),
    lastSave: () => lastSave,
    continueGame: () => { if (!started) leaveTitle(); started = true; hud.hideStart(); return continueGame(); },
    newGame: () => { if (!started) leaveTitle(); started = true; hud.hideStart(); return newGame(); },
    // ---- PASS 7 tool hooks: title, radio, feedback
    build: BUILD,
    title: () => ({ ...title.state(), t: +titleScene.t.toFixed(2), car: titleScene.car ? { type: titleScene.car.type.name, x: +titleScene.car.x.toFixed(1), z: +titleScene.car.z.toFixed(1), speed: +titleScene.car.speed.toFixed(1) } : null,
      camera: { x: +camera.position.x.toFixed(2), y: +camera.position.y.toFixed(2), z: +camera.position.z.toFixed(2) } }),
    // deterministic title frame: seeded world, `seconds` of title time simulated, menu animations off
    stageTitle(seconds = 6) {
      loop.stop();
      resetWorld();
      Time.reset();
      simTime = 0;
      Object.assign(titleScene, { t: 0, car: null, carT: 0, n: 0 });
      player.spawn(...TITLE_SPOT);
      crowd.reset(player.pos);
      vehicles.populate(player.pos, 0, 1, true);
      for (let i = 0; i < Math.round(seconds / STEP); i++) update(STEP);
      document.body.classList.add('title-still');
      render(1, STEP);
      hud._last = 0;
      hud.update(performance.now(), clockNow(), player, { fps: 60, ...gfx.frame, cars: carRender.drawn });
      return { ...this.title(), calls: gfx.frame.calls, triangles: gfx.frame.triangles };
    },
    radio: () => ({ ...radio.nowPlaying(), index: radio.index, stations: STATIONS.map((s) => ({ name: s.name, freq: s.freq, tracks: s.tracks.map((t) => ({ id: t.id, title: t.title, artist: t.artist, bpm: t.bpm, key: t.key, seconds: +t.seconds.toFixed(3) })) })),
      audio: !!audio.ctx, on: radio.on, buffer: radio.source ? { trackId: radio.source.node.buffer.trackId, duration: +radio.source.node.buffer.duration.toFixed(3), channels: radio.source.node.buffer.numberOfChannels } : null,
      hud: { hidden: document.getElementById('radio').hidden, station: document.getElementById('radio-name').textContent, track: document.getElementById('radio-track').textContent, trackId: document.getElementById('radio').dataset.track } }),
    radioTune: (i) => { radio.tune(i); return radio.nowPlaying(); },
    // PASS 15b: loudness of the buffer playing now, the station panel, speed lines
    radioLevel() {
      const b = radio.source?.node.buffer;
      if (!b) return null;
      const d = b.getChannelData(0);
      let e = 0, pk = 0, zc = 0, quiet = 0, w = 0;
      for (let i = 4; i < d.length; i += 4) { e += d[i] * d[i]; pk = Math.max(pk, Math.abs(d[i])); if ((d[i] >= 0) !== (d[i - 4] >= 0)) zc++; }
      // share of 20 ms windows well below the loop's mean level (speech gaps, sparse ambience)
      const win = Math.round(b.sampleRate * 0.02), mean = Math.sqrt(e / (d.length / 4));
      for (let i = 0; i + win <= d.length; i += win, w++) { let s = 0; for (let j = i; j < i + win; j += 4) s += d[j] * d[j]; if (Math.sqrt(s / (win / 4)) < mean * 0.35) quiet++; }
      return { trackId: b.trackId, rms: +mean.toFixed(4), peak: +pk.toFixed(3), zcr: +(zc / (d.length / 4)).toFixed(4), quiet: +(quiet / w).toFixed(3), ctx: audio.ctx?.state ?? null };
    },
    radioPanel: () => { const p = document.getElementById('radio-panel'); return { hidden: p.hidden, rows: [...p.querySelectorAll('li')].map((li) => li.querySelector('.rp-name').textContent),
      on: [...p.querySelectorAll('li')].findIndex((li) => li.classList.contains('on')) }; },
    speedLines: () => speedLines.state(),
    // PASS 15b photo mode
    photo: () => ({ ...photo.state(), filters: PHOTO_FILTERS, audio: audio.ctx?.state ?? null, hudVisible: getComputedStyle(document.getElementById('hud')).visibility === 'visible',
      panelVisible: !document.getElementById('photo').hidden && getComputedStyle(document.getElementById('photo')).display !== 'none',
      renderCamera: { x: +camera.position.x.toFixed(3), y: +camera.position.y.toFixed(3), z: +camera.position.z.toFixed(3), fov: +camera.fov.toFixed(2) } }),
    simTime: () => simTime,
    photoSnaps: () => JSON.parse(JSON.stringify(photoSnaps)),
    outfitLook: () => ({ applied: appliedLook, palette: wornPalette }),
    feedback: () => feedback.log.slice(),
    // start a story mission at once / fail the running one through Missions.fail (the path every in-game fail uses)
    missionStart: (i) => { missions.begin(i); return missions.status(); },
    vehicleDims: (id) => { const v = vehicles.vehicles.find((o) => o.id === id); return v ? { length: v.type.length, width: v.type.width, height: v.type.height } : null; },
    // the car camera's mouse orbit, set as a mouse drag sets it (recentres after 1.3 s without input)
    carLook(orbit = 0, pitch = 0) { carCam.orbit = orbit; carCam.orbitPitch = pitch; carCam.idle = 0; return { orbit, pitch }; },
    missionFail: (reason = 'Probe: forced fail') => { missions.fail(reason); return missions.status(); },
    hurt: (n) => { life.immunity = 0; hurt(n); },
    clock: () => clockNow(),
    started: () => started,
    money: () => life.money,
    grant(amount) { life.money = Math.min(10_000_000, life.money + Math.max(0, Math.round(amount))); return life.money; },   // tool hook (PASS 10c probes)
    // everything that exists in the world, for duplicate checks across reloads
    // unique geometries and textures the scene graph holds, drawn yet or not. renderer.info only counts what has
    // reached the GPU, and the GPU upload happens the first time an object enters the view, so that count climbs
    // while the player sees new parts of the city; this one moves only when something is allocated or disposed.
    sceneCensus() {
      const geos = new Set(), texs = new Set();
      const tex = (v) => { if (v && v.isTexture) texs.add(v); };
      scene.traverse((o) => {
        if (o.geometry) geos.add(o.geometry);
        for (const m of [].concat(o.material || [])) {
          for (const v of Object.values(m)) tex(v);
          if (m.uniforms) for (const u of Object.values(m.uniforms)) tex(u?.value);
        }
      });
      return { sceneGeometries: geos.size, sceneTextures: texs.size };
    },
    entities() {
      return { sceneObjects: scene.children.length, vehicles: vehicles.vehicles.length, ownedCars: vehicles.vehicles.filter((v) => v.owned).length,
        missionCars: vehicles.vehicles.filter((v) => v.mission).length, peds: crowd.peds.length, policeUnits: police.units.length,
        missionEntities: missions.entities.length, markers: scene.children.filter((o) => o.name === 'mission-marker' || o.name === 'mission-package').length,
        geometries: info.memory.geometries, textures: info.memory.textures };
    },
    debugUnits() { return police.units.map(u => ({ id: u.car.id, x: +u.car.x.toFixed(1), z: +u.car.z.toFixed(1), yaw: +u.car.yaw.toFixed(2), v: +u.car.speed.toFixed(1),
      leg: u.driver.leg.kind + ':' + [u.driver.leg.from.x, u.driver.leg.from.z, u.driver.leg.to.x, u.driver.leg.to.z].join(','), ta: u.driver.turnabout?.phase ?? null,
      vt: +u.driver.targetV.toFixed(1), ctrl: { ...u.car.ctrl }, goal: u.goal && [+u.goal.x.toFixed(0), +u.goal.z.toFixed(0)], state: u.state, ram: !!u.driver.ramTarget, officer: u.officer && { x: +u.officer.x.toFixed(2), z: +u.officer.z.toFixed(2), y: +u.officer.y.toFixed(2) }, sees: u.sees, shift: +(u.driver.shift ?? 0).toFixed(2), shiftGoal: u.driver.shiftGoal ?? 0, blocked: u.car.blocked ?? 0, by: u.car.blockedBy, blocker: (b => !b ? null : typeof b === 'string' ? b : b.type ? 'car' + b.id + (b === vehicles.hero ? '(hero)' : '') + (b.policeUnit ? '(police)' : '') : 'ped' + b.id)(u.driver.blocker) })); },
    // Line of sight from a cruiser's eye at (ax, az) to a standing player at (bx, bz).
    sightline(ax, az, bx, bz) {
      const from = new THREE.Vector3(ax, world.groundHeight(ax, az) + 1.18, az);
      const ray = new THREE.Vector3(bx, world.groundHeight(bx, bz) + 0.95, bz).sub(from);
      const length = ray.length();
      return length <= 54 && world.colliders.raycast(from, ray.normalize(), length) >= length - 0.025;
    },
    debugCar(id) {
      const v = vehicles.vehicles.find(o => o.id === id); if (!v) return null; const d = v.driver && v.driver !== 'player' ? v.driver : null;
      const b = d?.blocker;
      return { id, x: +v.x.toFixed(1), z: +v.z.toFixed(1), yaw: +v.yaw.toFixed(2), v: +v.speed.toFixed(1), vt: d ? +d.targetV.toFixed(1) : null,
        leg: d ? d.leg.kind + ':' + [d.leg.from.x, d.leg.from.z, d.leg.to.x, d.leg.to.z].join(',') : null, stuck: d?.stuck, reverse: d?.reverse,
        blocker: !b ? null : typeof b === 'string' ? b : b.type ? 'car' + b.id : 'ped' + b.id + '@' + b.x.toFixed(1) + ',' + b.z.toFixed(1),
        slip: +Math.max(v.slip || 0, v.slipF || 0).toFixed(2) };
    },
    exposed(x, z) { return police.exposed(x, world.groundHeight(x, z), z); },
    vehicleIdOfPlayer() { return driving.vehicle?.id ?? null; },
    // Responding cruisers whose own model light bar is lit this frame (tool hook).
    sirenLamps() { return police.units.filter(u => u.siren && u.car.lamps.siren > 0).length; },
    // `at` (PASS 14b): report the crime somewhere else, so the response starts away from the player
    forceWanted(level, at) { wanted.force(level, at ?? driving.vehicle ?? player.pos); },
    aimClear(x, y, z) {
      const from = new THREE.Vector3(player.pos.x, player.pos.y + 1.42, player.pos.z);
      const ray = new THREE.Vector3(x, y, z).sub(from);
      const length = ray.length();
      return length < 75 && world.colliders.raycast(from, ray.normalize(), length) >= length - 0.01;
    },
    probeStep({ steps = 1, move, shot, shotFrom, reload = false, drawFrame = false } = {}) {
      loop.stop();
      if (move !== undefined) { probeWish = move; player.autoWish = move; }
      if (shot && driving.state === 'foot' && !life.incident) {
        const from = new THREE.Vector3(player.pos.x, player.pos.y + 1.42, player.pos.z);
        combat.fire(from, new THREE.Vector3(shot.x, shot.y, shot.z).sub(from).normalize());
      }
      // shotFrom: fire exactly as the mouse does, from a camera position along its view direction
      if (shotFrom && driving.state === 'foot' && !life.incident) {
        combat.fire(new THREE.Vector3(shotFrom.from.x, shotFrom.from.y, shotFrom.from.z), new THREE.Vector3(shotFrom.dir.x, shotFrom.dir.y, shotFrom.dir.z));
      }
      if (reload) combat.startReload();
      for (let i = 0; i < steps; i++) update(STEP);
      if (drawFrame) render(1, STEP);
      return this.status();
    },
    advance(seconds = 5) {
      loop.stop();
      for (let i = 0; i < Math.round(seconds / STEP); i++) update(STEP);
      frameCamera(1, STEP, NO_LOOK); draw(1);
      return this.population();
    },
    // Camera framing diagnostic: project the focus (car while driving, else player
    // and nearest car) to NDC. x/y in [-1,1] and z<1 means it is on screen.
    diag() {
      const proj = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(camera); return { x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) }; };
      const cp = camera.position;
      const out = { cam: { x: +cp.x.toFixed(2), y: +cp.y.toFixed(2), z: +cp.z.toFixed(2), fov: +camera.fov.toFixed(1) }, driving: driving.driving };
      const v = driving.driving ? driving.vehicle : null;
      if (v) out.car = { type: v.type.name, dist: +Math.hypot(v.x - cp.x, v.z - cp.z).toFixed(2), ndc: proj(v.x, v.gY + v.type.height * 0.5, v.z) };
      else {
        out.player = { ndc: proj(player.pos.x, player.pos.y + 1, player.pos.z) };
        const near = vehicles.nearestEnterable(player.pos, 40);
        if (near) out.nearCar = { type: near.type.name, dist: +Math.hypot(near.x - player.pos.x, near.z - player.pos.z).toFixed(2), ndc: proj(near.x, near.gY + near.type.height * 0.5, near.z) };
      }
      out.cars = vehicles.vehicles
        .map((v) => ({ type: v.type.name, dist: +Math.hypot(v.x - cp.x, v.z - cp.z).toFixed(1), ndc: proj(v.x, v.gY + v.type.height * 0.5, v.z) }))
        .filter((c) => c.dist < 45 && c.ndc.z < 1).sort((a, b) => a.dist - b.dist);
      return out;
    },
    // mode 'drive' (default): the player drives the hero car round the grid; 'foot': the PASS 1 walking loop.
    autopilot(on = true) {
      if (!on) { auto = null; player.autoWish = null; return; }
      if (on === 'foot') { driving.reset(); auto = autopilotRoute(); return; }
      auto = null;
      const v = vehicles.hero;
      driving.enterNow(v, chauffeur(v, [40, 120], [40, 200], { cruise: 17, ignoreSignals: true }));
    },
    // Stage a deterministic shot from the seeded start: on foot (PASS 1 poses) or
    // in a car (s.car), run the real simulation for s.run seconds, then frame it.
    async stage(name) {
      const s = typeof name === 'string' ? SHOTS[name] : name;
      loop.stop();
      document.body.classList.add('ui-still');     // HUD animations off and key hints pinned (deterministic captures)
      hud._mode = ''; hud._armedUntil = 0; hud._shots = undefined;
      resetWorld();
      Time.reset();
      Weather.init(seed);        // each staged shot starts from the same clear, dry weather, whatever ran before it
      chase.locked = false;
      player.object.visible = player.blob.visible = true;
      if (camera.fov !== 60 && !s.cam?.fov) { camera.fov = 60; camera.updateProjectionMatrix(); }
      simTime = s.time || 30;
      for (const e of s.extra || []) vehicles.spawn(e.type, e.x, e.z, e.yaw, e.drive ? chauffeur : null, e);
      if (s.car) {
        const v = s.car.use === 'hero' ? vehicles.hero : vehicles.spawn(s.car.type, s.car.x, s.car.z, s.car.yaw);
        v.place(s.car.x, s.car.z, s.car.yaw);
        v.paint.set(s.car.paint || '#c8102e');
        const speed = s.car.speed || 0;
        v.vx = Math.sin(s.car.yaw) * speed; v.vz = Math.cos(s.car.yaw) * speed;
        v.fwd = speed; v.speed = speed;
        v.gear = Math.max(1, Math.min(v.type.gears.length, Math.round(speed / 9)));
        // The staged chauffeur drives like traffic (signals, left-turn yield) unless the scene opts out:
        // probe_police's chase depends on it waiting to turn at the harbour front.
        driving.enterNow(v, s.car.route ? chauffeur(v, s.car.route[0], s.car.route[1], { cruise: s.car.cruise || 14, ignoreSignals: !!s.car.ignoreSignals }) : null);
        driving.scripted = !!s.car.input;
        const steps = Math.round((s.run || 0) / STEP);
        for (let i = 0; i < steps; i++) {
          if (s.car.input) {
            const late = i * STEP >= (s.car.inputAfter || 0);
            Object.assign(v.ctrl, late ? s.car.input : s.car.before || {});
            if (s.car.input.horn) v.horn = true;
          }
          update(STEP);
          if (i % 3 === 0 || i === steps - 1) frameCamera(1, STEP * (i % 3 === 0 ? 3 : 1), NO_LOOK);
        }
        carCam.orbit = s.camOrbit || 0; carCam.orbitPitch = s.camPitch || 0; carCam.idle = 0;
        if (s.camDist) carCam.baseDist = () => s.camDist;
        for (let i = 0; i < 40; i++) frameCamera(1, STEP, NO_LOOK);
        carCam.baseDist = VehicleCamera.prototype.baseDist;
      } else {
        player.spawn(s.x, s.z, s.yaw);
        crowd.reset(player.pos);
        vehicles.populate(player.pos, player.yaw, 1, true);
        chase.snap(player.pos, player.yaw);
        if (s.wish) player.autoWish = s.wish;
        for (let i = 0; i < Math.round((s.run || 0) / STEP); i++) update(STEP);
        chase.locked = true;
        chase.yaw = player.yaw + Math.PI + (s.camYaw || 0);
        chase.pitch = s.pitch ?? 0.2;
        chase.zoom = s.dist ?? 4.4;
        chase.noCollide = !!s.free;
        chase.dist = chase.zoom;
        chase.pivot.set(player.pos.x, player.pos.y + 1.55, player.pos.z);
        driving.candidate = vehicles.nearestEnterable(player.pos, 1.9);
        for (let i = 0; i < 30; i++) frameCamera(1, STEP, NO_LOOK);
      }
      hud.vehicle(driving);
      if (s.observe) {
        const p = [...crowd.peds].sort((a, b) => Math.hypot(a.x - player.pos.x, a.z - player.pos.z) - Math.hypot(b.x - player.pos.x, b.z - player.pos.z))[0];
        const dx = Math.sin(p.yaw), dz = Math.cos(p.yaw);
        camera.position.set(p.x - dx * 4.8 + dz * 1.5, p.y + 1.65, p.z - dz * 4.8 - dx * 1.5);
        camera.lookAt(p.x + dx * 1.2, p.y + 1.0, p.z + dz * 1.2);
        camera.updateMatrixWorld();
        _target.set(p.x, p.y, p.z);
      }
      if (s.cam) {
        // explicit camera pose for visual probes: [x, y, z] looking at [x, y, z]
        camera.position.set(...s.cam.from);
        camera.lookAt(...s.cam.to);
        if (s.cam.fov) { camera.fov = s.cam.fov; camera.updateProjectionMatrix(); }
        camera.updateMatrixWorld();
        _target.set(...s.cam.to);
        if (s.hidePlayer) player.object.visible = player.blob.visible = false;
      }
      hud._last = 0;
      hud.minimap(0, mapFocus(), camera, police, wanted, true, missions.marks());   // fixed time: pin pulse and siren flash are deterministic
      hud.playerStatus(wanted, police, life, combat, driving.state === 'foot');
      hud.mission(Side.hud() ?? missions.hud());
      if (driving.driving) hud.radio(radio.nowPlaying());
      hud.update(performance.now(), clockNow(), driving.driving ? driving.vehicle : player, { fps: 60, ...gfx.frame, cars: carRender.drawn });
      draw(1);
      const stagedFrame = { ...gfx.frame };
      // a frame boundary, or 100 ms if headless Chrome stops delivering rAF (seen intermittently on this host)
      await Promise.race([nextFrame(), new Promise((r) => setTimeout(r, 100))]);
      draw(1);
      return { ...this.player(), calls: Math.max(stagedFrame.calls, gfx.frame.calls), triangles: Math.max(stagedFrame.triangles, gfx.frame.triangles), carsDrawn: carRender.drawn };
    },
    // Camera wall test: orbit the chase camera 360 degrees around a spot and report
    // the closest the camera got to the inside of any collider box.
    probeCamera(x, z, yaw) {
      loop.stop();
      driving.reset();
      player.spawn(x, z, yaw);
      chase.snap(player.pos, yaw);
      let inside = 0, minDist = Infinity;
      const c = chase.camera.position;
      for (let i = 0; i < 72; i++) {
        for (let k = 0; k < 8; k++) chase.update(STEP, player.pos, player, { x: 2 * Math.PI / 72 / 0.0024 / 8, y: 0, wheel: 0 });
        for (const b of world.colliders.query(c.x - 1, c.z - 1, c.x + 1, c.z + 1)) {
          if (c.x > b.x0 && c.x < b.x1 && c.y > b.y0 && c.y < b.y1 && c.z > b.z0 && c.z < b.z1) inside++;
        }
        minDist = Math.min(minDist, chase.dist);
      }
      loop.start();
      return { samples: 72, insideCollider: inside, minCameraDistance: +minDist.toFixed(2) };
    },
    // Drive test: hand the hero car scripted controls for a while (real fixed steps) and report.
    // Optional spawn {x,z,yaw} places it on a clear stretch of road first (for clean physics runs).
    driveTest(controls, seconds = 3, spawn = null) {
      loop.stop();
      resetWorld();
      const v = vehicles.hero;
      driving.enterNow(v);
      driving.scripted = true;
      if (spawn) {
        v.place(spawn.x, spawn.z, spawn.yaw);
        v.settle(vehicles.ground.height, 1);
        vehicles.vehicles = vehicles.vehicles.filter((o) => o === v || Math.hypot(o.x - spawn.x, o.z - spawn.z) > 14);
      }
      const log = [];
      for (let i = 0; i < Math.round(seconds / STEP); i++) {
        const c = typeof controls === 'function' ? controls(i * STEP, v) : controls;
        Object.assign(v.ctrl, c);
        update(STEP);
        if (i % 30 === 29) log.push({ t: +((i + 1) * STEP).toFixed(2), x: +v.x.toFixed(2), z: +v.z.toFixed(2), yaw: +v.yaw.toFixed(3), kmh: +(v.fwd * 3.6).toFixed(1), gear: v.gear, rpm: Math.round(v.rpm), slip: +v.slip.toFixed(2), pitch: +v.pitch.toFixed(3), roll: +v.roll.toFixed(3) });
      }
      driving.scripted = false;
      loop.start();
      return log;
    },
    // Exit test: where would the player step out of the hero car right now.
    exitTest() { return driving.vehicle ? vehicles.exitPoint(driving.vehicle) : null; },
    resume() { document.body.classList.remove('ui-still'); chase.noCollide = false; chase.locked = false; player.autoWish = null; probeWish = null; driving.scripted = false; loop.start(); },
    // Frame cost independent of display cadence: run sim+render back to back with a
    // GPU sync (1-pixel readback) after each frame, for the given wall-clock time.
    bench(seconds = 3) {
      const gl = gfx.renderer.getContext();
      const px = new Uint8Array(4);
      loop.stop();
      let n = 0;
      let updateMs = 0, renderMs = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < seconds * 1000) {
        const u0 = performance.now();
        update(STEP);
        updateMs += performance.now() - u0;
        const r0 = performance.now();
        render(0, STEP);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        renderMs += performance.now() - r0;
        n++;
      }
      const ms = (performance.now() - t0) / n;
      loop.start();
      return { frames: n, frameMs: ms, fpsCapacity: 1000 / ms, updateMs: updateMs / n, renderMs: renderMs / n };
    },
  };
}

boot().catch((err) => {
  console.error(err);
  const s = document.getElementById('load-step');
  if (s) s.textContent = `Failed to start: ${err.message}`;
});
