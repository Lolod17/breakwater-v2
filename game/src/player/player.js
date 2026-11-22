// Player controller: camera-relative movement with acceleration, friction,
// sprint and walk, kerb steps, jump, collision against the city, and the
// interpolated state the renderer and camera read.
import * as THREE from '../../vendor/three.min.js';
import { buildCharacter, gaitParams } from './character.js';

const SPEED = { walk: 1.7, jog: 4.3, sprint: 7.0 };
const ACCEL = 22, FRICTION = 16, TURN_RATE = 11, RADIUS = 0.32;
const GRAVITY = 15, JUMP_V = 4.8;

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Player {
  constructor(world, materials) {
    this.world = world;
    this.char = buildCharacter(world.lm);
    this.object = this.char.root;
    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.yaw = 0; this.prevYaw = 0;
    this.phase = 0; this.prevPhase = 0;
    this.speed = 0;         // measured ground speed, drives the animation
    this.sprint = 0;        // 0..1 smoothed sprint amount
    this.crouched = false;  // PASS 14b: set from stealth.js each step
    this.roll = 0; this.lean = 0;
    this.grounded = true;
    this.air = 0;
    this.time = 0;
    this.autoWish = null;   // tools: direct world-space wish {x, z, sprint}
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2), materials.blob);
    this.blob.renderOrder = 2;
  }

  spawn(x, z, yaw = 0) {
    this.pos.set(x, this.world.groundHeight(x, z), z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.vy = this.air = this.speed = this.sprint = this.roll = this.lean = 0;
    this.grounded = true;
    this.yaw = this.prevYaw = yaw;
  }

  update(dt, input, camYaw) {
    this.prevPos.copy(this.pos);
    this.prevYaw = this.yaw;
    this.prevPhase = this.phase;
    this.time += dt;

    // wish direction relative to the camera (camera sits at +offset(yaw), looking back)
    let wx = 0, wz = 0, sprinting = false, walking = false, mag = 0;
    if (this.autoWish) {
      wx = this.autoWish.x; wz = this.autoWish.z; sprinting = !!this.autoWish.sprint; mag = Math.hypot(wx, wz);
    } else {
      const m = input.move();
      const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
      const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
      wx = fx * m.y + rx * m.x; wz = fz * m.y + rz * m.x;
      mag = Math.hypot(m.x, m.y);
      sprinting = input.sprint(); walking = input.walk();
    }
    if (this.crouched) { walking = true; sprinting = false; }   // PASS 14b: crouch-walk (stealth.js owns the toggle)
    if (mag > 1e-3) { const l = Math.hypot(wx, wz) || 1; wx /= l; wz /= l; }
    const top = mag < 1e-3 ? 0 : walking ? SPEED.walk : sprinting ? SPEED.sprint : SPEED.jog;
    this.sprint += ((sprinting && mag > 0 ? 1 : 0) - this.sprint) * Math.min(1, dt * 4);

    const tx = wx * top * Math.min(1, mag), tz = wz * top * Math.min(1, mag);
    const dvx = tx - this.vel.x, dvz = tz - this.vel.z;
    const dl = Math.hypot(dvx, dvz);
    const rate = (mag > 1e-3 ? ACCEL : FRICTION) * (this.grounded ? 1 : 0.25) * dt;
    if (dl > 0) { const k = Math.min(1, rate / dl); this.vel.x += dvx * k; this.vel.z += dvz * k; }

    // integrate and collide
    const old = this.pos.clone();
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.world.colliders.resolveCircle(this.pos, RADIUS, this.pos.y + 0.25, this.pos.y + 1.75);
    if (!this.world.layout.walkable(this.pos.x, this.pos.z)) {
      if (this.world.layout.walkable(this.pos.x, old.z)) this.pos.z = old.z;
      else if (this.world.layout.walkable(old.x, this.pos.z)) this.pos.x = old.x;
      else { this.pos.x = old.x; this.pos.z = old.z; }
    }
    // velocity follows what actually happened, so walls absorb momentum
    const mvx = (this.pos.x - old.x) / dt, mvz = (this.pos.z - old.z) / dt;
    this.vel.x = mvx; this.vel.z = mvz;

    // vertical: kerb steps, jump, gravity
    const gh = this.world.groundHeight(this.pos.x, this.pos.z);
    if (this.grounded && input && !this.autoWish && input.jump() && !this._jumpHeld) { this.vy = JUMP_V; this.grounded = false; }
    this._jumpHeld = input && !this.autoWish ? input.jump() : false;
    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= gh) { this.pos.y = gh; this.vy = 0; this.grounded = true; }
    } else {
      if (gh < this.pos.y - 0.4) { this.grounded = false; this.vy = 0; }
      else this.pos.y += (gh - this.pos.y) * Math.min(1, dt * 18);
    }
    this.air += ((this.grounded ? 0 : 1) - this.air) * Math.min(1, dt * 10);

    // facing and body lean
    const sp = Math.hypot(mvx, mvz);
    let turn = 0;
    if (sp > 0.25 && mag > 1e-3) {
      const target = Math.atan2(mvx, mvz);
      const d = wrap(target - this.yaw);
      const step = Math.sign(d) * Math.min(Math.abs(d), TURN_RATE * dt);
      this.yaw = wrap(this.yaw + step);
      turn = step / dt;
    }
    this.roll += (Math.max(-0.22, Math.min(0.22, -turn * sp * 0.012)) - this.roll) * Math.min(1, dt * 8);
    const accel = (sp - this.speed) / dt;
    this.lean += (Math.max(-0.12, Math.min(0.14, accel * 0.012)) - this.lean) * Math.min(1, dt * 6);
    this.speed = sp;

    // gait phase advances at the rate that keeps the stance foot locked to the ground
    if (this.grounded) this.phase = (this.phase + dt / gaitParams(this.speed).T) % 1;
  }

  // Interpolate between the last two simulation states and pose the rig.
  render(alpha) {
    const o = this.object;
    o.position.lerpVectors(this.prevPos, this.pos, alpha);
    o.rotation.y = this.prevYaw + wrap(this.yaw - this.prevYaw) * alpha;
    let dp = this.phase - this.prevPhase;
    if (dp < 0) dp += 1;
    const phase = (this.prevPhase + dp * alpha) % 1;
    this.char.pose(phase, this.speed, { lean: this.lean, roll: this.roll, air: this.air, t: this.time });
    const gh = this.world.groundHeight(o.position.x, o.position.z);
    this.blob.position.set(o.position.x, gh + 0.015, o.position.z);
    const k = Math.max(0.4, 1 - (o.position.y - gh) * 0.5);
    this.blob.scale.setScalar(k);
  }
}
