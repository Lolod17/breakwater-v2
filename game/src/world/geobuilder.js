// Accumulates triangles from many pieces into one BufferGeometry so a whole
// district shares a handful of draw calls. Supports per-piece colour, baked
// ground-contact darkening and world-space planar UVs.
import * as THREE from '../../vendor/three.min.js';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();
const _mat = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _unitBox = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();

export class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
  }

  get vertexCount() { return this.pos.length / 3; }

  // Append any geometry, transformed by matrix. opts: color, ao (darken near y=aoBase),
  // worldUV (planar projection scale, metres per UV unit), uvOffset.
  addGeometry(geo, matrix, opts = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    _m3.getNormalMatrix(matrix);
    const c = opts.color || WHITE;
    const ao = opts.ao, aoBase = opts.aoBase || 0;
    const wuv = opts.worldUV;
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(matrix);
      _n.fromBufferAttribute(N, i).applyMatrix3(_m3).normalize();
      this.pos.push(_v.x, _v.y, _v.z);
      this.nor.push(_n.x, _n.y, _n.z);
      if (wuv) {
        const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
        if (ay >= ax && ay >= az) this.uv.push(_v.x / wuv, _v.z / wuv);
        else if (ax >= az) this.uv.push(_v.z / wuv, _v.y / wuv);
        else this.uv.push(_v.x / wuv, _v.y / wuv);
      } else if (U) {
        this.uv.push(U.getX(i), U.getY(i));
      } else this.uv.push(0, 0);
      let k = 1;
      if (ao) k = 1 - ao * (1 - smooth01((_v.y - aoBase) / 1.6));
      this.col.push(c.r * k, c.g * k, c.b * k);
    }
    return this;
  }

  // Axis-aligned (optionally yaw-rotated) box by centre and size.
  box(cx, cy, cz, sx, sy, sz, opts = {}) {
    _q.setFromAxisAngle(_up, opts.rotY || 0);
    _mat.compose(_p.set(cx, cy, cz), _q, _s.set(sx, sy, sz));
    return this.addGeometry(_unitBox, _mat, opts);
  }

  // Box from min/max corners.
  boxMinMax(x0, y0, z0, x1, y1, z1, opts) {
    return this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, opts);
  }

  // Quad from four corners (counter-clockwise seen from the front) with explicit UVs.
  quad(a, b, c, d, uvs, color = WHITE) {
    _n.subVectors(b, a).cross(_v.subVectors(d, a)).normalize();
    const verts = [a, b, c, a, c, d];
    const uvIdx = [0, 1, 2, 0, 2, 3];
    for (let i = 0; i < 6; i++) {
      const p = verts[i];
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(_n.x, _n.y, _n.z);
      const u = uvs[uvIdx[i]];
      this.uv.push(u[0], u[1]);
      const cc = Array.isArray(color) ? color[uvIdx[i]] : color;
      this.col.push(cc.r, cc.g, cc.b);
    }
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const WHITE = new THREE.Color(1, 1, 1);

export function smooth01(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

export function mat4(x, y, z, rotY = 0, sx = 1, sy = 1, sz = 1) {
  _q.setFromAxisAngle(_up, rotY);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(sx, sy, sz));
}

// Turn a prototype builder into an InstancedMesh from a list of {x,y,z,rot,s}.
export function instance(geometry, material, placements, { castShadow = true, receiveShadow = true } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, placements.length));
  mesh.count = placements.length;
  placements.forEach((p, i) => {
    mesh.setMatrixAt(i, mat4(p.x, p.y || 0, p.z, p.rot || 0, p.s || 1, p.sy || p.s || 1, p.s || 1));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.computeBoundingSphere();
  return mesh;
}
