// Getting in and out of cars. On foot, the nearest car within reach raises a
// prompt; F (or Enter) walks the player to the driver's door, hides the body
// and hands the camera to the chase cam. Taking a car that has a driver throws
// them out (a carjack). In the car, the keys drive it; F brings it to a stop
// and steps the player out at a clear spot beside a door (pavement side
// preferred), checked against buildings, props and other cars, never through
// them.

const ENTER_REACH = 1.9;
const EXIT_SPEED = 2.5;

export class Driving {
  constructor(player, vehicles, rig, chase, carCam) {
    this.player = player; this.vehicles = vehicles; this.rig = rig; this.chase = chase; this.carCam = carCam;
    this.state = 'foot';           // foot | entering | driving | exiting
    this.vehicle = null;
    this.candidate = null;
    this.timer = 0;
    this.from = { x: 0, z: 0 }; this.to = { x: 0, z: 0 };
    this.message = ''; this.messageT = 0;
    this.wantExit = false;
    this.autopilot = null;
    this.scripted = false;         // tools script v.ctrl directly; skip keyboard input
  }

  get driving() { return this.state === 'driving' || this.state === 'exiting'; }
  say(msg, t = 2) { this.message = msg; this.messageT = t; }

  // Fixed step, before vehicles.step(). Returns true when the player walks this step.
  preStep(dt, input) {
    if (this.messageT > 0) this.messageT -= dt;
    const p = this.player;
    if (this.state === 'foot') {
      this.candidate = this.vehicles.nearestEnterable(p.pos, ENTER_REACH);
      if (this.candidate && input.tap('KeyF', 'Enter')) this.beginEnter(this.candidate);
      return this.state === 'foot';
    }
    if (this.state === 'entering') {
      this.timer += dt;
      const k = Math.min(1, this.timer / 0.35);
      p.pos.x = this.from.x + (this.to.x - this.from.x) * k;
      p.pos.z = this.from.z + (this.to.z - this.from.z) * k;
      p.prevPos.copy(p.pos);
      if (k >= 1) this.finishEnter();
      return false;
    }
    const v = this.vehicle;
    if (this.state === 'driving') {
      if (!this.autopilot && !this.scripted) {
        const d = input.drive();
        Object.assign(v.ctrl, d);
        v.horn = d.horn;
      }
      // the exit key counts even while a tool scripts the pedals (it is a real key press)
      if (!this.autopilot && input.tap('KeyF', 'Enter')) this.wantExit = true;
      if (this.wantExit) {
        v.ctrl.throttle = 0; v.ctrl.brake = v.fwd > 0.3 ? 1 : 0; v.ctrl.handbrake = v.speed < 1;
        if (v.speed < EXIT_SPEED) {
          const spot = this.vehicles.exitPoint(v);
          this.wantExit = false;
          if (spot) { this.state = 'exiting'; this.timer = 0; this.to = spot; }
          else this.say('No room to get out here');
        }
      }
    } else if (this.state === 'exiting') {
      v.ctrl.throttle = 0; v.ctrl.brake = 1; v.ctrl.handbrake = true; v.horn = false;
      this.timer += dt;
      if (this.timer > 0.25) this.finishExit();
    }
    // keep the hidden body with the car (shadow focus, district lookup)
    if (this.vehicle) { p.pos.set(v.x, p.pos.y, v.z); p.prevPos.copy(p.pos); }
    return false;
  }

  beginEnter(v) {
    const p = this.player;
    if (v.driver && v.driver !== 'player') { v.driver = null; this.say(`Took the ${v.type.label}`); }
    this.onTake?.(v);
    const door = this.vehicles.doorPoint(v, 1, 0.45);
    this.from = { x: p.pos.x, z: p.pos.z };
    // walk to the driver's door only if nothing stands in between
    const dx = door.x - p.pos.x, dz = door.z - p.pos.z, len = Math.hypot(dx, dz);
    const clear = len < 0.05 || this.vehicles.colliders.raycast({ x: p.pos.x, y: 1, z: p.pos.z }, { x: dx / len, y: 0, z: dz / len }, len) >= len - 0.01;
    this.to = clear && this.vehicles.world.layout.walkable(door.x, door.z) ? door : { ...this.from };
    p.yaw = Math.atan2(v.x - p.pos.x, v.z - p.pos.z);
    this.vehicle = v;
    this.state = 'entering';
    this.timer = 0;
    v.wake();
  }

  finishEnter() {
    const v = this.vehicle;
    v.driver = this.autopilot || 'player';
    v.ctrl.handbrake = false;
    this.player.object.visible = false;
    this.player.blob.visible = false;
    this.state = 'driving';
    this.carCam.snap({ x: v.x, y: v.gY, z: v.z, yaw: v.yaw, type: v.type });
    this.rig.setMode(true);
  }

  // Instant placement for tools (staged shots, gate autopilot).
  enterNow(v, autopilot = null) {
    this.autopilot = autopilot;
    this.vehicle = v;
    if (v.driver && v.driver !== 'player' && v.driver !== autopilot) v.driver = null;
    this.onTake?.(v);
    this.finishEnter();
    this.rig.snapMode(true);
  }

  finishExit() {
    const v = this.vehicle, p = this.player;
    v.driver = null; v.horn = false;
    v.ctrl.throttle = 0; v.ctrl.brake = 0; v.ctrl.steer = 0; v.ctrl.handbrake = true;
    const yaw = Math.atan2(this.to.x - v.x, this.to.z - v.z);
    p.spawn(this.to.x, this.to.z, yaw);
    p.object.visible = true;
    p.blob.visible = true;
    this.chase.snap(p.pos, v.yaw);
    this.chase.yaw = this.carCam.yaw + this.carCam.orbit + Math.PI;
    this.rig.setMode(false);
    this.vehicle = null; this.autopilot = null;
    this.state = 'foot';
  }

  // Leave the car instantly (tools).
  reset() {
    if (this.vehicle) { this.vehicle.driver = null; }
    this.vehicle = null; this.autopilot = null; this.state = 'foot'; this.wantExit = false; this.scripted = false;
    this.player.object.visible = true; this.player.blob.visible = true;
    this.rig.snapMode(false);
  }

  // Interpolated pose of the player's car for the camera.
  pose(alpha) {
    const v = this.vehicle;
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    return {
      x: v.px + (v.x - v.px) * alpha, z: v.pz + (v.z - v.pz) * alpha, y: v.gY,
      yaw: v.pyaw + wrap(v.yaw - v.pyaw) * alpha, speed: v.speed, fwd: v.fwd, r: v.r, vx: v.vx, vz: v.vz, type: v.type,
    };
  }
}
