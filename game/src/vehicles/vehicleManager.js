// Owns every vehicle in the city: spawns the parked cars and the traffic from a
// seeded stream, runs AI and dynamics each fixed step, moves the cars in swept
// substeps (no tunnelling) against the static world and each other, then
// settles them on the ground and the kerbs. Also answers "which car can the
// player get into" and "where can the player get out".
import * as THREE from '../../vendor/three.min.js';
import { Vehicle } from './vehicle.js';
import { VEHICLE_TYPES } from './vehicleTypes.js';
import { makeGround, resolveStatic, resolveKerbs, resolvePair, pushOutOfVehicle, cruiserObstruction } from './vehicleCollisions.js';
import { TrafficDriver, allStreets, parkingSpot, laneSpot } from './traffic.js';
import { pickType } from './catalogue.js';

// PASS 10a2: parked and traffic types come from the catalogue's district weights
// (catalogue.js pickType): hypercars park downtown and on the waterfront, muscle and
// drift cars in the industrial yards and the old market, saloons in the core, and
// everyday sedans, SUVs, vans and trucks fill the rest. A parked car that is
// re-seated near the player is re-rolled for its new district.
const hash01 = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export class VehicleManager {
  constructor(world, rng, { traffic = 24, parked = 14 } = {}) {
    this.world = world;
    this.colliders = world.colliders;
    this.ground = makeGround(world.layout);
    this.rng = rng;
    this.opts = { traffic, parked };
    this.cap = traffic + parked + 5;
    this.populationClock = 0;
    this.lanes = allStreets();
    this.vehicles = [];
    this.hits = [];               // impact events this step: { v, j }
    this.pairHit = (a, b, speed, nx, nz) => this.onPair?.(a, b, speed, nx, nz);
    this.onHit = (v, j) => { v.impact = Math.max(v.impact, j); if (j > 1) this.hits.push({ v, j }); };
    this.reset();
  }

  // Deterministic (re)spawn of the whole fleet.
  reset() {
    this.populationClock = 0;
    this.refills = 0;
    const rng = this.rng.fork('fleet');
    this.vehicles.length = 0;
    let id = 0;
    const paint = (type, r) => new THREE.Color(type.paints[r.int(0, type.paints.length - 1)]);
    const add = (typeName, spot, driverFn) => {
      const t = VEHICLE_TYPES[typeName];
      for (const o of this.vehicles) {
        if (Math.hypot(o.x - spot.x, o.z - spot.z) < (o.type.length + t.length) / 2 + 1.2) return null;
      }
      const v = new Vehicle(id++, typeName, paint(t, rng));
      if (driverFn) v.driver = driverFn(v);
      v.place(spot.x, spot.z, spot.yaw);
      v.settle(this.ground.height, 1);
      this.vehicles.push(v);
      return v;
    };
    // the hero car beside the spawn point, and a showroom row on the avenue
    this.hero = add('sports', { x: 35.15, z: 156, yaw: 0 });
    this.hero.paint = new THREE.Color('#c8102e');
    add('police', { x: 35.15, z: 146.5, yaw: 0 });
    add('sedan', { x: 35.15, z: 165.5, yaw: 0 });
    add('pickup', { x: 44.85, z: 160, yaw: Math.PI });
    add('suv', { x: 44.85, z: 151, yaw: Math.PI });
    const streets = allStreets();
    let tries = 0;
    for (let n = 0; n < this.opts.parked && tries < 400; tries++) {
      const [A, B] = streets[rng.int(0, streets.length - 1)];
      const spot = parkingSpot(A, B, rng.float(0, 1));
      if (add(pickType('parked', spot.x, spot.z, rng.float(0, 1)), spot)) n++;
    }
    tries = 0;
    const tr = rng.fork('traffic');
    for (let n = 0; n < this.opts.traffic && tries < 400; tries++) {
      const [A, B] = streets[rng.int(0, streets.length - 1)];
      const spot = laneSpot(A, B, rng.float(0.05, 0.75));
      const typeName = pickType('traffic', spot.x, spot.z, tr.float(0, 1));
      const v = add(typeName, spot, (veh) => new TrafficDriver(veh, tr.fork(`d${n}`), A, B, { cruise: tr.float(7, 13) }));
      if (v) { v.sleeping = false; n++; }
    }
  }

  // Fixed object pool. Re-seat distant traffic on clear local lane samples,
  // favouring the direction of travel. No meshes or physics bodies are allocated.
  populate(pos, yaw, dt, force = false) {
    this.populationClock += dt;
    if (!force && this.populationClock < 0.5) return;
    this.populationClock = 0;
    const near = this.vehicles.filter((v) => v.driver && v.driver !== 'player' && Math.hypot(v.x - pos.x, v.z - pos.z) < 112 && v.speed > 0.7).length;
    let needed = Math.max(0, 12 - near);
    const slots = [];
    for (const [A, B] of this.lanes) for (const u of [0.12, 0.38, 0.64, 0.88]) {
      const p = laneSpot(A, B, u), d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d < 16 || d > 108) continue;
      slots.push({ ...p, A, B, u, score: d - ((p.x - pos.x) * Math.sin(yaw) + (p.z - pos.z) * Math.cos(yaw)) * 0.22 });
    }
    slots.sort((a, b) => a.score - b.score);
    for (let vi = 0; vi < this.vehicles.length; vi++) {
      let v = this.vehicles[vi];
      if (v === this.hero || v.driver === 'player' || v.policeUnit || v === this.playerVehicle || v.mission) continue;
      const d = Math.hypot(v.x - pos.x, v.z - pos.z);
      const traffic = v.driver && v.driver !== 'player';
      if (!force && d < 118 && !(traffic && needed > 0 && v.speed < 0.5 && v.driver.stuckLocal > 8)) continue;
      if (!traffic && d < 150) continue;
      const candidates = traffic ? slots : slots.map((p) => ({ ...p, ...parkingSpot(p.A, p.B, p.u) }));
      // a parked car is re-rolled for the district of its new kerb
      const typeAt = (p) => (traffic || v.owned ? v.type : VEHICLE_TYPES[pickType('parked', p.x, p.z, hash01(v.id * 7.3 + p.x * 0.11 + p.z * 0.37))]);
      const slot = candidates.find((p) => { const vt = typeAt(p); return this.vehicles.every((o) => o === v || vt.circles.every((a) => o.type.circles.every((b) =>
        Math.hypot(p.x + Math.sin(p.yaw) * a - o.x - Math.sin(o.yaw) * b,
          p.z + Math.cos(p.yaw) * a - o.z - Math.cos(o.yaw) * b) > vt.radius + o.type.radius + 0.8)))
        && (!this.pedestrians || this.pedestrians.every((p2) => Math.hypot(p2.x - p.x, p2.z - p.z) > 4)); });
      if (!slot) continue;
      if (!traffic) {
        const vt = typeAt(slot);
        if (vt !== v.type) {
          const nv = new Vehicle(v.id, vt.name, new THREE.Color(vt.paints[Math.floor(hash01(v.id + slot.x) * vt.paints.length)]));
          this.vehicles[vi] = v = nv;
        }
      }
      v.place(slot.x, slot.z, slot.yaw);
      if (traffic) {
        const cruise = v.driver.cruise;
        v.driver = new TrafficDriver(v, this.rng.fork(`local-${v.id}-${slot.x}-${slot.z}`), slot.A, slot.B, { cruise });
        v.vx = Math.sin(v.yaw) * cruise; v.vz = Math.cos(v.yaw) * cruise;
        v.fwd = v.speed = cruise; v.wake(); needed--;
      }
      v.settle(this.ground.height, 1);
      if (!force && needed <= 0) break;
    }
  }

  // Top the fleet back up to the cap with traffic cars on clear lane slots 60-108 m from pos
  // (mission props and police dispatch evict traffic to stay under the cap; this puts it back).
  refill(pos) {
    let added = 0;
    const slots = [];
    for (const [A, B] of this.lanes) for (const u of [0.2, 0.5, 0.8]) {
      const p = laneSpot(A, B, u), d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d >= 60 && d <= 108) slots.push({ ...p, A, B, d });
    }
    slots.sort((a, b) => b.d - a.d);
    for (const slot of slots) {
      if (this.vehicles.length >= this.cap) break;
      this.refills = (this.refills || 0) + 1;
      const typeName = pickType('traffic', slot.x, slot.z, hash01(this.refills * 13.7 + slot.x)), t = VEHICLE_TYPES[typeName];
      if (!this.vehicles.every((o) => Math.hypot(o.x - slot.x, o.z - slot.z) > (o.type.length + t.length) / 2 + 3)) continue;
      const id = this.vehicles.reduce((m, o) => Math.max(m, o.id), 0) + 1;
      const v = new Vehicle(id, typeName, new THREE.Color(t.paints[id % t.paints.length]));
      v.place(slot.x, slot.z, slot.yaw);
      v.driver = new TrafficDriver(v, this.rng.fork(`refill-${id}-${slot.x}-${slot.z}`), slot.A, slot.B, { cruise: 9 + (id % 4) });
      v.settle(this.ground.height, 1);
      v.wake();
      this.vehicles.push(v);
      added++;
    }
    return added;
  }

  dispatch(slot, player) {
    const type = VEHICLE_TYPES.police;
    const clear = this.vehicles.every(v => Math.hypot(v.x - slot.x, v.z - slot.z) > (v.type.length + type.length) / 2 + 1);
    if (!clear || this.pedestrians?.some(p => Math.hypot(p.x - slot.x, p.z - slot.z) < 3)) return null;
    const id = this.vehicles.reduce((max, v) => Math.max(max, v.id), 0) + 1;
    const car = new Vehicle(id, 'police', new THREE.Color(type.paints[0]));
    car.place(slot.x, slot.z, slot.yaw);
    const { wall, kerb } = cruiserObstruction(car, this.colliders, this.ground);
    if (wall || kerb) return null;
    if (this.vehicles.length >= this.cap) {
      let far = -1, distance = -1;
      this.vehicles.forEach((v, i) => {
        if (v === this.hero || v === this.playerVehicle || v.policeUnit || v.mission || !v.driver || v.driver === 'player') return;
        const d = Math.hypot(v.x - player.x, v.z - player.z);
        if (d > distance) { distance = d; far = i; }
      });
      if (far === -1) return null;
      this.vehicles.splice(far, 1);
    }
    car.settle(this.ground.height, 1);
    this.vehicles.push(car);
    return car;
  }

  // Place one extra vehicle (tools / staged scenes), clearing the spot first.
  spawn(typeName, x, z, yaw, chauffeur = null, opts = {}) {
    const t = VEHICLE_TYPES[typeName];
    // never clear away the hero, the player's car, police units or other mission cars
    const keep = (o) => o === this.hero || o === this.playerVehicle || o.driver === 'player' || o.policeUnit || o.mission;
    this.vehicles = this.vehicles.filter((o) => keep(o) || Math.hypot(o.x - x, o.z - z) > (o.type.length + t.length) / 2 + 0.6);
    const id = this.vehicles.reduce((m, o) => Math.max(m, o.id), 0) + 1;
    const v = new Vehicle(id, typeName, new THREE.Color(opts.paint || t.paints[id % t.paints.length]));
    if (chauffeur && opts.route) v.driver = chauffeur(v, opts.route[0], opts.route[1], { cruise: opts.cruise || 11 });
    v.place(x, z, yaw);
    v.settle(this.ground.height, 1);
    if (v.driver) v.wake();
    this.vehicles.push(v);
    if (this.vehicles.length > this.cap) {
      // over the cap: drop the farthest free car (staged line-ups stay whole)
      let remove = -1, far = -1;
      this.vehicles.forEach((o, i) => { const d = Math.hypot(o.x - x, o.z - z); if (o !== v && !keep(o) && d > far) { far = d; remove = i; } });
      if (remove >= 0) this.vehicles.splice(remove, 1);
    }
    return v;
  }

  // One fixed step. playerVehicle's ctrl is set by the caller beforehand.
  step(dt, t, pedestrian) {
    const V = this.vehicles;
    this.hits.length = 0;
    for (const v of V) {
      v.managerPeds = this.pedestrians;
      v.savePrev();
      v.impact = 0; v.bump = 0;
      if (v.driver && v.driver !== 'player') v.driver.update(dt, t, V, pedestrian);
      if (v.driver && v.driver !== 'player') v.driver.stuckLocal = v.speed < 0.5 ? (v.driver.stuckLocal || 0) + dt : 0;
      if (v.driver) v.wake();
      // A driverless car rolls to a gentle stop; one a mission has stopped (the clerk's sedan in
      // NO WITNESSES, missions.js) is braked hard and held on the handbrake where it stopped.
      // Brake only while rolling forward: at rest vehicle.js reads the brake as reverse.
      if (!v.driver && v.mission?.stopped) { v.ctrl.throttle = 0; v.ctrl.brake = v.fwd > 0.6 ? 1 : 0; v.ctrl.steer = 0; v.ctrl.handbrake = true; }
      else if (!v.driver) { v.ctrl.throttle = 0; v.ctrl.brake = v.speed > 0.1 ? 0.25 : 0; v.ctrl.steer = 0; v.ctrl.handbrake = v.speed < 0.5; }
      if (!v.sleeping) v.dynamics(dt);
    }
    // swept substeps: never move more than ~0.3 m between contact checks
    let vmax = 0;
    for (const v of V) if (!v.sleeping) vmax = Math.max(vmax, v.speed + Math.abs(v.r) * v.type.length * 0.5);
    const n = Math.min(10, Math.max(1, Math.ceil((vmax * dt) / 0.3)));
    const h = dt / n;
    for (let k = 0; k < n; k++) {
      for (const v of V) {
        if (v.sleeping) continue;
        if (v.policeUnit) { v.safeX = v.x; v.safeZ = v.z; v.safeYaw = v.yaw; }
        v.x += v.vx * h; v.z += v.vz * h; v.yaw += v.r * h;
        resolveStatic(v, this.colliders, this.onHit);
      }
      for (let i = 0; i < V.length; i++) {
        const A = V[i];
        for (let j = i + 1; j < V.length; j++) {
          const B = V[j];
          if (A.sleeping && B.sleeping) continue;
          resolvePair(A, B, this.onHit, this.pairHit);
        }
      }
      for (const v of V) if (v.policeUnit && !v.sleeping) {
        const { wall, kerb } = cruiserObstruction(v, this.colliders, this.ground);
        if (!wall && !kerb) continue;
        v.blocked = (v.blocked ?? 0) + 1; v.blockedBy = wall ? 'wall' : 'kerb';
        v.x = v.safeX; v.z = v.safeZ; v.yaw = v.safeYaw;
        v.vx = v.vz = v.r = 0;
      }
    }
    for (const v of V) {
      if (v.sleeping) continue;
      if (!v.policeUnit) resolveKerbs(v, this.ground, v.px, v.pz, v.pyaw);
      v.settle(this.ground.height, dt);
      if (v.yaw > Math.PI) { v.yaw -= 2 * Math.PI; v.pyaw -= 2 * Math.PI; }
      else if (v.yaw < -Math.PI) { v.yaw += 2 * Math.PI; v.pyaw += 2 * Math.PI; }
    }
  }

  // The nearest car whose driver door (or body) is within reach of a walker.
  nearestEnterable(p, reach = 2.4) {
    let best = null, bd = reach;
    for (const v of this.vehicles) {
      const t = v.type;
      const dx = p.x - v.x, dz = p.z - v.z;
      if (dx * dx + dz * dz > (t.length / 2 + reach + 1) ** 2) continue;
      const s = Math.sin(v.yaw), co = Math.cos(v.yaw);
      const lx = dx * co - dz * s, lz = dx * s + dz * co;
      // distance to the car's outline (rounded box)
      const ox = Math.max(0, Math.abs(lx) - t.width / 2), oz = Math.max(0, Math.abs(lz) - t.length / 2);
      const d = Math.hypot(ox, oz);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  // World position of the door on a side (+1 driver/left, -1 passenger/right), `out` metres off the body.
  doorPoint(v, side, out = 0.55) {
    const t = v.type, s = Math.sin(v.yaw), co = Math.cos(v.yaw);
    const lx = side * (t.width / 2 + out), lz = t.doorZ;
    return { x: v.x + co * lx + s * lz, z: v.z - s * lx + co * lz };
  }

  // Where a player can step out: beside a door, clear of buildings, props and cars,
  // reachable from the seat without crossing geometry. Prefers the pavement side,
  // then the driver's side. Returns {x, z, side} or null when boxed in.
  exitPoint(v, playerR = 0.34) {
    const cands = [];
    const t = v.type;
    for (const side of [1, -1]) {
      for (const dz of [0, -0.9, 0.9]) {
        const p = this.doorPoint(v, side, playerR + 0.25);
        const s = Math.sin(v.yaw), co = Math.cos(v.yaw);
        p.x += s * dz; p.z += co * dz;
        p.side = side; p.order = Math.abs(dz);
        cands.push(p);
      }
    }
    // front and back as last resorts
    for (const end of [1, -1]) {
      const s = Math.sin(v.yaw), co = Math.cos(v.yaw);
      const d = end * (t.length / 2 + playerR + 0.3);
      cands.push({ x: v.x + s * d, z: v.z + co * d, side: 0, order: 3 });
    }
    const score = (p) => (this.world.groundHeight(p.x, p.z) > 0.05 ? 4 : 0) + (p.side === 1 ? 2 : p.side === -1 ? 1 : 0) - p.order;
    cands.sort((a, b) => score(b) - score(a));
    const dir = new THREE.Vector3();
    const from = new THREE.Vector3();
    for (const p of cands) {
      if (!this.world.layout.walkable(p.x, p.z)) continue;
      const q = { x: p.x, z: p.z };
      if (this.colliders.resolveCircle(q, playerR, 0.3, 1.7)) continue;
      let blocked = false;
      for (const o of this.vehicles) if (pushOutOfVehicle({ x: p.x, z: p.z }, playerR, o)) { blocked = true; break; }
      if (blocked) continue;
      // line of sight from the seat to the spot at chest height (no stepping through a pole or a wall)
      from.set(v.x, 1.0, v.z);
      dir.set(p.x - v.x, 0, p.z - v.z);
      const len = dir.length();
      dir.normalize();
      if (this.colliders.raycast(from, dir, len) < len - 0.01) continue;
      return p;
    }
    return null;
  }

  // Keep a walking character out of every car.
  pushWalker(p, r, onContact) {
    let hit = false;
    for (const v of this.vehicles) if (pushOutOfVehicle(p, r, v)) { hit = true; onContact?.(v); }
    return hit;
  }
}
