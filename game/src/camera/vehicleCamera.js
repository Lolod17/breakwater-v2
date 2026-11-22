// Driving camera: a lagging chase behind the car whose distance and FOV grow
// with speed, that looks ahead into corners (and swings slightly wide of them),
// can be orbited with the mouse (recentres when idle), pulls in against walls
// and shakes on impacts. Writes into its own proxy camera; CameraRig blends.
import * as THREE from '../../vendor/three.min.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const noise = (t, s) => Math.sin(t * 37.1 + s) * 0.5 + Math.sin(t * 61.7 + s * 2.3) * 0.3 + Math.sin(t * 13.3 + s * 4.1) * 0.2;

export class VehicleCamera {
  constructor(colliders, groundHeight) {
    this.cam = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 6000);
    this.colliders = colliders;
    this.groundHeight = groundHeight;
    this.yaw = 0;            // heading the camera trails (car space: behind = yaw + PI)
    this.orbit = 0; this.orbitPitch = 0; this.idle = 99;
    this.dist = 6; this.fov = 62; this.trauma = 0; this.t = 0;
    this.speedLag = 0;       // speed smoothed over ~0.6 s; drives distance, pitch and FOV
    this.look = new THREE.Vector3(); this.pos = new THREE.Vector3();
    this._dir = new THREE.Vector3(); this._piv = new THREE.Vector3();
    this.locked = false;
  }

  snap(pose) {
    this.yaw = pose.yaw; this.orbit = 0; this.orbitPitch = 0;
    this.dist = this.baseDist(pose.type);
    this.look.set(pose.x, pose.y + pose.type.height * 0.75, pose.z);
    this.speedLag = 0;
  }

  baseDist(t) { return 3.3 + t.length * 0.62 + t.height * 0.5; }
  shake(amount) { this.trauma = Math.min(1, this.trauma + amount); }

  // pose: interpolated { x, y, z, yaw, speed, fwd, r, type, vx, vz }
  update(dt, pose, look) {
    this.t += dt;
    const t = pose.type;
    // mouse orbit with auto-recentre
    if (look && (look.x || look.y)) { this.idle = 0; this.orbit = wrap(this.orbit - look.x * 0.0026); this.orbitPitch = Math.max(-0.25, Math.min(0.7, this.orbitPitch + look.y * 0.002)); }
    else this.idle += dt;
    if (this.idle > 1.3) { this.orbit = damp(this.orbit, 0, 2.2, dt); this.orbitPitch = damp(this.orbitPitch, 0, 2.2, dt); }

    // heading lag: trail the body, lean towards the direction of travel when sliding
    let heading = pose.yaw;
    if (pose.speed > 4 && pose.fwd > 0) {
      const vel = Math.atan2(pose.vx, pose.vz);
      heading = pose.yaw + wrap(vel - pose.yaw) * 0.45;
    }
    if (pose.fwd < -3) heading = pose.yaw;   // reversing: stay behind the car
    this.yaw = wrap(this.yaw + wrap(heading - this.yaw) * (1 - Math.exp(-dt * (2.6 + pose.speed * 0.04))));

    const spd = Math.max(0, pose.speed);
    this.speedLag = damp(this.speedLag, spd, 1.6, dt);
    const wantDist = this.baseDist(t) + Math.min(4.5, this.speedLag * 0.085);
    const camYaw = this.yaw + this.orbit - pose.r * 0.08;    // swing slightly wide of the corner
    const pitch = 0.2 + this.orbitPitch - Math.min(0.06, this.speedLag * 0.0012);

    // look target: ahead of the car and into the turn
    const s = Math.sin(pose.yaw), co = Math.cos(pose.yaw);
    const ahead = 1.2 + Math.min(6, spd * 0.12);
    const into = Math.max(-3, Math.min(3, pose.r * spd * 0.12));
    const lx = pose.x + s * ahead + co * into, lz = pose.z + co * ahead - s * into;
    const ly = pose.y + t.height * 0.72 + 0.35;
    this.look.x = damp(this.look.x, lx, 9, dt); this.look.z = damp(this.look.z, lz, 9, dt); this.look.y = damp(this.look.y, ly, 6, dt);

    // camera on a sphere around the car's roof pivot, pulled in against walls
    this._piv.set(pose.x, pose.y + t.height * 0.8 + 0.3, pose.z);
    const cp = Math.cos(pitch);
    this._dir.set(-Math.sin(camYaw) * cp, Math.sin(pitch), -Math.cos(camYaw) * cp);
    const hit = this.colliders.raycast(this._piv, this._dir, wantDist + 0.4);
    const allowed = Math.max(1.6, Math.min(wantDist, hit - 0.4));
    this.dist = allowed < this.dist ? damp(this.dist, allowed, 25, dt) : damp(this.dist, allowed, 2.5, dt);
    this.pos.copy(this._piv).addScaledVector(this._dir, this.dist);
    const floor = this.groundHeight(this.pos.x, this.pos.z) + 0.35;
    if (this.pos.y < floor) this.pos.y = floor;

    // impact shake (trauma^2), decays
    const k = this.trauma * this.trauma;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    this.cam.position.copy(this.pos);
    this.cam.position.x += noise(this.t, 1) * 0.35 * k;
    this.cam.position.y += noise(this.t, 2) * 0.25 * k;
    this.cam.position.z += noise(this.t, 3) * 0.35 * k;
    this.cam.lookAt(this.look);
    this.cam.rotateZ(noise(this.t, 4) * 0.05 * k);

    // FOV widens with speed
    this.fov = damp(this.fov, 62 + Math.min(20, this.speedLag * 0.36), 3, dt);
    this.cam.fov = this.fov;
  }
}
