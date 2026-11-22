// PASS 16 — collectibles: lost HARBOUR TAGS (PASS 15: twenty) on the downtown pavements and the jetty.
// Placement is seeded (same seed, same spots) and every spot is on raised pavement
// (or the jetty), clear of the interior doors and the side-job spots. Walking or driving
// within PICK_RADIUS of a tag collects it: it pays REWARD through the wallet once,
// is remembered in the save's 'collectibles' section ({ found: [ids] }) and emits
// collectible:found { id, found, total, reward }.
// Logic only: main.js draws the tags (one instanced mesh) and calls collectAt().
import { RNG } from '../rng.js';
import { CITY } from '../config.js';
import { buildLayout } from '../world/layout.js';
import { doors } from '../world/doors.js';
import { SPOTS } from '../missions/side.js';
import { earn } from './wallet.js';
import { emit } from '../core/events.js';
import { patchSection, registerSection } from '../save.js';

export const TOTAL = 20;
export const REWARD = 50;
export const PICK_RADIUS = 1.6;
const DEFAULT_SEED = 1337;
const CLEAR_OF = 4;          // metres from any door anchor or side-job spot
const SPACING = 30;          // metres between two tags (first sweep)
const SPACING_2 = 22;        // metres between two tags (top-up sweep)

let spots = [];
let found = new Set();

function place(seed) {
  const layout = buildLayout();
  const rng = new RNG(seed >>> 0).fork('collectibles');
  const blocked = [...doors(), ...SPOTS];
  const clear = (x, z) => blocked.every((b) => Math.hypot(b.x - x, b.z - z) >= CLEAR_OF);
  const out = [];
  // one on the far end of the jetty, the rest on block pavements (one per block at most)
  out.push({ x: (layout.pier.x0 + layout.pier.x1) / 2, z: layout.pier.z1 - 4 });
  const blocks = layout.blocks.slice();
  for (let i = blocks.length - 1; i > 0; i--) { const j = rng.int(0, i); [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; }
  for (const b of blocks) {
    if (out.length >= TOTAL) break;
    const mid = CITY.paveWidth / 2;
    for (let tries = 0; tries < 6; tries++) {
      const side = rng.int(0, 3);
      const t = rng.float(0.2, 0.8);
      const { slab } = b;
      const x = side === 0 ? slab.x0 + mid : side === 1 ? slab.x1 - mid : slab.x0 + (slab.x1 - slab.x0) * t;
      const z = side === 2 ? slab.z0 + mid : side === 3 ? slab.z1 - mid : slab.z0 + (slab.z1 - slab.z0) * t;
      if (layout.groundHeight(x, z) === CITY.kerbH && clear(x, z) && out.every((o) => Math.hypot(o.x - x, o.z - z) > SPACING)) { out.push({ x: +x.toFixed(2), z: +z.toFixed(2) }); break; }
    }
  }
  // PASS 15: top up to TOTAL with a second sweep (closer spacing, a second tag per block allowed).
  // The first sweep is unchanged, so the original tag ids keep their spots in old saves.
  for (let pass = 0; pass < 4 && out.length < TOTAL; pass++) {
    for (const b of blocks) {
      if (out.length >= TOTAL) break;
      const mid = CITY.paveWidth / 2, { slab } = b;
      for (let tries = 0; tries < 8; tries++) {
        const side = rng.int(0, 3), t = rng.float(0.15, 0.85);
        const x = side === 0 ? slab.x0 + mid : side === 1 ? slab.x1 - mid : slab.x0 + (slab.x1 - slab.x0) * t;
        const z = side === 2 ? slab.z0 + mid : side === 3 ? slab.z1 - mid : slab.z0 + (slab.z1 - slab.z0) * t;
        if (layout.groundHeight(x, z) === CITY.kerbH && clear(x, z) && out.every((o) => Math.hypot(o.x - x, o.z - z) > SPACING_2)) { out.push({ x: +x.toFixed(2), z: +z.toFixed(2) }); break; }
      }
    }
  }
  return out.map((p, i) => ({ id: `tag-${String(i + 1).padStart(2, '0')}`, ...p }));
}

export function init(seed = DEFAULT_SEED) {
  spots = place(seed);
  return list();
}

export function list() { return spots.map((s) => ({ ...s, found: found.has(s.id) })); }
export function foundCount() { return found.size; }
export function isFound(id) { return found.has(id); }

function serialize() { return { found: spots.filter((s) => found.has(s.id)).map((s) => s.id) }; }
function restore(data) { found = new Set((data?.found ?? []).filter((id) => spots.some((s) => s.id === id))); }
registerSection('collectibles', { serialize, restore });

// New game: nothing found (the caller clears the save).
export function reset() { found = new Set(); }

// The tag within reach of (x, z), collected now; null when there is none.
export function collectAt(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const s = spots.find((p) => !found.has(p.id) && Math.hypot(p.x - x, p.z - z) <= PICK_RADIUS);
  return s ? take(s) : null;
}

function take(s) {
  found.add(s.id);
  earn(REWARD, `collectible:${s.id}`);
  patchSection('collectibles', serialize());
  const payload = { id: s.id, found: found.size, total: spots.length, reward: REWARD };
  emit('collectible:found', payload);
  return payload;
}

// PASS 15: collect a tag by id (once only). Returns the collectible:found payload, or null
// when the id is unknown or already found.
export function collect(id) {
  const s = spots.find((p) => p.id === id);
  if (!s || found.has(id)) return null;
  return take(s);
}

export function progress() {
  return { found: found.size, total: spots.length, fraction: spots.length ? found.size / spots.length : 0, ids: serialize().found };
}

init();
