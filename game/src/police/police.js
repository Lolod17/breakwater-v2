import { CITY } from '../config.js';
import { TrafficDriver, laneSpot } from '../vehicles/traffic.js';
import { cruiserObstruction } from '../vehicles/vehicleCollisions.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const streets = CITY.streets;
const active = (state) => state === 'pursue' || state === 'intercept';

function visible(world, x, y, z, target, range) {
  const dx = target.x - x, dy = target.y - y, dz = target.z - z;
  const length = Math.hypot(dx, dy, dz);
  if (length > range) return false;
  if (length < 0.01) return true;
  return world.colliders.raycast({ x, y, z }, { x: dx / length, y: dy / length, z: dz / length }, length) >= length - 0.025;
}

// Cost for reaching a road point from a graph node. Score both ends of the
// target's street so a unit on the correct lane does not circle a whole block.
function roadTarget(point, lanes) {
  let best, separation = Infinity;
  for (const [a, b] of lanes) {
    const x = a.x === b.x ? a.x : Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), point.x));
    const z = a.z === b.z ? a.z : Math.max(Math.min(a.z, b.z), Math.min(Math.max(a.z, b.z), point.z));
    const d = Math.hypot(x - point.x, z - point.z);
    if (d < separation) { best = { x, z, a, b }; separation = d; }
  }
  return best;
}

export class Police {
  constructor(world, fleet, wanted, rng, air) {
    Object.assign(this, { world, fleet, wanted, rng, air });
    this.slots = fleet.lanes.flatMap(([a, b]) => [0.18, 0.42, 0.66, 0.86].map(u => ({ ...laneSpot(a, b, u), a, b })));
    this.reset();
  }

  reset() {
    for (const u of this.units ?? []) { u.car.policeUnit = null; u.car.sirenOn = 0; }
    this.units = [];
    this.lastSeen = null;
    this.seen = false;
    this.dispatchDelay = 0;
    this.lost = 0;
    this.air.reset();
  }

  setState(unit, state) {
    if (unit.state === state) return;
    unit.state = state;
    unit.age = 0;
    unit.visited.add(state);
  }

  // Spawn a unit on a lane slot out of the immediate area. A static incident
  // gets cars already heading towards it; a moving target gets cars behind it
  // travelling the same way, so the first unit does not meet it head-on and
  // have to turn round.
  dispatch(origin, velocity) {
    const slots = this.slots.filter(p => distance(p, origin) > 19 && distance(p, origin) < 86);
    const speed = velocity ? Math.hypot(velocity.x, velocity.z) : 0;
    const ux = speed > 3 ? velocity.x / speed : 0, uz = speed > 3 ? velocity.z / speed : 0;
    const score = p => {
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw), dx = p.x - origin.x, dz = p.z - origin.z;
      const heading = speed > 3
        ? (dx * ux + dz * uz) * 0.5 - (fx * ux + fz * uz) * 14   // behind the target, same direction
        : (fz * dz + fx * dx) * 0.37;                            // facing the incident
      return Math.abs(distance(p, origin) - (this.units.length ? 38 : 26)) + heading
        + this.units.reduce((sum, u) => sum + Math.max(0, 24 - distance(p, u.car)), 0);
    };
    slots.sort((a, b) => score(a) - score(b));
    for (const p of slots) {
      const car = this.fleet.dispatch(p, origin);
      if (!car) continue;
      const driver = new TrafficDriver(car, this.rng.fork(`unit-${this.units.length}`), p.a, p.b, { cruise: 10 });
      const unit = { car, driver, state: 'patrol', age: 0, unseen: 0, hp: 100, hit: 0, visited: new Set(['patrol']), officer: null, turnCooldown: 0, turnabouts: 0 };
      car.driver = driver;
      car.policeUnit = unit;
      driver.chooseTurn = (options, leg) => this.turn(unit, options, leg);
      driver.approach = (v, sin, cos) => this.approach(unit, v, sin, cos);
      driver.wantTurnabout = (leg) => this.wantTurnabout(unit, leg);
      driver.canOvertake = true;
      this.units.push(unit);
      return;
    }
  }

  turn(unit, options, leg) {
    const point = unit.goal;
    if (!point) return null;
    const route = roadTarget(point, this.fleet.lanes);
    const length = (x, z, to) => Math.abs(x - to.x) + Math.abs(z - to.z);
    const score = ([i, j]) => {
      const x = streets[i], z = streets[j];
      if (Math.abs(route.x - x) + Math.abs(route.x - leg.to.x) <= Math.abs(x - leg.to.x) && z === leg.to.z && route.z === z) return -1;
      if (Math.abs(route.z - z) + Math.abs(route.z - leg.to.z) <= Math.abs(z - leg.to.z) && x === leg.to.x && route.x === x) return -1;
      return Math.min(...[route.a, route.b].map(end => length(x, z, end) + length(end.x, end.z, route)));
    };
    return options.reduce((best, option) => score(option) < score(best) ? option : best);
  }

  // Turn back along the current street when that is clearly shorter than
  // carrying on to the next junction (no U-turns at junctions otherwise).
  wantTurnabout(unit, leg) {
    const goal = unit.goal, car = unit.car;
    if (!goal || unit.officer || unit.hp <= 0 || unit.turnCooldown > 0) return false;
    const f = p => p.x * leg.dx + p.z * leg.dz;
    const side = leg.dx ? Math.abs(goal.z - leg.from.z) : Math.abs(goal.x - leg.from.x);
    const carF = f(car), goalF = f(goal), aF = f(leg.from), bF = f(leg.to);
    const manhattan = (n) => Math.abs(n.x - goal.x) + Math.abs(n.z - goal.z);
    const onStreet = side < 9 && goalF > Math.min(aF, bF) - 6 && goalF < Math.max(aF, bF) + 6;
    const ahead = goalF - carF;
    // Not worth it for a target just behind the bumper; a ram or a stop handles that.
    if (onStreet && ahead > -14) return false;
    const forward = onStreet ? (bF - carF) + 2 * Math.abs(bF - aF) + (bF - goalF) : (bF - carF) + manhattan(leg.to);
    const back = 16 + (onStreet ? carF - goalF : (carF - aF) + manhattan(leg.from));
    if (back >= forward - 12) return false;
    unit.turnCooldown = 7;
    unit.turnabouts++;
    return true;
  }

  approach(unit, car, sin, cos) {
    if (unit.officer || unit.hp <= 0) return 0;
    const target = unit.stopAt;
    if (!target) return Infinity;
    const dx = target.x - car.x, dz = target.z - car.z;
    const ahead = dx * sin + dz * cos;
    if (ahead < -5 || Math.abs(dx * cos - dz * sin) > 10) return Infinity;
    return Math.sqrt(7 * Math.max(0, ahead - 2.8));
  }

  // The player took this cruiser: it stops being a unit (it no longer drives,
  // sees or chases) and dispatch fills the gap with a fresh car.
  detach(car) {
    const unit = car.policeUnit;
    if (!unit) return;
    this.units.splice(this.units.indexOf(unit), 1);
    car.policeUnit = null;
    car.sirenOn = 0;
  }

  update(dt, position, playerCar, velocity, arrest) {
    const { wanted, world } = this;
    this.dispatchDelay -= dt;
    if (!wanted.level) this.lastSeen = null;   // a cleared record does not steer the next response
    const count = wanted.level >= 4 ? 3 : wanted.level >= 3 ? 2 : wanted.level ? 1 : 0;
    if (this.units.length < count && this.dispatchDelay <= 0) {
      this.dispatch(wanted.report ?? position, velocity);
      this.dispatchDelay = 0.35;
    }
    const target = { x: position.x, y: position.y + 0.95, z: position.z };
    this.seen = this.air.update(dt, wanted.level >= 4, target, this.lastSeen ?? wanted.report);
    for (const unit of this.units) {
      const observer = unit.officer ?? unit.car;
      unit.sees = !!(wanted.level && unit.hp > 0 && visible(world, observer.x,
        unit.officer ? observer.y + 1.45 : unit.car.gY + 1.18, observer.z, target, 54));
      this.seen ||= unit.sees;
    }
    if (this.seen) this.lastSeen = { x: target.x, z: target.z };
    wanted.update(dt, this.seen);
    const wasChasing = this.units.some(u => active(u.state) || u.state === 'search');
    for (const unit of this.units) {
      this.updateUnit(unit, dt, target, playerCar, velocity, arrest);
    }
    if (wasChasing && !this.units.some(u => active(u.state) || u.state === 'search')) this.lost++;
    this.standDown(target);
  }

  // A unit back on patrol with no wanted level stands down once it has patrolled for a while and the player
  // cannot see it go (out of sight beyond 50 m, or beyond 110 m): its cruiser leaves the city and the fleet is
  // topped back up with traffic, so a finished chase leaves no extra units behind (a new crime dispatches anew).
  standDown(target) {
    if (this.wanted.level) return;
    for (const unit of [...this.units]) {
      if (unit.state !== 'patrol' || unit.officer || unit.age < 6) continue;
      const d = distance(unit.car, target), car = unit.car;
      if (d < 50 || (d < 110 && visible(this.world, car.x, car.gY + 1.2, car.z, target, 110))) continue;
      if (unit.car === this.fleet.playerVehicle || unit.car.driver === 'player') continue;
      this.units.splice(this.units.indexOf(unit), 1);
      unit.car.policeUnit = null;
      unit.car.sirenOn = 0;
      const i = this.fleet.vehicles.indexOf(unit.car);
      if (i >= 0) this.fleet.vehicles.splice(i, 1);
      this.fleet.refill(target);
    }
  }

  updateUnit(unit, dt, target, playerCar, velocity, arrest) {
    const { car, driver } = unit;
    unit.age += dt;
    unit.hit = Math.max(0, unit.hit - dt);
    unit.turnCooldown = Math.max(0, unit.turnCooldown - dt);
    unit.unseen = unit.sees ? 0 : unit.unseen + dt;
    if (unit.hp <= 0) {
      unit.recover -= dt;
      if (unit.recover <= 0) { unit.hp = 100; this.setState(unit, 'return'); }
    } else if (!this.wanted.level && unit.state !== 'patrol' && unit.state !== 'return') {
      this.setState(unit, 'lose');
    }

    const lead = this.units.indexOf(unit) > 0;
    switch (unit.state) {
      case 'patrol':
        if (this.wanted.level) this.setState(unit, 'detect');
        break;
      case 'detect':
        if (unit.age >= 0.2) this.setState(unit, 'investigate');
        break;
      case 'investigate':
        if (unit.sees) this.setState(unit, 'pursue');
        else if (unit.age > 8) this.setState(unit, 'search');
        break;
      case 'pursue':
      case 'intercept':
        if (unit.unseen > 2.6 && !this.seen) this.setState(unit, 'search');
        else if (lead && playerCar && Math.hypot(velocity.x, velocity.z) > 3) this.setState(unit, 'intercept');
        else if (unit.sees || !playerCar) this.setState(unit, 'pursue');
        break;
      case 'search':
        if (unit.sees) this.setState(unit, 'pursue');
        else if (unit.age > 9) this.setState(unit, 'lose');
        break;
      case 'lose':
        if (unit.age > 0.7) this.setState(unit, 'return');
        break;
      case 'return':
        if (unit.sees && this.wanted.level) this.setState(unit, 'detect');
        else if (unit.age > 5 && !this.wanted.level) this.setState(unit, 'patrol');
        break;
    }

    const chasing = active(unit.state);
    const responding = chasing || unit.state === 'investigate' || unit.state === 'search';
    unit.goal = responding ? this.lastSeen ?? this.wanted.report : null;
    if (unit.state === 'investigate') unit.goal = this.wanted.report ?? unit.goal;
    if (unit.goal && unit.state === 'intercept' && this.seen) {
      const leadTime = Math.min(3.6, distance(car, target) / 12);
      unit.goal = { x: target.x + velocity.x * leadTime, z: target.z + velocity.z * leadTime };
    }
    if (unit.goal && unit.state === 'search' && unit.age > 3) {
      unit.goal = { x: unit.goal.x + (lead ? 32 : -32), z: unit.goal.z + (unit.age > 6 ? 24 : -24) };
    }
    driver.cruise = chasing ? (playerCar ? 24 : 15) : responding ? 14 : 9;
    driver.ignoreSignals = responding;
    driver.cutCorners = chasing;
    driver.ramTarget = unit.sees && chasing && this.wanted.level >= 3 ? playerCar : null;
    unit.stopAt = !playerCar && unit.sees && chasing ? target : null;
    unit.siren = responding && unit.hp > 0;
    car.sirenOn = unit.siren ? 1 : 0;   // the cruiser model's own light bar
    driver.pursuit = unit.siren;

    if (unit.officer && (!chasing || playerCar || unit.hp <= 0)) unit.officer = null;
    if (unit.stopAt && !unit.officer && car.speed < 2 && distance(car, target) < 12 && unit.hp > 0) {
      const exit = this.exitTowards(car, target);
      if (exit) unit.officer = { x: exit.x, z: exit.z, y: this.world.groundHeight(exit.x, exit.z), yaw: car.yaw, phase: 0 };
    }
    if (unit.officer) this.walkOfficer(unit, target, dt, arrest);
  }

  // Door on the side of the car facing the target, if clear; else any exit.
  exitTowards(car, target) {
    const side = (target.x - car.x) * Math.cos(car.yaw) - (target.z - car.z) * Math.sin(car.yaw) > 0 ? 1 : -1;
    for (const s of [side, -side]) {
      const p = this.fleet.doorPoint(car, s, 0.6);
      if (this.world.layout.walkable(p.x, p.z) && !this.world.colliders.resolveCircle({ ...p }, 0.28, 0.16, 1.75)
        && !this.fleet.pushWalker({ ...p }, 0.28)) return p;
    }
    return this.fleet.exitPoint(car);
  }

  walkOfficer(unit, target, dt, arrest) {
    const p = unit.officer;
    const goal = unit.sees ? target : this.lastSeen;
    if (!goal) return;
    const d = distance(p, goal);
    if (unit.sees && d < 1.35 && Math.abs(p.y + 0.95 - target.y) < 0.9) { arrest(); return; }
    if (d < 0.1 || unit.hit > 0.12) return;
    const yaw = Math.atan2(goal.x - p.x, goal.z - p.z);
    // Head straight for the target; when a car or wall is in the way, sidestep,
    // keeping to the side chosen last time so the officer walks round the
    // obstacle instead of dithering in front of it.
    const side = p.detour || 1;
    const step = Math.min(d, dt * 4.9);
    for (const offset of [0, 0.65, 1.2, 1.75, 2.4].flatMap(o => o ? [o * side, -o * side] : [0])) {
      const to = { x: p.x + Math.sin(yaw + offset) * step, z: p.z + Math.cos(yaw + offset) * step };
      if (!this.world.layout.walkable(to.x, to.z) || this.world.colliders.resolveCircle(to, 0.28, 0.16, 1.75) || this.fleet.pushWalker(to, 0.28)) continue;
      if (offset) p.detour = Math.sign(offset);
      Object.assign(p, to, { y: this.world.groundHeight(to.x, to.z), yaw: yaw + offset, phase: p.phase + dt * 15 });
      break;
    }
  }

  damage(unit, amount) {
    const damage = Math.min(unit.hp, amount);
    if (!damage) return 0;
    unit.hp -= damage;
    unit.hit = 0.25;
    if (!unit.hp) { unit.recover = 14; this.setState(unit, 'lose'); }
    return damage;
  }

  // Would any unit (car or officer on foot) see a player standing here? Tool hook.
  exposed(x, y, z) {
    const target = { x, y: y + 0.95, z };
    return this.units.some(u => u.hp > 0 && visible(this.world, (u.officer ?? u.car).x,
      u.officer ? u.officer.y + 1.45 : u.car.gY + 1.18, (u.officer ?? u.car).z, target, 54));
  }

  snapshot(position) {
    return { seen: this.seen, lost: this.lost, lastSeen: this.lastSeen, helicopter: this.air.status(), units: this.units.map(unit => ({
      id: unit.car.id, state: unit.state, sees: unit.sees, states: [...unit.visited], distance: distance(unit.car, position),
      speed: unit.car.speed, hp: unit.hp, hit: unit.hit, hardStops: unit.car.blocked ?? 0, officer: !!unit.officer, turnabouts: unit.turnabouts, turning: !!unit.driver.turnabout,
      ...cruiserObstruction(unit.car, this.world.colliders, this.fleet.ground),
    })) };
  }
}
