// The downtown street grid: block rectangles, building lots, intersections and
// the walkable ground height (road at 0, raised pavement slabs at kerb height).
import { CITY } from '../config.js';

const S = CITY.streets;
const R = CITY.roadHalf;
const P = CITY.paveWidth;
export const JETTY_IN = 0.15;   // jetty railing face, inset from the deck edge

export function buildLayout() {
  const last = S[S.length - 1];
  const blocks = [];
  for (let i = 0; i < S.length - 1; i++) {
    for (let j = 0; j < S.length - 1; j++) {
      const slab = { x0: S[i] + R, x1: S[i + 1] - R, z0: S[j] + R, z1: S[j + 1] - R };
      const lot = { x0: slab.x0 + P, x1: slab.x1 - P, z0: slab.z0 + P, z1: slab.z1 - P };
      blocks.push({ i, j, slab, lot, cx: (slab.x0 + slab.x1) / 2, cz: (slab.z0 + slab.z1) / 2 });
    }
  }
  const intersections = [];
  for (const x of S) for (const z of S) intersections.push({ x, z });

  // Street segments between intersections; axis 'x' runs along x at fixed z.
  const segments = [];
  for (let k = 0; k < S.length; k++) {
    for (let i = 0; i < S.length - 1; i++) {
      segments.push({ axis: 'x', c: S[k], a: S[i] + R + P, b: S[i + 1] - R - P, from: S[i], to: S[i + 1] });
      segments.push({ axis: 'z', c: S[k], a: S[i] + R + P, b: S[i + 1] - R - P, from: S[i], to: S[i + 1] });
    }
  }

  // Outer ring of skyline blocks (visible, not yet playable) on an extended grid.
  const SX = [-520, -440, -360, -280, ...S, 280, 360, 440, 520];
  const outerBlocks = [];
  const outerSegments = [];
  for (let i = 0; i < SX.length - 1; i++) {
    for (let j = 0; j < SX.length - 1; j++) {
      if (SX[j + 1] > last) continue; // nothing south of the waterfront street
      const inMain = SX[i] >= S[0] && SX[i + 1] <= last && SX[j] >= S[0];
      if (inMain) continue;
      const slab = { x0: SX[i] + R, x1: SX[i + 1] - R, z0: SX[j] + R, z1: SX[j + 1] - R };
      outerBlocks.push({ slab, lot: { x0: slab.x0 + P, x1: slab.x1 - P, z0: slab.z0 + P, z1: slab.z1 - P } });
    }
  }
  for (const c of SX) {
    for (let i = 0; i < SX.length - 1; i++) {
      const isMainX = c >= S[0] && c <= last && SX[i] >= S[0] && SX[i + 1] <= last;
      if (!isMainX && c <= last) outerSegments.push({ axis: 'x', c, from: SX[i], to: SX[i + 1] });
      const isMainZ = c >= S[0] && c <= last && SX[i] >= S[0] && SX[i + 1] <= last;
      if (!isMainZ && SX[i + 1] <= last) outerSegments.push({ axis: 'z', c, from: SX[i], to: SX[i + 1] });
    }
  }

  // Waterfront promenade: from the south kerb of the last street to the quay.
    const promenade = { x0: -640, x1: 236, z0: last + R, z1: CITY.quayZ };

  const slabs = blocks.map((b) => b.slab).concat([promenade], outerBlocks.map((b) => b.slab));
  // A timber jetty out into the harbour, walkable.
  const pier = { x0: -66, x1: -54, z0: CITY.quayZ - 0.5, z1: CITY.quayZ + 70 };
  slabs.push(pier);

  function groundHeight(x, z) {
    for (const s of slabs) {
      if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return CITY.kerbH;
    }
    return 0;
  }

  function walkable(x, z) {
    const b = CITY.bounds;
    if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return true;
    // PASS 17c: up to the drawn jetty railings (at x0 + 0.1, x1 - 0.1, z1 - 0.08), not 0.6 m short of them
    return x >= pier.x0 + JETTY_IN && x <= pier.x1 - JETTY_IN && z >= pier.z0 && z <= pier.z1 - JETTY_IN;
  }

  return { blocks, intersections, segments, outerBlocks, outerSegments, promenade, pier, slabs, groundHeight, walkable };
}
