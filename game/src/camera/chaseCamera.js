// Third-person chase camera: damped follow of a pivot above the player's
// shoulder, mouse orbit, auto-recentre behind the player when running, wall
// avoidance by raycasting pivot->camera against the city, and FOV breathing
// while sprinting.
import * as THREE from '../../vendor/three.min.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

export class ChaseCamera {
  constructor(camera, colliders, groundHeight) {
    this.camera = camera;
    this.colliders = colliders;
    this.groundHeight = groundHeight;
    this.yaw = Math.PI;      // camera offset direction (sin yaw, cos yaw)
    this.pitch = 0.22;
    this.zoom = 4.4;
    this.dist = 4.4;
    this.pivot = new THREE.Vector3();
    this.fov = 60;
    this.t = 0;
    this.idleLook = 99;
    this.locked = false;     // tools can pin the pose
    this.noCollide = false;  // tools: free aerial framing
    this._dir = new THREE.Vector3();
    this._des = new THREE.Vector3();
    this._look = new THREE.Vector3();
  }

  snap(target, playerYaw) {
    this.yaw = playerYaw + Math.PI;
    this.pivot.set(target.x, target.y + 1.55, target.z);
    this.dist = this.zoom;
  }

  update(dt, target, player, look) {
    this.t += dt;
    const sprint = player.sprint;
    const speed = player.speed;
    if (!this.locked) {
      if (look.x || look.y) this.idleLook = 0; else this.idleLook += dt;
      this.yaw = wrap(this.yaw - look.x * 0.0024);
      this.pitch = Math.max(-0.3, Math.min(1.25, this.pitch + look.y * 0.0021));
      if (look.wheel) this.zoom = Math.max(2.4, Math.min(9, this.zoom + look.wheel * 0.6));
      this.noCollide = false;
      // drift back behind the player when running and the mouse is idle
      if (!this.aiming && speed > 1.2 && this.idleLook > 1.4) {
        const behind = player.yaw + Math.PI;
        const d = wrap(behind - this.yaw);
        this.yaw = wrap(this.yaw + d * (1 - Math.exp(-dt * 1.4 * Math.min(1, speed / 4))));
        this.pitch = damp(this.pitch, 0.2, 0.8, dt);
      }
    }
    // pivot: above the right shoulder, smoothed
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const shoulder = this.aiming ? 0.64 : 0.3;
    const px = target.x + rx * shoulder, pz = target.z + rz * shoulder;
    this.pivot.x = damp(this.pivot.x, px, 14, dt);
    this.pivot.z = damp(this.pivot.z, pz, 14, dt);
    this.pivot.y = damp(this.pivot.y, target.y + 1.55 - 0.05 * sprint, 9, dt);

    const pitch = this.pitch - (this.recoil || 0);
    const cp = Math.cos(pitch);
    this._dir.set(Math.sin(this.yaw) * cp, Math.sin(pitch), Math.cos(this.yaw) * cp);
    const want = this.aiming ? 2.25 : this.zoom + 0.7 * sprint;
    // wall avoidance: pull in instantly, ease back out
    const hit = this.noCollide ? Infinity : this.colliders.raycast(this.pivot, this._dir, want + 0.3);
    const allowed = Math.max(0.7, Math.min(want, hit - 0.3));
    this.dist = allowed < this.dist ? allowed : damp(this.dist, allowed, 3, dt);
    this._des.copy(this.pivot).addScaledVector(this._dir, this.dist);
    const floor = this.groundHeight(this._des.x, this._des.z) + 0.3;
    if (this._des.y < floor) this._des.y = floor;
    this.camera.position.copy(this._des);
    this._look.copy(this.pivot);
    this._look.y += 0.05;
    this.camera.lookAt(this._look);

    // FOV breathing: wider when sprinting, with a slight pulse at stride rate
    const pulse = Math.sin(this.t * 2 * Math.PI * 2.2) * 0.6 * sprint;
    this.fov = damp(this.fov, this.aiming ? 48 : 60 + 7 * sprint + pulse, 8, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
