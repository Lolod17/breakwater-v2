// Blends between the on-foot chase camera and the driving camera. Each writes
// into its own proxy; the rig eases the real camera from one to the other
// (position, orientation and FOV) over a short smoothstep when the player gets
// into or out of a car.
import * as THREE from '../../vendor/three.min.js';

const smooth = (x) => x * x * (3 - 2 * x);

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.w = 0;           // 0 = on foot, 1 = driving
    this.target = 0;
    this.duration = 0.75;
    this._q = new THREE.Quaternion();
  }

  setMode(driving) { this.target = driving ? 1 : 0; }
  snapMode(driving) { this.target = this.w = driving ? 1 : 0; }

  apply(dt, foot, car) {
    // move the blend weight towards the target at a constant rate (full swap = duration)
    const step = dt / this.duration;
    this.w = this.target > this.w ? Math.min(this.target, this.w + step) : Math.max(this.target, this.w - step);
    const k = smooth(this.w);
    const cam = this.camera;
    if (k <= 0) { cam.position.copy(foot.position); cam.quaternion.copy(foot.quaternion); this._fov(foot.fov); return; }
    if (k >= 1) { cam.position.copy(car.position); cam.quaternion.copy(car.quaternion); this._fov(car.fov); return; }
    cam.position.lerpVectors(foot.position, car.position, k);
    this._q.copy(foot.quaternion).slerp(car.quaternion, k);
    cam.quaternion.copy(this._q);
    this._fov(foot.fov + (car.fov - foot.fov) * k);
  }

  _fov(f) {
    if (Math.abs(this.camera.fov - f) > 0.01) { this.camera.fov = f; this.camera.updateProjectionMatrix(); }
    this.camera.updateMatrixWorld();
  }
}
