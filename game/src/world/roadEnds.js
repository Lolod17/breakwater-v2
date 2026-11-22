// PASS 17c: road closures where the district's streets leave the playable area. Every street (and the
// waterfront promenade) is drawn on past CITY.bounds into the skyline ring, so the bound used to stop
// people and cars on open road with nothing there. Now each exit ends at a drawn barrier line, building
// face to building face (or to the quay rail): concrete jersey blocks across road and pavements, a
// red-and-white plank barricade on posts over the carriageway and amber blinkers on top. The collider is
// the barrier itself, its outer face on the bound, so the stop is always against something drawn.
import * as THREE from '../../vendor/three.min.js';
import { CITY } from '../config.js';

const S = CITY.streets;
const R = CITY.roadHalf;
const P = CITY.paveWidth;
export const BARRIER_DEPTH = 0.7;
const TOP = 1.45;               // collider top: drawn blinkers; above a standing jump (0.77 m apex)

// One record per exit: the bound line (axis 'x' = a line of constant x), the span across the street
// from building line to building line, and the inward normal (towards the district).
export function roadEnds() {
  const b = CITY.bounds, last = S[S.length - 1];
  const ends = [];
  for (const c of S) {
    const a0 = c - R - P, a1 = c === last ? CITY.quayZ - 0.4 : c + R + P;   // waterfront: on to the quay rail
    ends.push({ axis: 'x', at: b.x0, inward: 1, a0, a1, c });
    ends.push({ axis: 'x', at: b.x1, inward: -1, a0, a1, c });
    ends.push({ axis: 'z', at: b.z0, inward: 1, a0: c - R - P, a1: c + R + P, c });
  }
  return ends;
}

export function buildRoadEnds(B, colliders, lm) {
  const concrete = [new THREE.Color('#b4afa5'), new THREE.Color('#a9a49a')];
  const red = new THREE.Color('#c33a2e'), white = new THREE.Color('#ece8df'), post = new THREE.Color('#3a3c40');
  const amber = new THREE.Color(2.4, 1.2, 0.12);
  let count = 0;
  for (const e of roadEnds()) {
    // local (u along the span, w inward from the bound) -> world box
    const box = (b, u0, u1, w0, w1, y0, y1, color) => {
      const p0 = e.at + e.inward * w0, p1 = e.at + e.inward * w1;
      const [x0, x1, z0, z1] = e.axis === 'x' ? [Math.min(p0, p1), Math.max(p0, p1), u0, u1] : [u0, u1, Math.min(p0, p1), Math.max(p0, p1)];
      b.boxMinMax(x0, y0, z0, x1, y1, z1, { color });
    };
    const D = BARRIER_DEPTH;
    // jersey blocks, kerb to kerb and over both pavements
    const len = e.a1 - e.a0, n = Math.max(1, Math.round(len / 2.4)), bl = len / n;
    for (let i = 0; i < n; i++) {
      // butted end to end (no gaps to see through); the joints read from the alternating tone and the caps
      const u0 = e.a0 + i * bl, u1 = e.a0 + (i + 1) * bl;
      const c = concrete[i & 1];
      box(B.trim, u0, u1, 0, D, 0, 0.32, c);
      box(B.trim, u0, u1, 0.18, D - 0.18, 0.32, 0.82, c);
      box(B.trim, u0 + (i ? 0.05 : 0), u1 - (i < n - 1 ? 0.05 : 0), 0.15, D - 0.15, 0.82, 0.88, c.clone().multiplyScalar(0.92));
    }
    // plank barricade over the carriageway: posts every 3 m, a striped board, blinkers on the posts
    const r0 = e.c - R, r1 = e.c + R;
    for (let u = r0 + 0.5; u <= r1 - 0.4; u += 2.75) {
      box(B.trim, u - 0.05, u + 0.05, D / 2 - 0.05, D / 2 + 0.05, 0.88, 1.36, post);
      box(B.glow, u - 0.08, u + 0.08, D / 2 - 0.08, D / 2 + 0.08, 1.36, 1.45, amber);
      const wx = e.axis === 'x' ? e.at + e.inward * D / 2 : u, wz = e.axis === 'x' ? u : e.at + e.inward * D / 2;
      lm.glow(wx, 1.42, wz, [6, 3, 0.3], 0.55, { blink: 0.5, phase: (u * 0.37 + e.at * 0.11) % 1, pull: 0.3 });
    }
    const stripes = Math.round((r1 - r0) / 0.6);
    for (let i = 0; i < stripes; i++) {
      const u0 = r0 + ((r1 - r0) * i) / stripes, u1 = r0 + ((r1 - r0) * (i + 1)) / stripes;
      box(B.trim, u0, u1, D / 2 - 0.1, D / 2 - 0.05, 1.04, 1.28, i & 1 ? white : red);
      box(B.trim, u0, u1, D / 2 + 0.05, D / 2 + 0.1, 1.04, 1.28, i & 1 ? red : white);
    }
    // the stop is the barrier
    const p0 = e.at, p1 = e.at + e.inward * D;
    if (e.axis === 'x') colliders.add(Math.min(p0, p1), 0, e.a0, Math.max(p0, p1), TOP, e.a1, 'barrier');
    else colliders.add(e.a0, 0, Math.min(p0, p1), e.a1, TOP, Math.max(p0, p1), 'barrier');
    count++;
  }
  return { count };
}

// True if (x, z) is within m metres of a barrier line (props keep clear of it).
export function nearRoadEnd(x, z, m = 1.2) {
  return roadEnds().some((e) => {
    const [p, u] = e.axis === 'x' ? [x, z] : [z, x];
    const w = (p - e.at) * e.inward;
    return w > -m && w < BARRIER_DEPTH + m && u > e.a0 - m && u < e.a1 + m;
  });
}
