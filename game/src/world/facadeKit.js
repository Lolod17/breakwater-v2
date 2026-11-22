// Facade depth at the street edge, as one instanced mesh: every element is a
// coloured box instance (window sills, balcony slabs, railings and balustrades,
// AC boxes with their grilles, floor ledges and fins, shopfront mullions,
// transoms and stall risers). Elements are placed by the generators from the
// same window grid the facade textures paint, so a sill sits under a painted
// window. Instances are bucketed in 40 m cells and repacked when the camera
// moves, so only the street around the camera is drawn: one draw call, no
// shadow pass.
import * as THREE from '../../vendor/three.min.js';
import { GeoBuilder } from './geobuilder.js';

const CELL = 40;
const RANGE = 125;

export class FacadeKit {
  constructor() {
    this.cells = new Map();
    this.count = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  // A box by centre and size, yawed about y; colour as THREE.Color.
  box(x, y, z, sx, sy, sz, yaw, color) {
    this._q.setFromAxisAngle(this._up, yaw);
    this._m.compose(this._p.set(x, y, z), this._q, this._s.set(sx, sy, sz));
    const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    let c = this.cells.get(key);
    if (!c) this.cells.set(key, c = { cx: Math.floor(x / CELL), cz: Math.floor(z / CELL), m: [], c: [] });
    c.m.push(...this._m.elements);
    c.c.push(color.r, color.g, color.b);
    this.count++;
  }

  // Box placed relative to a facade side: `a` along the side from p0, `o` out
  // along the normal (positive = in front of the wall), y up; sizes are
  // (along, height, out).
  onSide(s, a, o, y, w, h, d, color) {
    const tx = s.nz, tz = -s.nx;
    const x = s.p0[0] + tx * a + s.nx * o, z = s.p0[1] + tz * a + s.nz * o;
    this.box(x, y, z, w, h, d, Math.atan2(s.nx, s.nz), color);
  }

  build(material) {
    const b = new GeoBuilder();
    b.box(0, 0, 0, 1, 1, 1, {});
    // the box's local z is "out" from the wall and x is "along" (yaw = atan2(nx, nz))
    const geo = b.build();
    let cap = 0;
    for (const c of this.cells.values()) {
      c.m = new Float32Array(c.m); c.c = new Float32Array(c.c);
      c.n = c.c.length / 3;
      cap += c.n;
    }
    this.cap = cap;
    const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, Math.min(cap, 24000)));
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.count * 3), 3);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = 'facade-kit';
    this.mesh = mesh;
    this.lastX = Infinity; this.lastZ = Infinity;
    return mesh;
  }

  update(camera) {
    const x = camera.position.x, z = camera.position.z;
    if (Math.hypot(x - this.lastX, z - this.lastZ) < 6) return;
    this.lastX = x; this.lastZ = z;
    const mesh = this.mesh, M = mesh.instanceMatrix.array, Cc = mesh.instanceColor.array, max = M.length / 16;
    let n = 0;
    const r = Math.ceil(RANGE / CELL);
    const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
    // nearest cells first so the cap (if ever hit) drops the far ones
    const list = [];
    for (let i = -r; i <= r; i++) for (let k = -r; k <= r; k++) {
      const c = this.cells.get(`${gx + i},${gz + k}`);
      if (!c) continue;
      const dx = (c.cx + 0.5) * CELL - x, dz = (c.cz + 0.5) * CELL - z;
      const d = Math.hypot(dx, dz);
      if (d > RANGE + CELL * 0.71) continue;
      list.push([d, c]);
    }
    list.sort((a, b) => a[0] - b[0]);
    for (const [, c] of list) {
      const take = Math.min(c.n, max - n);
      if (take <= 0) break;
      M.set(c.m.subarray(0, take * 16), n * 16);
      Cc.set(c.c.subarray(0, take * 3), n * 3);
      n += take;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }
}
