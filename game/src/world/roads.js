// Road surface details: raised pavement slabs with granite kerbs, and the paint
// layer (lane dashes, double centre line, stop lines, zebra crossings, manholes).
import * as THREE from '../../vendor/three.min.js';
import { CITY } from '../config.js';

const K = CITY.kerbH;
const R = CITY.roadHalf;
const KERB_W = 0.28;
const PAINT_Y = 0.012;
const WHITE = new THREE.Color('#cfcfc6');
const YELLOW = new THREE.Color('#d9a62c');
const IRON = new THREE.Color('#1c1c1f');
const _circle = new THREE.CircleGeometry(0.42, 14).rotateX(-Math.PI / 2);

function topQuad(b, x0, z0, x1, z1, y, color, uvScale = 0) {
  const uv = uvScale ? [[x0 / uvScale, z1 / uvScale], [x1 / uvScale, z1 / uvScale], [x1 / uvScale, z0 / uvScale], [x0 / uvScale, z0 / uvScale]]
    : [[0, 0], [1, 0], [1, 1], [0, 1]];
  b.quad(new THREE.Vector3(x0, y, z1), new THREE.Vector3(x1, y, z1), new THREE.Vector3(x1, y, z0), new THREE.Vector3(x0, y, z0), uv, color);
}

export function buildSlab(B, s, lm, { north = true, south = true, east = true, west = true } = {}) {
  const tone = new THREE.Color('#ffffff');
  topQuad(B.paving, s.x0 + (west ? KERB_W : 0), s.z0 + (north ? KERB_W : 0), s.x1 - (east ? KERB_W : 0), s.z1 - (south ? KERB_W : 0), K, tone, 8);
  const kc = new THREE.Color('#8d8b86');
  const h = K + 0.012;
  const o = { color: kc, worldUV: 1.2, ao: 0.25 };
  if (north) B.kerb.boxMinMax(s.x0, 0, s.z0, s.x1, h, s.z0 + KERB_W, o);
  if (south) B.kerb.boxMinMax(s.x0, 0, s.z1 - KERB_W, s.x1, h, s.z1, o);
  if (west) B.kerb.boxMinMax(s.x0, 0, s.z0 + (north ? KERB_W : 0), s.x0 + KERB_W, h, s.z1 - (south ? KERB_W : 0), o);
  if (east) B.kerb.boxMinMax(s.x1 - KERB_W, 0, s.z0 + (north ? KERB_W : 0), s.x1, h, s.z1 - (south ? KERB_W : 0), o);
  // gutter darkening on the road side of each kerb
  if (lm) {
    if (north) lm.shadowStrip(s.x0, s.z0, s.x1, s.z0, 0, -1, 0.7, 0.4);
    if (south) lm.shadowStrip(s.x0, s.z1, s.x1, s.z1, 0, 1, 0.7, 0.4);
    if (west) lm.shadowStrip(s.x0, s.z0, s.x0, s.z1, -1, 0, 0.7, 0.4);
    if (east) lm.shadowStrip(s.x1, s.z0, s.x1, s.z1, 1, 0, 0.7, 0.4);
  }
}

// Paint for one street segment between two intersections.
function paintSegment(b, seg, rng) {
  const s0 = seg.from + R, s1 = seg.to - R;
  const P = (a, c) => (seg.axis === 'x' ? [a, seg.c + c] : [seg.c + c, a]);
  const rect = (a0, a1, c0, c1, color) => {
    const [x0, z0] = P(Math.min(a0, a1), Math.min(c0, c1));
    const [x1, z1] = P(Math.max(a0, a1), Math.max(c0, c1));
    topQuad(b, Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), PAINT_Y, color);
  };
  // zebra crossings at both ends
  for (const [a0, a1] of [[s0 + 1, s0 + 4], [s1 - 4, s1 - 1]]) {
    for (let c = -5.3; c < 5.4; c += 1.0) rect(a0, a1, c, c + 0.5, WHITE);
  }
  // stop lines on the inbound half at each end (traffic keeps right)
  const toSide = seg.axis === 'x' ? 1 : -1;
  rect(s1 - 5.0, s1 - 4.6, toSide * 0.3, toSide * 5.8, WHITE);
  rect(s0 + 4.6, s0 + 5.0, -toSide * 0.3, -toSide * 5.8, WHITE);
  // double centre line
  for (const c of [-0.24, 0.12]) rect(s0 + 5.2, s1 - 5.2, c, c + 0.12, YELLOW);
  // lane dashes
  for (const c of [-3.05, 2.95]) {
    for (let a = s0 + 7; a + 3 < s1 - 7; a += 8) rect(a, a + 3, c, c + 0.1, WHITE);
  }
  // manholes
  const n = rng.int(1, 2);
  for (let i = 0; i < n; i++) {
    const [x, z] = P(rng.float(s0 + 10, s1 - 10), rng.sign() * rng.float(1.2, 4.5));
    b.addGeometry(_circle, new THREE.Matrix4().makeTranslation(x, PAINT_Y - 0.002, z), { color: IRON });
  }
}

export function buildRoads(layout, rng, B, lm) {
  for (const block of layout.blocks) buildSlab(B, block.slab, lm);
  for (const block of layout.outerBlocks) buildSlab(B, block.slab, null);
  buildSlab(B, layout.promenade, lm, { south: false });
  for (const seg of layout.segments) paintSegment(B.markings, seg, rng);
  for (const seg of layout.outerSegments) paintSegment(B.markings, seg, rng);
}
