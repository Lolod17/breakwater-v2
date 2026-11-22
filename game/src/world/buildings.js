// Downtown buildings: each block lot is split into cells; each cell becomes a
// building with a recessed ground-floor shopfront (arcade with columns, or flush
// with awnings), neon fascia signs, a windowed upper body (optionally podium +
// tower), string course, cornice, parapet, roof plant, billboards, blade signs
// and fire escapes. Everything is emitted into shared GeoBuilders by material.
import * as THREE from '../../vendor/three.min.js';
import { CITY, NEON } from '../config.js';
import { FACADE_BAYS, SHOP_VARIANTS, BILLBOARD_COUNT } from './textures.js';
import { mat4, GeoBuilder } from './geobuilder.js';

const GROUND_H = 4.6;
const FLOOR_H = 3.4;
const BAY_W = 3.2;
const SHOP_BAY = 4.5;
const FASCIA = 0.9;
const K = CITY.kerbH;

const STYLE_TINTS = [
  ['#d0dde8', '#c8e0e0', '#e0d8d0', '#b8c8d8'],
  ['#ffffff', '#e8d8d0', '#f0e0c8', '#c8b8b0'],
  ['#ffffff', '#e8e4dc', '#d8dce0', '#f0e6d8'],
  ['#f2b8a0', '#a8d8c8', '#f0dca0', '#a8c8e0', '#e89a8a', '#f4efe6', '#d8b8d8'],
];
const STYLE_BODY = ['#3c4650', '#6e3428', '#8f8d88', null];
const AWNING_COLS = ['#ff6f61', '#1f8a80', '#2f5d3a', '#24345a', '#7a2433', '#e0a030'];
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const col = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);

const _cyl = new THREE.CylinderGeometry(1, 1, 1, 12, 1);
// position hash for purely visual variation (never draws from the seeded RNG,
// so adding visuals cannot change the generated city)
export const phash = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };

// The four sides of a rect with outward normals; p0->p1 runs so the normal is on the right.
function sidesOf(r) {
  return {
    S: { key: 'S', nx: 0, nz: 1, p0: [r.x0, r.z1], p1: [r.x1, r.z1], len: r.x1 - r.x0 },
    N: { key: 'N', nx: 0, nz: -1, p0: [r.x1, r.z0], p1: [r.x0, r.z0], len: r.x1 - r.x0 },
    E: { key: 'E', nx: 1, nz: 0, p0: [r.x1, r.z1], p1: [r.x1, r.z0], len: r.z1 - r.z0 },
    W: { key: 'W', nx: -1, nz: 0, p0: [r.x0, r.z0], p1: [r.x0, r.z1], len: r.z1 - r.z0 },
  };
}
// Which sides meet at a side's start and end (to detect corners).
const NEIGHBOURS = { S: ['W', 'E'], E: ['S', 'N'], N: ['E', 'W'], W: ['N', 'S'] };

function inset(r, d) {
  return { x0: r.x0 + (d.W || 0), x1: r.x1 - (d.E || 0), z0: r.z0 + (d.N || 0), z1: r.z1 - (d.S || 0) };
}

// Vertical wall quad along a side, from y0 to y1, with UV rect [u0,v0,u1,v1].
function wall(b, s, y0, y1, uv, color) {
  const [x0, z0] = s.p0, [x1, z1] = s.p1;
  b.quad(V(x0, y0, z0), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z0),
    [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]], color);
}
function hquad(b, r, y, up, color) {
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
  if (up) b.quad(V(r.x0, y, r.z1), V(r.x1, y, r.z1), V(r.x1, y, r.z0), V(r.x0, y, r.z0), uv, color);
  else b.quad(V(r.x0, y, r.z0), V(r.x1, y, r.z0), V(r.x1, y, r.z1), V(r.x0, y, r.z1), uv, color);
}
// A point along a side at distance a from p0, pushed out by o along the normal.
function along(s, a, o = 0) {
  const tx = s.nz, tz = -s.nx;
  return [s.p0[0] + tx * a + s.nx * o, s.p0[1] + tz * a + s.nz * o];
}

function subdivide(lot, rng) {
  const w = lot.x1 - lot.x0;
  const xs = [lot.x0, lot.x0 + w * rng.float(0.38, 0.62), lot.x1];
  const cells = [];
  for (let c = 0; c < 2; c++) {
    const n = rng.int(2, 3);
    const h = lot.z1 - lot.z0;
    const zs = [lot.z0];
    for (let k = 1; k < n; k++) zs.push(lot.z0 + (h * k) / n + rng.float(-3, 3));
    zs.push(lot.z1);
    for (let k = 0; k < n; k++) cells.push({ x0: xs[c], x1: xs[c + 1], z0: zs[k], z1: zs[k + 1], col: c, row: k, rows: n });
  }
  return cells;
}

export function buildDowntown(layout, rng, B, colliders, lm) {
  const plazas = [];
  const stats = { buildings: 0, signs: 0, awnings: 0, billboards: 0, variants: {} };
  for (const block of layout.blocks) {
    const br = rng.fork(`block-${block.i}-${block.j}`);
    const cells = subdivide(block.lot, br);
    // one optional plaza per block, never a corner cell
    const interior = cells.filter((c) => c.rows === 3 && c.row === 1);
    if (interior.length && br.chance(0.35)) br.pick(interior).plaza = true;
    const core = 1 - Math.min(1, Math.hypot(block.cx, block.cz + 40) / 250);
    const waterfront = block.j === CITY.streets.length - 2;
    for (const cell of cells) {
      if (cell.plaza) { plazas.push(cell); continue; }
      const exposed = new Set();
      const lot = block.lot;
      if (Math.abs(cell.x0 - lot.x0) < 0.01) exposed.add('W');
      if (Math.abs(cell.x1 - lot.x1) < 0.01) exposed.add('E');
      if (Math.abs(cell.z0 - lot.z0) < 0.01) exposed.add('N');
      if (Math.abs(cell.z1 - lot.z1) < 0.01) exposed.add('S');
      // PASS 17c: a plaza beside the cell in the other column only covers part of that side, so the side
      // stays a party wall (no shopfront recess), but its ground floor must be drawn where the plaza
      // sees it: the solid collider runs to the cell edge and there was no wall under the upper body.
      const plazaWalls = [];
      for (const o of cells) {
        if (!o.plaza || o === cell) continue;
        if (Math.abs(o.z0 - cell.z1) < 0.01 && o.x0 < cell.x1 && o.x1 > cell.x0) exposed.add('S');
        if (Math.abs(o.z1 - cell.z0) < 0.01 && o.x0 < cell.x1 && o.x1 > cell.x0) exposed.add('N');
        const za = Math.max(o.z0, cell.z0), zb = Math.min(o.z1, cell.z1);
        if (zb - za > 0.01 && Math.abs(o.x0 - cell.x1) < 0.01) plazaWalls.push({ key: 'E', nx: 1, nz: 0, p0: [cell.x1, zb], p1: [cell.x1, za], len: zb - za });
        if (zb - za > 0.01 && Math.abs(o.x1 - cell.x0) < 0.01) plazaWalls.push({ key: 'W', nx: -1, nz: 0, p0: [cell.x0, za], p1: [cell.x0, zb], len: zb - za });
      }
      building(cell, exposed, br, core, waterfront, B, colliders, stats, lm, plazaWalls);
      stats.buildings++;
    }
  }
  return { plazas, stats };
}

function building(r, exposed, rng, core, waterfront, B, colliders, stats, lm, plazaWalls = []) {
  // ---- programme
  let floors = rng.int(3, 6) + Math.round(Math.pow(core, 1.5) * rng.float(0, 24));
  if (core > 0.45 && rng.chance(0.3)) floors = rng.int(18, 32);
  if (waterfront) floors = Math.min(floors, rng.int(4, 8));
  const style = floors >= 14 ? rng.weighted([[0, 0.55], [2, 0.45]])
    : floors >= 7 ? rng.weighted([[2, 0.35], [1, 0.35], [0, 0.3]])
      : waterfront ? rng.weighted([[3, 0.7], [1, 0.3]])
        : rng.weighted([[1, 0.45], [3, 0.4], [2, 0.15]]);
  const tint = col(rng.pick(STYLE_TINTS[style]));
  // PASS 6c: visual-only variation from a position hash, so the seeded RNG (and
  // with it the city layout, colliders and missions) is untouched.
  const vh = phash(r.x0 * 0.731 + r.z1 * 0.117, r.z0 * 0.413 - r.x1 * 0.291);
  const variant = vh < 0.5 ? 0 : 1;
  const district = waterfront ? 'waterfront' : core > 0.45 ? 'core' : 'midtown';
  const vs = stats.variants[district] || (stats.variants[district] = {});
  vs[`${style}${'ab'[variant]}`] = (vs[`${style}${'ab'[variant]}`] || 0) + 1;
  tint.offsetHSL((phash(r.z0, r.x0) - 0.5) * 0.03, (phash(r.x1, r.z0) - 0.5) * 0.12, (phash(r.z1, r.x1) - 0.5) * 0.1);
  const bodyCol = STYLE_BODY[style] ? col(STYLE_BODY[style]) : tint.clone().multiply(col('#e9e2d6')).multiplyScalar(0.92);
  const H = GROUND_H + (floors - 1) * FLOOR_H;
  const arcade = style !== 3 && rng.chance(0.4);
  const recess = arcade ? 1.6 : 0.35;
  const shopVariant = rng.weighted([[0, 0.36], [1, 0.24], [2, 0.12], [3, 0.28]]);
  const uOff = rng.int(0, FACADE_BAYS - 1), vOff = rng.int(0, FACADE_BAYS - 1);
  const facadeB = B.facade[style];
  const sides = sidesOf(r);
  const ins = {};
  for (const k of exposed) ins[k] = recess;
  const g = inset(r, ins);
  const gs = sidesOf(g);

  // podium + tower
  let tower = null, podiumTop = H;
  if (floors >= 14 && rng.chance(0.65)) {
    const pf = rng.int(2, 4);
    const t = {};
    for (const k of exposed) t[k] = rng.float(3, 5);
    const tr = inset(r, t);
    if (tr.x1 - tr.x0 >= 10 && tr.z1 - tr.z0 >= 10) { tower = tr; podiumTop = GROUND_H + pf * FLOOR_H; }
  }

  const facadeWalls = (rect, y0, y1, onlyExposed) => {
    const ss = sidesOf(rect);
    for (const k of ['N', 'E', 'S', 'W']) {
      const s = ss[k];
      if (onlyExposed && !exposed.has(k)) { wall(B.trim, s, y0, y1, [0, 0, 1, 1], bodyCol); continue; }
      const nb = Math.max(1, Math.round(s.len / BAY_W));
      const v0 = (vOff + (y0 - GROUND_H) / FLOOR_H) / FACADE_BAYS;
      const v1 = (vOff + (y1 - GROUND_H) / FLOOR_H) / FACADE_BAYS;
      wall(facadeB, s, y0, y1, [uOff / FACADE_BAYS, v0, (uOff + nb) / FACADE_BAYS, v1], tint);
    }
  };

  // ---- upper body
  facadeWalls(r, GROUND_H, podiumTop, true);
  if (tower) facadeWalls(tower, podiumTop, H, false);
  if (B.kit) {
    const ssR = sidesOf(r);
    for (const k of exposed) facadeDetail(B.kit, ssR[k], GROUND_H, podiumTop, style, bodyCol, variant, exposed);
    if (tower) { const ssT = sidesOf(tower); for (const k of ['N', 'E', 'S', 'W']) facadeDetail(B.kit, ssT[k], podiumTop, H, style, bodyCol, variant, null); }
  }
  const roofCol = col('#3a393b');
  hquad(B.trim, r, podiumTop, true, roofCol);
  if (tower) hquad(B.trim, tower, H, true, roofCol);

  // ---- ground floor
  const fasciaCol = col('#24211f');
  const colCol = bodyCol.clone().multiplyScalar(0.85);
  for (const k of exposed) {
    const s = gs[k];
    const nb = Math.max(1, Math.round(s.len / SHOP_BAY));
    const vv0 = 1 - (shopVariant + 1) / SHOP_VARIANTS, vv1 = 1 - shopVariant / SHOP_VARIANTS;
    wall(B.shop, s, K, GROUND_H - FASCIA, [0, vv0 + 0.002, nb, vv1 - 0.002], col('#ffffff'));
    if (B.kit) shopFrame(B.kit, s, nb, shopVariant);
    wall(B.trim, s, GROUND_H - FASCIA, GROUND_H, [0, 0, 1, 1], fasciaCol);
    const os = sides[k];
    // baked light: shop window spill onto the pavement, contact darkening at the base
    if (shopVariant !== 2) {
      lm.spill(s.p0[0], s.p0[1], s.p1[0], s.p1[1], s.nx, s.nz, recess + 3.2,
        shopVariant === 1 ? [190, 220, 255] : [255, 185, 115], shopVariant === 1 ? 0.3 : 0.24);
      const sc = shopVariant === 1 ? [1.6, 1.9, 2.3] : [2.4, 1.6, 0.9];
      for (let bi = 0; bi < nb; bi += 2) {
        const [wx, wz] = along(s, ((bi + 0.5) / nb) * s.len, 0.1);
        lm.source(wx, 2.0, wz, sc, 2.6);
      }
    }
    lm.shadowStrip(os.p0[0], os.p0[1], os.p1[0], os.p1[1], os.nx, os.nz, 1.1, 0.42);
    lm.shadowStrip(s.p0[0], s.p0[1], s.p1[0], s.p1[1], s.nx, s.nz, 0.6, 0.35);
    // soffit over the recess strip (facing down)
    const so = { x0: Math.min(os.p0[0], s.p0[0], os.p1[0], s.p1[0]), x1: Math.max(os.p0[0], s.p0[0], os.p1[0], s.p1[0]),
      z0: Math.min(os.p0[1], s.p0[1], os.p1[1], s.p1[1]), z1: Math.max(os.p0[1], s.p0[1], os.p1[1], s.p1[1]) };
    hquad(B.trim, so, GROUND_H, false, col('#2e2b29'));
    // close the recess where this frontage meets a party wall
    const [startN, endN] = NEIGHBOURS[k];
    for (const [nk, atStart] of [[startN, true], [endN, false]]) {
      if (exposed.has(nk)) continue;
      const p = atStart ? s.p0 : s.p1, q = atStart ? os.p0 : os.p1;
      const face = atStart ? { p0: q, p1: p } : { p0: p, p1: q };
      wall(B.trim, face, K, GROUND_H, [0, 0, 1, 1], colCol);
    }
    // arcade columns along the facade line
    const L = os.len;
    if (arcade) {
      const nCol = Math.max(1, Math.round(L / SHOP_BAY));
      for (let c = 0; c < nCol; c++) {
        if (c === 0 && !exposed.has(startN)) continue; // party end: closed by the end wall
        const aa = c === 0 ? 0.3 : (c / nCol) * L;     // corner column is owned by the side starting there
        const [cx, cz] = along(os, aa, -0.3);
        B.trim.box(cx, (K + GROUND_H) / 2, cz, 0.6, GROUND_H - K, 0.6, { color: colCol, ao: 0.4, aoBase: K });
        colliders.add(cx - 0.3, 0, cz - 0.3, cx + 0.3, GROUND_H, cz + 0.3, 'column');
      }
    }
    // shop signage and awnings, per bay
    // arcade bays are framed by columns on the facade line; flush bays follow the glass
    const bays = arcade ? Math.max(1, Math.round(L / SHOP_BAY)) : nb;
    const shift = arcade && exposed.has(startN) ? recess : 0;
    for (let bi = 0; bi < bays; bi++) {
      const a = arcade ? ((bi + 0.5) / bays) * L - shift : ((bi + 0.5) / nb) * s.len;
      if (a < 1 || a > s.len - 1) continue;
      const roll = rng.next();
      if (!arcade && roll < 0.45) {
        awning(B.awning, s, a, (s.len / nb) - 0.5, rng.pick(AWNING_COLS));
        stats.awnings++;
      } else if (roll < 0.85) {
        const sign = neonSign(B, s, a, Math.min(3.8, (arcade ? L / bays - 1.0 : s.len / nb - 0.4)), rng);
        const hex = sign.hex;
        const c = new THREE.Color(hex);
        const [px, pz] = along(s, a, 1.6);
        // halo hugging the sign (wide, flat), and a broad source for the wet road
        const [gx, gz] = along(s, a, 0.35);
        lm.glow(gx, sign.y, gz, [c.r * 1.3, c.g * 1.3, c.b * 1.3], sign.h * 2.4, { pull: 0.6, stretch: Math.min(3.2, sign.w / sign.h * 0.55) });
        lm.source(gx, sign.y, gz, [c.r * 4.5, c.g * 4.5, c.b * 4.5], 1 + sign.w * 0.6);
        lm.pool(px, pz, 4.2, [c.r * 255 | 0, c.g * 255 | 0, c.b * 255 | 0].map((v) => Math.min(255, v + 40)), 0.28, 1, 1);
        stats.signs++;
      }
    }
    // string course above the shopfront (N/S extend over corners, E/W stop short)
    const ext = (k === 'N' || k === 'S') ? 0.18 : 0;
    const [ax, az] = along(os, -ext, 0.09), [bx, bz] = along(os, L + ext, 0.09);
    B.trim.boxMinMax(Math.min(ax, bx) - (os.nx ? 0.09 : 0), GROUND_H - 0.05, Math.min(az, bz) - (os.nz ? 0.09 : 0),
      Math.max(ax, bx) + (os.nx ? 0.09 : 0), GROUND_H + 0.3, Math.max(az, bz) + (os.nz ? 0.09 : 0), { color: colCol });
    if (style === 1 || style === 3) {
      B.trim.boxMinMax(Math.min(ax, bx) - (os.nx ? 0.12 : 0), podiumTop - 0.55, Math.min(az, bz) - (os.nz ? 0.12 : 0),
        Math.max(ax, bx) + (os.nx ? 0.12 : 0), podiumTop - 0.1, Math.max(az, bz) + (os.nz ? 0.12 : 0), { color: colCol });
    }
  }

  // ---- billboard first so roof plant keeps clear of its posts
  const top = tower || r;
  const ex = [...exposed].map((k) => sides[k]).filter((s) => s.len >= 14);
  const reserved = [];
  if (!tower && floors <= 8 && ex.length && rng.chance(0.4)) {
    const s = ex[0];
    const [ax, az] = along(s, 0, 0), [bx, bz] = along(s, s.len, -3);
    reserved.push([Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)]);
    billboard(B, s, H, rng, lm);
    stats.billboards++;
  }
  if (variant === 1 || style === 1) cornice(B.trim, r, podiumTop, exposed, style === 0 ? col('#59646e') : bodyCol.clone().multiply(col('#e8e2d8')).multiplyScalar(style === 1 ? 1.5 : 1.05));
  parapet(B.trim, top, H, bodyCol, style);
  if (tower) parapet(B.trim, r, podiumTop, bodyCol, style);
  roofPlant(B, top, H, rng, style, floors, reserved, lm);
  if (style === 0 && floors >= 16 && rng.chance(0.7)) {
    const c = col(rng.pick(['#3fe0d0', '#ff6f61', '#ffb347']), 3.2);
    for (const s of Object.values(sidesOf(top))) {
      const [x0, z0] = along(s, 0, 0.04), [x1, z1] = along(s, s.len, 0.04);
      B.glow.quad(V(x0, H - 0.5, z0), V(x1, H - 0.5, z1), V(x1, H - 0.15, z1), V(x0, H - 0.15, z0), [[0, 0], [1, 0], [1, 1], [0, 1]], c);
    }
  }

  // ---- blade signs and fire escapes
  if (floors >= 3 && ex.length && rng.chance(0.45)) bladeSign(B, rng.pick(ex), GROUND_H + 1.2, rng, Math.min(podiumTop, H), lm);
  if (style === 1 && floors >= 4) {
    for (const s of ex) if (s.len >= 16 && rng.chance(0.5)) fireEscape(B.trim, s, floors, Math.min(podiumTop, H));
  }

  // PASS 17c: blank ground-floor party wall where a plaza looks at it (matches the 'building' box below)
  for (const s of plazaWalls) {
    wall(B.trim, s, K, GROUND_H, [0, 0, 1, 1], colCol);
    lm.shadowStrip(s.p0[0], s.p0[1], s.p1[0], s.p1[1], s.nx, s.nz, 0.6, 0.35);
  }

  // ---- collision: walkable recess under the soffit, solid body above
  colliders.add(g.x0, 0, g.z0, g.x1, GROUND_H, g.z1, 'building');
  colliders.add(r.x0, GROUND_H, r.z0, r.x1, podiumTop + 1, r.z1, 'building');
  if (tower) colliders.add(tower.x0, podiumTop, tower.z0, tower.x1, H + 1, tower.z1, 'building');
}

// ---- facade depth (instanced kit) ------------------------------------------
const KIT = {
  stone: col('#cfc6b4'), stucco: col('#efe8dc'), iron: col('#222326'), panel: col('#2b2d31'),
  quoin: col('#f4efe4'), raceway: col('#141316'), ac: col('#b4b7ba'), grille: col('#3a3c40'), fin: col('#3e4852'), frame: col('#26221f'), riser: col('#3b302a'),
};
// Window rows painted by textures.facade(): bottom of the glass above each floor line.
const SILL_Y = [null, 0.74, 0.74, 0.64];
const HEAD_Y = [null, 2.86, null, 2.84]; // top of the painted glass + lintel, above the floor line
const WIN_W = [0, 28 / 64, 0, 20 / 64];   // window width as a fraction of the bay (brick, stucco)

// Variants per style (variant 0 / 1):
//  0 glass: floor caps / vertical fin grid with caps every other floor
//  1 brick: sills, lintels, window AC / paired pilasters, sills and heads
//  2 concrete: ribbon ledges with AC boxes / ledges with deep sun fins
//  3 stucco: balconies / shuttered windows with heads, sills and corner quoins
function facadeDetail(kit, s, y0, y1, style, bodyCol, variant, exposed) {
  const nb = Math.max(1, Math.round(s.len / BAY_W)), bw = s.len / nb;
  const floors = Math.round((y1 - y0) / FLOOR_H);
  const H = y1 - y0;
  const seed = s.p0[0] * 0.37 + s.p0[1] * 0.71;
  if (style === 0) {
    // curtain wall: a slim mullion cap at floor lines (all, or every other with fins)
    for (let f = 1; f < floors; f++) {
      if (variant === 1 && f % 2) continue;
      kit.onSide(s, s.len / 2, 0.06, y0 + f * FLOOR_H - 0.05, s.len, 0.1, 0.12, KIT.fin);
    }
    if (variant === 1) for (let i = 1; i < nb; i++) kit.onSide(s, i * bw, 0.16, y0 + H / 2, 0.12, H, 0.32, KIT.fin);
    return;
  }
  if (style === 2) {
    // ribbon windows: a continuous concrete ledge under every band, the odd AC box on it
    const ledge = bodyCol.clone().multiplyScalar(0.92);
    if (variant === 1) {
      const fin = bodyCol.clone().multiplyScalar(0.8);
      for (let i = 1; i < nb; i++) kit.onSide(s, i * bw, 0.3, y0 + H / 2, 0.16, H, 0.6, fin);
    }
    for (let f = 0; f < floors; f++) {
      const y = y0 + f * FLOOR_H + SILL_Y[2];
      kit.onSide(s, s.len / 2, 0.1, y - 0.05, s.len + 0.1, 0.1, 0.2, ledge);
      for (let i = 0; i < nb; i++) {
        const a = (i + 0.5) * bw;
        if (a < 2.6 || phash(s.p0[0] + a * 7.1, y * 3.3 + s.p0[1]) > (variant ? 0.05 : 0.1)) continue;
        kit.onSide(s, a, 0.38, y + 0.3, 0.8, 0.52, 0.52, KIT.ac);
        kit.onSide(s, a, 0.645, y + 0.3, 0.6, 0.38, 0.012, KIT.grille);
      }
    }
    return;
  }
  const sillY = SILL_Y[style], ww = WIN_W[style] * bw;
  const stone = style === 1 ? KIT.stone : KIT.stucco;
  if (style === 1 && variant === 1) {
    // pilasters on every other bay joint, with a plinth band at the first floor
    const pil = bodyCol.clone().multiplyScalar(0.82);
    for (let i = 0; i <= nb; i += 2) {
      const a = Math.min(s.len - 0.3, Math.max(0.3, i * bw));
      kit.onSide(s, a, 0.12, y0 + H / 2, 0.5, H, 0.24, pil);
    }
    kit.onSide(s, s.len / 2, 0.08, y0 + 0.18, s.len, 0.36, 0.16, KIT.stone);
  }
  if (style === 3 && variant === 1 && exposed) {
    const quoin = bodyCol.clone().lerp(KIT.quoin, 0.45);
    // corner quoins: alternating long/short stones up both ends of an exposed face
    const [startN, endN] = NEIGHBOURS[s.key];
    for (const [nk, a0] of [[startN, 0], [endN, s.len]]) {
      if (!exposed.has(nk)) continue;
      for (let y = y0 + 0.15, k = 0; y < y1 - 0.4; y += 0.62, k++) {
        const w = k % 2 ? 0.55 : 0.85;
        kit.onSide(s, a0 === 0 ? w / 2 : s.len - w / 2, 0.04, y + 0.25, w, 0.5, 0.08, quoin);
      }
    }
  }
  for (let f = 0; f < floors; f++) {
    const yf = y0 + f * FLOOR_H, yb = yf + sillY;
    for (let i = 0; i < nb; i++) {
      const a = (i + 0.5) * bw;
      const h = phash(s.p0[0] * 1.3 + a * 5.7 + f * 0.37, s.p0[1] * 0.7 + yb * 2.1);
      if (style === 3 && variant === 0 && h < 0.32) {
        // balcony: slab, balustrade panel, top rail, side cheeks
        const bwid = Math.min(bw - 0.25, ww + 0.9), dep = 0.85;
        kit.onSide(s, a, dep / 2, yb - 0.08, bwid, 0.12, dep, KIT.stucco);
        kit.onSide(s, a, dep - 0.02, yb + 0.4, bwid, 0.82, 0.03, KIT.panel);
        kit.onSide(s, a, dep - 0.02, yb + 0.86, bwid + 0.04, 0.05, 0.06, KIT.iron);
        for (const e of [-1, 1]) kit.onSide(s, a + e * (bwid / 2 - 0.015), dep / 2, yb + 0.4, 0.03, 0.82, dep, KIT.panel);
        continue;
      }
      kit.onSide(s, a, 0.08, yb - 0.04, ww + 0.22, 0.08, 0.16, stone);
      // projecting head over the window: plain lintel (brick) or a capped hood (stucco B)
      if ((style === 1) || (style === 3 && variant === 1)) {
        const hy = yf + HEAD_Y[style];
        kit.onSide(s, a, 0.07, hy, ww + (style === 3 ? 0.4 : 0.28), style === 3 ? 0.14 : 0.2, 0.14, stone);
        if (style === 3) kit.onSide(s, a, 0.11, hy + 0.1, ww + 0.52, 0.06, 0.22, stone);
      }
      if (h > (style === 1 && variant === 0 ? 0.86 : 0.9) && a > 2.6) {
        // window AC unit hanging under the sill
        kit.onSide(s, a, 0.27, yb - 0.36, Math.min(0.8, ww), 0.48, 0.5, KIT.ac);
        kit.onSide(s, a, 0.525, yb - 0.36, Math.min(0.62, ww - 0.1), 0.34, 0.012, KIT.grille);
      }
    }
  }
}

// Shopfront frame along a recessed glass line: mullions at the bay joints, a
// transom bar and a stall riser at the foot of the glass.
function shopFrame(kit, s, nb, variant) {
  const top = GROUND_H - FASCIA, h = top - K;
  const frame = variant === 2 ? KIT.iron : KIT.frame;
  for (let i = 0; i <= nb; i++) kit.onSide(s, Math.min(s.len - 0.06, Math.max(0.06, (i / nb) * s.len)), 0.05, K + h / 2, 0.12, h, 0.1, frame);
  kit.onSide(s, s.len / 2, 0.04, top - 0.55, s.len, 0.07, 0.08, frame);
  kit.onSide(s, s.len / 2, 0.06, K + 0.22, s.len, 0.44, 0.12, KIT.riser);
}

function parapet(b, r, H, c, style = 1) {
  const t = 0.3, h = 0.9, cc = c.clone().multiplyScalar(0.9);
  b.boxMinMax(r.x0, H, r.z0, r.x1, H + h, r.z0 + t, { color: cc });
  b.boxMinMax(r.x0, H, r.z1 - t, r.x1, H + h, r.z1, { color: cc });
  b.boxMinMax(r.x0, H, r.z0 + t, r.x0 + t, H + h, r.z1 - t, { color: cc });
  b.boxMinMax(r.x1 - t, H, r.z0 + t, r.x1, H + h, r.z1 - t, { color: cc });
  // coping: a lighter cap overhanging both faces (metal on glass towers)
  const k = style === 0 ? col('#8a929a') : style === 1 ? col('#cfc6b4') : c.clone().lerp(col('#f2eee6'), 0.5);
  const o = 0.08, y0 = H + h, y1 = H + h + 0.1;
  b.boxMinMax(r.x0 - o, y0, r.z0 - o, r.x1 + o, y1, r.z0 + t + o, { color: k });
  b.boxMinMax(r.x0 - o, y0, r.z1 - t - o, r.x1 + o, y1, r.z1 + o, { color: k });
  b.boxMinMax(r.x0 - o, y0, r.z0 + t + o, r.x0 + t + o, y1, r.z1 - t - o, { color: k });
  b.boxMinMax(r.x1 - t - o, y0, r.z0 + t + o, r.x1 + o, y1, r.z1 - t - o, { color: k });
}

// Projecting cornice at a roof line along the exposed (street) faces: a deep
// moulded band in two steps.
function cornice(b, r, H, exposed, c) {
  const lo = c.clone().multiplyScalar(0.85);
  for (const k of exposed) {
    const s = sidesOf(r)[k];
    // run past the corner only where the neighbouring face is a street face too
    const [sn, en] = NEIGHBOURS[k];
    const e0 = exposed.has(sn) ? 1 : 0, e1 = exposed.has(en) ? 1 : 0;
    for (const [y0, y1, out, cc] of [[H - 0.55, H - 0.3, 0.22, lo], [H - 0.3, H - 0.02, 0.45, c]]) {
      const [ax, az] = along(s, -out * e0, 0), [bx, bz] = along(s, s.len + out * e1, out);
      b.boxMinMax(Math.min(ax, bx), y0, Math.min(az, bz), Math.max(ax, bx), y1, Math.max(az, bz), { color: cc });
    }
  }
}

function roofPlant(B, r, H, rng, style, floors, reserved, lm) {
  const placed = reserved.slice();
  const fits = (x0, z0, x1, z1) => {
    if (x0 < r.x0 + 1 || x1 > r.x1 - 1 || z0 < r.z0 + 1 || z1 > r.z1 - 1) return false;
    for (const p of placed) if (x0 < p[2] + 0.6 && x1 > p[0] - 0.6 && z0 < p[3] + 0.6 && z1 > p[1] - 0.6) return false;
    placed.push([x0, z0, x1, z1]);
    return true;
  };
  const tryPlace = (w, d, fn) => {
    for (let k = 0; k < 8; k++) {
      const x = rng.float(r.x0, r.x1), z = rng.float(r.z0, r.z1);
      if (fits(x - w / 2, z - d / 2, x + w / 2, z + d / 2)) { fn(x, z); return true; }
    }
    return false;
  };
  const metal = col('#7d8086'), dark = col('#4a4b4f');
  tryPlace(3.2, 3.2, (x, z) => B.trim.box(x, H + 1.4, z, 3.2, 2.8, 3.2, { color: col('#5a5856'), ao: 0.3, aoBase: H }));
  const n = rng.int(1, 4);
  for (let i = 0; i < n; i++) {
    const w = rng.float(1.2, 2.4), d = rng.float(1, 1.8), h = rng.float(0.8, 1.4);
    tryPlace(w, d, (x, z) => {
      B.trim.box(x, H + h / 2, z, w, h, d, { color: metal, ao: 0.35, aoBase: H });
      B.trim.box(x, H + h + 0.06, z, w * 0.6, 0.12, d * 0.6, { color: dark });
    });
  }
  if ((style === 1 || style === 3) && rng.chance(0.55)) {
    tryPlace(3.2, 3.2, (x, z) => {
      for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.trim.box(x + ox, H + 0.8, z + oz, 0.15, 1.6, 0.15, { color: dark });
      B.trim.addGeometry(_cyl, mat4(x, H + 1.6 + 1.3, z, 0, 1.45, 2.6, 1.45), { color: col('#6b5040') });
      B.trim.addGeometry(_cyl, mat4(x, H + 4.1 + 0.2, z, 0, 1.5, 0.4, 1.5), { color: col('#4b3a30') });
    });
  }
  if (floors >= 16) {
    tryPlace(1, 1, (x, z) => {
      const h = rng.float(8, 16);
      B.trim.addGeometry(_cyl, mat4(x, H + h / 2, z, 0, 0.12, h, 0.12), { color: metal });
      B.glow.box(x, H + h + 0.15, z, 0.35, 0.3, 0.35, { color: col('#ff2a20', 1.2) });
      lm.glow(x, H + h + 0.15, z, [9, 0.5, 0.3], 2.2, { blink: 0.45 + 0.25 * phash(x, z), phase: phash(z, x), pull: 0.5 });
    });
  }
}

function neonSign(B, s, a, w, rng) {
  const h = Math.min(0.7, w / 5.33);
  w = h * 5.33;
  const y0 = GROUND_H - FASCIA + (FASCIA - h) / 2;
  const [x0, z0] = along(s, a - w / 2, 0.17), [x1, z1] = along(s, a + w / 2, 0.17);
  // the letters stand on a dark raceway box, so the sign reads as an object
  if (B.kit) {
    B.kit.onSide(s, a, 0.08, y0 + h / 2, w + 0.18, h + 0.14, 0.16, KIT.raceway);
    B.kit.onSide(s, a, 0.165, y0 - 0.02, w + 0.22, 0.03, 0.04, KIT.iron);
  }
  const idx = rng.int(0, B.signAtlas.hRects.length - 1);
  const [u, v, du, dv] = B.signAtlas.hRects[idx];
  const k = rng.float(2.6, 4.2);
  B.neon.quad(V(x0, y0, z0), V(x1, y0, z1), V(x1, y0 + h, z1), V(x0, y0 + h, z0),
    [[u, v], [u + du, v], [u + du, v + dv], [u, v + dv]], col('#ffffff', k));
  return { hex: B.signAtlas.hColors[idx], y: y0 + h / 2, w, h };
}

function bladeSign(B, s, y0, rng, maxY, lm) {
  const h = Math.min(4.6, maxY - y0 - 0.5), w = h / 4.67, depth = 0.25;
  if (h < 2.5) return;
  const a = 1.5;
  const [cx, cz] = along(s, a, 0.25 + w / 2);
  const tx = s.nz, tz = -s.nx;
  // backing box
  const bw = s.nx ? w + 0.1 : depth, bd = s.nz ? w + 0.1 : depth;
  B.trim.box(cx, y0 + h / 2, cz, bw, h + 0.12, bd, { color: col('#1b1a1c') });
  const vi = rng.int(0, B.signAtlas.vRects.length - 1);
  const [u, v, du, dv] = B.signAtlas.vRects[vi];
  const c = col('#ffffff', rng.float(3, 4.5));
  const tint = new THREE.Color(B.signAtlas.vColors ? B.signAtlas.vColors[vi] : '#ff6f61');
  lm.glow(cx, y0 + h / 2, cz, [tint.r * 1.2, tint.g * 1.2, tint.b * 1.2], h * 0.9, { pull: 0.5, stretch: 0.42 });
  lm.source(cx, y0 + h / 2, cz, [tint.r * 3.5, tint.g * 3.5, tint.b * 3.5], 1.2);
  for (const side of [1, -1]) {
    const ox = tx * side * (depth / 2 + 0.01), oz = tz * side * (depth / 2 + 0.01);
    // face spans along the normal direction, outward from the wall
    const ax = cx - s.nx * w / 2 + ox, az = cz - s.nz * w / 2 + oz;
    const bx = cx + s.nx * w / 2 + ox, bz = cz + s.nz * w / 2 + oz;
    const [p, q] = side === 1 ? [[bx, bz], [ax, az]] : [[ax, az], [bx, bz]];
    B.neon.quad(V(p[0], y0, p[1]), V(q[0], y0, q[1]), V(q[0], y0 + h, q[1]), V(p[0], y0 + h, p[1]),
      [[u, v], [u + du, v], [u + du, v + dv], [u, v + dv]], c);
  }
  // bracket arms tying the blade to the wall
  const [bx, bz] = along(s, a, 0.13);
  for (const y of [y0 + 0.25, y0 + h - 0.25]) B.trim.box(bx, y, bz, s.nx ? 0.26 : 0.08, 0.08, s.nz ? 0.26 : 0.08, { color: col('#111') });
}

function awning(b, s, a, w, hex, record = true) {
  if (record) {
    if (!b.prototype) {
      const proto = new GeoBuilder();
      awning(proto, { p0: [0, 0], nx: 0, nz: 1 }, 0, 1, '#ffffff', false);
      b.prototype = proto.build();
      b.instances = [];
    }
    const [x, z] = along(s, a);
    b.instances.push({ x, z, width: w, yaw: Math.atan2(s.nx, s.nz), color: hex });
  }
  const yTop = GROUND_H - FASCIA - 0.02, drop = 0.55, out = 1.6, val = 0.28;
  const c = col(hex), cd = c.clone().multiplyScalar(0.7);
  const P = (aa, o, y) => { const [x, z] = along(s, aa, o); return V(x, y, z); };
  const u0 = 0, u1 = w / 0.8;
  const a0 = a - w / 2, a1 = a + w / 2;
  // sloped canopy, top side and underside
  b.quad(P(a0, out, yTop - drop), P(a1, out, yTop - drop), P(a1, 0.02, yTop), P(a0, 0.02, yTop), [[u0, 0], [u1, 0], [u1, 1], [u0, 1]], c);
  b.quad(P(a1, out, yTop - drop), P(a0, out, yTop - drop), P(a0, 0.02, yTop), P(a1, 0.02, yTop), [[u1, 0], [u0, 0], [u0, 1], [u1, 1]], cd);
  // valance
  b.quad(P(a0, out, yTop - drop - val), P(a1, out, yTop - drop - val), P(a1, out, yTop - drop), P(a0, out, yTop - drop), [[u0, 0], [u1, 0], [u1, 0.3], [u0, 0.3]], c);
  b.quad(P(a1, out, yTop - drop - val), P(a0, out, yTop - drop - val), P(a0, out, yTop - drop), P(a1, out, yTop - drop), [[u1, 0], [u0, 0], [u0, 0.3], [u1, 0.3]], cd);
  // side cheeks
  for (const [aa, dir] of [[a0, -1], [a1, 1]]) {
    const q = [P(aa, 0.02, yTop), P(aa, out, yTop - drop), P(aa, out, yTop - drop - val), P(aa, 0.02, yTop - 0.05)];
    if (dir > 0) b.quad(q[0], q[1], q[2], q[3], [[0, 1], [1, 1], [1, 0], [0, 0]], cd);
    else b.quad(q[3], q[2], q[1], q[0], [[0, 0], [1, 0], [1, 1], [0, 1]], cd);
  }
}

function billboard(B, s, H, rng, lm) {
  const w = Math.min(12, s.len - 3), h = w / 2, y0 = H + 1.6, set = 1.2;
  const a = s.len / 2;
  const frame = col('#2a2a2e');
  for (const aa of [a - w * 0.35, a + w * 0.35]) {
    const [x, z] = along(s, aa, -set - 0.3);
    B.trim.box(x, H + (y0 - H) / 2 + 0.2, z, 0.3, y0 - H + 0.4, 0.3, { color: frame });
  }
  const [cx, cz] = along(s, a, -set - 0.25);
  B.trim.box(cx, y0 + h / 2, cz, s.nx ? 0.3 : w + 0.3, h + 0.3, s.nz ? 0.3 : w + 0.3, { color: frame });
  const idx = rng.int(0, BILLBOARD_COUNT - 1);
  const u0 = (idx % 2) * 0.5, v0 = idx < 2 ? 0.5 : 0;
  const [x0, z0] = along(s, a - w / 2, -set - 0.09), [x1, z1] = along(s, a + w / 2, -set - 0.09);
  B.billboard.quad(V(x0, y0, z0), V(x1, y0, z1), V(x1, y0 + h, z1), V(x0, y0 + h, z0),
    [[u0, v0], [u0 + 0.5, v0], [u0 + 0.5, v0 + 0.5], [u0, v0 + 0.5]], col('#ffffff', 1.4));
  // floodlight bar
  const [lx0, lz0] = along(s, a - w / 2, -set + 0.4), [lx1, lz1] = along(s, a + w / 2, -set + 0.4);
  B.glow.boxMinMax(Math.min(lx0, lx1), y0 - 0.3, Math.min(lz0, lz1), Math.max(lx0, lx1) + (s.nz ? 0 : 0.15), y0 - 0.15, Math.max(lz0, lz1) + (s.nx ? 0 : 0.15), { color: col('#fff1d0', 4) });
  const [fx, fz] = along(s, a, -set + 0.4);
  lm.glow(fx, y0 - 0.22, fz, [2.4, 2.2, 1.8], 2.2, { pull: 0.8, stretch: Math.min(4, w / 2.2) });
}

function fireEscape(b, s, floors, maxY) {
  const w = 4.2, depth = 1.2, a = s.len / 2, c = col('#1d1e21');
  const tx = s.nz, tz = -s.nx;
  for (let f = 1; f < floors; f++) {
    const y = GROUND_H + (f - 1) * FLOOR_H + 0.05;
    if (y + 1.1 > maxY) break;
    const [cx, cz] = along(s, a, depth / 2);
    const sx = s.nx ? depth : w, sz = s.nz ? depth : w;
    b.box(cx, y, cz, sx, 0.08, sz, { color: c });
    const [rx, rz] = along(s, a, depth - 0.03);
    b.box(rx, y + 1.0, rz, s.nx ? 0.05 : w, 0.05, s.nz ? 0.05 : w, { color: c });
    for (const e of [-1, 1]) {
      const [ex, ez] = along(s, a + e * (w / 2 - 0.03), depth / 2);
      b.box(ex, y + 0.5, ez, s.nx ? depth : 0.05, 0.05, s.nz ? depth : 0.05, { color: c, rotY: 0 });
      b.box(ex + s.nx * (depth / 2 - 0.03) , y + 0.5, ez + s.nz * (depth / 2 - 0.03), 0.05, 1.0, 0.05, { color: c });
    }
    if (f + 1 < floors && y + FLOOR_H + 1.1 <= maxY) {
      // diagonal stair between this platform and the next
      const len = Math.hypot(w * 0.7, FLOOR_H);
      const ang = Math.atan2(FLOOR_H, w * 0.7);
      const [sx2, sz2] = along(s, a, depth * 0.55);
      const m = new THREE.Matrix4().makeRotationY(Math.atan2(-tz, tx) ).multiply(new THREE.Matrix4().makeRotationZ((f % 2 ? 1 : -1) * ang));
      m.setPosition(sx2, y + FLOOR_H / 2, sz2);
      m.multiply(new THREE.Matrix4().makeScale(len, 0.06, 0.5));
      b.addGeometry(UNIT_BOX, m, { color: c });
    }
  }
}
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
