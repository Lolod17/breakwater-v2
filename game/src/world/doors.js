// Door registry: gameplay anchors on the street-facing fronts of the seeded
// downtown buildings. Systems only — no geometry is emitted. Building cells are
// reconstructed from the same layout + seeded subdivision that buildings.js
// uses (identical RNG call order), so anchors sit on real facade lines without
// touching the world builders. One door per block, on the pavement just outside
// the building line, facing out along the front's normal.
import { CITY } from '../config.js';
import { RNG } from '../rng.js';
import { buildLayout } from './layout.js';
import { emit } from '../core/events.js';

const DEFAULT_SEED = 1337;
const RADIUS = 2.2;        // trigger radius around an anchor (metres)
const FRONT_OFFSET = 0.9;  // anchor stand-off from the facade line, onto the pavement
const SIDE_ORDER = ['S', 'E', 'N', 'W'];
const NORMALS = { S: [0, 1], E: [1, 0], N: [0, -1], W: [-1, 0] };

let registry = [];
let activeId = null;

// Mirrors subdivide() in buildings.js: same cells, same RNG draw order.
function cellsOf(lot, rng) {
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

// A side on the lot boundary faces the street (plaza-adjacent sides do not).
function onLotEdge(cell, lot, k) {
  if (k === 'S') return Math.abs(cell.z1 - lot.z1) < 0.01;
  if (k === 'N') return Math.abs(cell.z0 - lot.z0) < 0.01;
  if (k === 'E') return Math.abs(cell.x1 - lot.x1) < 0.01;
  return Math.abs(cell.x0 - lot.x0) < 0.01;
}

function sideMid(cell, k) {
  if (k === 'S') return [(cell.x0 + cell.x1) / 2, cell.z1];
  if (k === 'N') return [(cell.x0 + cell.x1) / 2, cell.z0];
  if (k === 'E') return [cell.x1, (cell.z0 + cell.z1) / 2];
  return [cell.x0, (cell.z0 + cell.z1) / 2];
}

function build(seed) {
  const layout = buildLayout();
  const rng = new RNG(seed).fork('downtown');
  const list = [];
  for (const block of layout.blocks) {
    const br = rng.fork(`block-${block.i}-${block.j}`);
    const cells = cellsOf(block.lot, br);
    // same plaza roll as buildDowntown: plaza cells are open space, not buildings
    const interior = cells.filter((c) => c.rows === 3 && c.row === 1);
    if (interior.length && br.chance(0.35)) br.pick(interior).plaza = true;
    const core = 1 - Math.min(1, Math.hypot(block.cx, block.cz + 40) / 250);
    const district = block.j === CITY.streets.length - 2 ? 'waterfront' : core > 0.45 ? 'core' : 'midtown';
    for (const cell of cells) {
      if (cell.plaza) continue;
      const k = SIDE_ORDER.find((s) => onLotEdge(cell, block.lot, s));
      if (!k) continue;
      const [nx, nz] = NORMALS[k];
      const [mx, mz] = sideMid(cell, k);
      const suffix = `${block.i}-${block.j}-${cell.col}-${cell.row}`;
      list.push({ id: `door-${suffix}`, x: mx + nx * FRONT_OFFSET, z: mz + nz * FRONT_OFFSET,
        yaw: Math.atan2(nx, nz), district, interior: `unit-${suffix}` });
      break;
    }
  }
  return list;
}

export function init(seed = DEFAULT_SEED) {
  registry = build(seed);
  activeId = null;
  return doors();
}

export function doors() {
  return registry.map((d) => ({ ...d }));
}

export function doorRadius() {
  return RADIUS;
}

export function nearestDoor(x, z, radius = RADIUS) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !(radius > 0)) return null;
  let best = null, bestDist = radius;
  for (const d of registry) {
    const dist = Math.hypot(d.x - x, d.z - z);
    if (dist <= bestDist) { best = d; bestDist = dist; }
  }
  return best ? { ...best } : null;
}

// Fixed-step hook: edge-triggered door:inRange when the player enters a radius.
export function track(x, z) {
  const d = nearestDoor(x, z, RADIUS);
  const id = d ? d.id : null;
  if (id !== activeId) {
    activeId = id;
    if (d) emit('door:inRange', { ...d, radius: RADIUS });
  }
  return d;
}

init();
