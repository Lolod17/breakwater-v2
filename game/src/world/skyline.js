// The skyline ring around downtown: simpler buildings on the extended grid so
// the district sits inside a real city. Visible and lit, not yet playable.
import * as THREE from '../../vendor/three.min.js';
import { CITY } from '../config.js';
import { FACADE_BAYS, SHOP_VARIANTS } from './textures.js';
import { mat4 } from './geobuilder.js';

const _cyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1);

const K = CITY.kerbH;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const h01 = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };

function wallQuad(b, ax, az, bx, bz, y0, y1, uv, c) {
  b.quad(V(ax, y0, az), V(bx, y0, bz), V(bx, y1, bz), V(ax, y1, az),
    [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]], c);
}

export function buildSkyline(layout, rng, B, colliders, lm) {
  const tints = ['#c8d0d8', '#e0d6c8', '#d8c0b0', '#b8c4d0', '#e8e0d0', '#f0c8b0', '#b0d0c8'];
  let count = 0;
  // roof dressing draws from its own stream so the buildings stay as they were
  const roof = rng.fork('roof-dressing');
  const wood = new THREE.Color('#5b4636'), steel = new THREE.Color('#55585e'), dark = new THREE.Color('#2b2c30');
  for (const block of layout.outerBlocks) {
    const l = block.lot;
    const cx = (l.x0 + l.x1) / 2, cz = (l.z0 + l.z1) / 2;
    const mx = l.x0 + (l.x1 - l.x0) * rng.float(0.4, 0.6), mz = l.z0 + (l.z1 - l.z0) * rng.float(0.4, 0.6);
    const north = Math.max(0, -cz) / 500;
    for (const r of [{ x0: l.x0, x1: mx, z0: l.z0, z1: mz }, { x0: mx, x1: l.x1, z0: l.z0, z1: mz }, { x0: l.x0, x1: mx, z0: mz, z1: l.z1 }, { x0: mx, x1: l.x1, z0: mz, z1: l.z1 }]) {
      const dist = Math.hypot(cx, cz);
      let floors = rng.int(3, 7) + Math.round(rng.float(0, 18) * (0.4 + north) * Math.max(0, 1 - dist / 800));
      if (rng.chance(0.08 + north * 0.2)) floors = rng.int(16, 30);
      const style = floors >= 14 ? rng.pick([0, 2]) : rng.pick([1, 2, 3, 1]);
      const H = 4.6 + (floors - 1) * 3.4;
      const tint = new THREE.Color(rng.pick(tints));
      const fb = B.facade[style];
      const uOff = rng.int(0, 15), vOff = rng.int(0, 15);
      const sides = [
        [r.x0, r.z1, r.x1, r.z1], [r.x1, r.z1, r.x1, r.z0], [r.x1, r.z0, r.x0, r.z0], [r.x0, r.z0, r.x0, r.z1],
      ];
      const sv = rng.int(0, SHOP_VARIANTS - 1);
      for (const [ax, az, bx, bz] of sides) {
        const len = Math.hypot(bx - ax, bz - az);
        const nb = Math.max(1, Math.round(len / 3.2));
        wallQuad(fb, ax, az, bx, bz, 4.6, H, [uOff / FACADE_BAYS, vOff / FACADE_BAYS, (uOff + nb) / FACADE_BAYS, (vOff + (floors - 1)) / FACADE_BAYS], tint);
        wallQuad(B.shop, ax, az, bx, bz, K, 3.7, [0, 1 - (sv + 1) / SHOP_VARIANTS + 0.002, Math.max(1, Math.round(len / 4.5)), 1 - sv / SHOP_VARIANTS - 0.002], new THREE.Color(1, 1, 1));
        wallQuad(B.trim, ax, az, bx, bz, 3.7, 4.6, [0, 0, 1, 1], new THREE.Color('#24211f'));
      }
      B.trim.quad(V(r.x0, H, r.z1), V(r.x1, H, r.z1), V(r.x1, H, r.z0), V(r.x0, H, r.z0), [[0, 0], [1, 0], [1, 1], [0, 1]], new THREE.Color('#3a393b'));
      const pc = tint.clone().multiplyScalar(0.55);
      B.trim.boxMinMax(r.x0, H, r.z0, r.x1, H + 0.9, r.z0 + 0.3, { color: pc });
      B.trim.boxMinMax(r.x0, H, r.z1 - 0.3, r.x1, H + 0.9, r.z1, { color: pc });
      B.trim.boxMinMax(r.x0, H, r.z0 + 0.3, r.x0 + 0.3, H + 0.9, r.z1 - 0.3, { color: pc });
      B.trim.boxMinMax(r.x1 - 0.3, H, r.z0 + 0.3, r.x1, H + 0.9, r.z1 - 0.3, { color: pc });
      // PASS 6c, visual only (position hash, the seeded stream is untouched):
      // a projecting cornice or coping band at the roof line, a string course over
      // the shops on brick/stucco, and a set-back penthouse on the taller blocks
      const vh = h01(r.x0 * 0.31 + r.z1, r.z0 * 0.27 - r.x1);
      const band = (y0, y1, o, c) => B.trim.boxMinMax(r.x0 - o, y0, r.z0 - o, r.x1 + o, y1, r.z1 + o, { color: c });
      if (style === 1 || style === 3 || vh < 0.4) band(H - 0.45, H - 0.05, 0.35, tint.clone().multiplyScalar(style === 1 ? 0.95 : 0.8));
      band(H + 0.9, H + 1.0, 0.06, style === 0 ? new THREE.Color('#8a929a') : tint.clone().multiplyScalar(0.85));
      if (style === 1 || style === 3) band(4.6, 4.85, 0.12, tint.clone().multiplyScalar(0.7));
      if (floors >= 9 && vh > 0.45 && r.x1 - r.x0 > 14 && r.z1 - r.z0 > 14) {
        const sx = (r.x1 - r.x0) * (0.35 + vh * 0.2), sz = (r.z1 - r.z0) * (0.35 + h01(vh, cx) * 0.2);
        const px = (r.x0 + r.x1) / 2 + (vh - 0.7) * 4, pz = (r.z0 + r.z1) / 2;
        B.trim.box(px, H + 2.2, pz, sx, 4.4, sz, { color: tint.clone().multiplyScalar(0.45), ao: 0.3, aoBase: H });
        B.trim.box(px, H + 4.5, pz, sx + 0.3, 0.2, sz + 0.3, { color: tint.clone().multiplyScalar(0.7) });
      }
      if (floors >= 16) {
        const bx = (r.x0 + r.x1) / 2, bz = (r.z0 + r.z1) / 2;
        B.glow.box(bx, H + 0.6, bz, 0.4, 0.4, 0.4, { color: new THREE.Color(2, 0.1, 0.08) });
        lm.glow(bx, H + 0.7, bz, [9, 0.5, 0.3], 3.2, { blink: 0.5 + 0.2 * h01(bx, bz), phase: h01(bz, bx), pull: 0.6 });
      }
      // classic timber water tank on stilts (mid-rise), or a lattice antenna mast with a beacon (towers)
      const rx = (r.x0 + r.x1) / 2 + roof.float(-3, 3), rz = (r.z0 + r.z1) / 2 + roof.float(-3, 3);
      const roll = roof.next();
      if (floors >= 4 && floors <= 11 && roll < 0.28 && r.x1 - r.x0 > 9 && r.z1 - r.z0 > 9) {
        for (const [ox, oz] of [[-1.1, -1.1], [1.1, -1.1], [1.1, 1.1], [-1.1, 1.1]]) B.trim.box(rx + ox, H + 1.5, rz + oz, 0.18, 3, 0.18, { color: dark });
        B.trim.box(rx, H + 3.05, rz, 2.8, 0.15, 2.8, { color: dark });
        B.trim.addGeometry(_cyl, mat4(rx, H + 4.6, rz, 0, 1.45, 3.0, 1.45), { color: wood });
        B.trim.addGeometry(new THREE.ConeGeometry(1.6, 1.1, 10), mat4(rx, H + 6.65, rz), { color: dark });
      } else if (floors >= 12 && roll < 0.55) {
        const mh = roof.float(10, 26);
        B.trim.addGeometry(_cyl, mat4(rx, H + mh / 2, rz, 0, 0.18, mh, 0.18), { color: steel });
        for (let y = 3; y < mh - 2; y += 4) B.trim.box(rx, H + y, rz, 1.2 - y / mh * 0.8, 0.08, 0.08, { color: steel });
        lm.glow(rx, H + mh + 0.3, rz, [10, 0.55, 0.32], 2.6, { blink: 0.5 + 0.2 * h01(rx, rz), phase: h01(rz, rx), pull: 0.6 });
      }
      colliders.add(r.x0, 0, r.z0, r.x1, H, r.z1, 'building');
      count++;
    }
  }
  return { count };
}
