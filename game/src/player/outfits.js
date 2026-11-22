// PASS 14b: outfits (logic only). An outfit is wearable when every clothing item
// it needs (bought at the clothing shop, econ/shop.js, so it sits in the bag)
// is owned; the courier look is always available. Only `outfitId` and its
// `colours` (the OUTFIT_PRESETS palette from outfit.js) are stored, in the
// `outfit` save section; the visual pass applies the look to the model.
//
// Disguise: changing into a different outfit while wanted and out of police
// sight arms a short timer. If the player stays unseen for DISGUISE_DELAY
// seconds, one wanted star drops; being spotted first cancels it. After a drop
// the trick re-arms only after DISGUISE_REARM seconds.
import { registerSection } from '../save.js';
import { has } from '../econ/inventory.js';
import { emit } from '../core/events.js';
import { OUTFIT_PRESETS } from './outfit.js';

export const OUTFIT_KEY = 'KeyO';
export const DISGUISE_DELAY = 3;
export const DISGUISE_REARM = 30;
export const DEFAULT_OUTFIT = 'courier';

export const OUTFITS = {
  courier:     { id: 'courier',     name: 'Courier',     needs: [] },
  windbreaker: { id: 'windbreaker', name: 'Windbreaker', needs: ['windbreaker'] },
  denim:       { id: 'denim',       name: 'Denim',       needs: ['jacket'] },
  dockhand:    { id: 'dockhand',    name: 'Dockhand',    needs: ['cap', 'boots'] },
  night:       { id: 'night',       name: 'Night Shift', needs: ['jacket', 'boots'] },
};
const ORDER = Object.keys(OUTFITS);
const HEX = /^#[0-9a-f]{6}$/i;

let outfitId = DEFAULT_OUTFIT;
let disguise = { pending: 0, rearm: 0, armed: false };

const coloursOf = (id) => ({ ...(OUTFIT_PRESETS[id] ?? {}) });

export function isOwned(id) {
  return Object.hasOwn(OUTFITS, id) && OUTFITS[id].needs.every((item) => has(item, 1));
}
export function owned() { return ORDER.filter(isOwned); }
export function current() { return { outfitId, colours: coloursOf(outfitId) }; }

// Wear an owned outfit. `ctx` = { wanted, seen }: a change while wanted and
// unseen arms the disguise timer. Returns false for unknown / unowned ids.
export function wear(id, ctx = {}) {
  if (!isOwned(id)) return false;
  if (id === outfitId) return true;
  const from = outfitId;
  outfitId = id;
  if (ctx.wanted?.level > 0 && !ctx.seen && disguise.rearm <= 0) { disguise.armed = true; disguise.pending = DISGUISE_DELAY; }
  emit('outfit:changed', { outfitId: id, from, disguise: disguise.armed });
  return true;
}

// The next owned outfit after the current one (the O key).
export function cycle(ctx) {
  const list = owned();
  if (list.length < 2) return null;
  const next = list[(list.indexOf(outfitId) + 1) % list.length];
  return wear(next, ctx) ? next : null;
}

// Each fixed step: run the disguise timer. Returns true on the step a star drops.
export function update(dt, wanted, seen, position) {
  disguise.rearm = Math.max(0, disguise.rearm - dt);
  if (!disguise.armed) return false;
  if (seen || !wanted.level) { disguise.armed = false; disguise.pending = 0; return false; }
  disguise.pending -= dt;
  if (disguise.pending > 1e-9) return false;
  disguise.armed = false; disguise.pending = 0; disguise.rearm = DISGUISE_REARM;
  return wanted.dropStar(position);
}

export function status() {
  return { ...current(), owned: owned(), disguise: { armed: disguise.armed, pending: +disguise.pending.toFixed(3), rearm: +disguise.rearm.toFixed(3) } };
}

export function reset() {
  outfitId = DEFAULT_OUTFIT;
  disguise = { pending: 0, rearm: 0, armed: false };
}

registerSection('outfit', {
  defaults: () => ({ outfitId: DEFAULT_OUTFIT, colours: {} }),
  validate: (v) => {
    if (!v || typeof v !== 'object' || !Object.hasOwn(OUTFITS, v.outfitId)) return 'outfitId';
    const c = v.colours;
    if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).length > 16) return 'colours';
    for (const [k, hex] of Object.entries(c)) if (!/^[a-z]{1,16}$/i.test(k) || typeof hex !== 'string' || !HEX.test(hex)) return 'colours';
    return null;
  },
  clean: (v) => ({ outfitId: v.outfitId, colours: Object.fromEntries(Object.entries(v.colours).map(([k, hex]) => [k, hex.toLowerCase()])) }),
  serialize: () => current(),
  // a saved outfit whose clothes have left the bag falls back to the courier look
  restore: (v) => { outfitId = isOwned(v.outfitId) ? v.outfitId : DEFAULT_OUTFIT; disguise = { pending: 0, rearm: 0, armed: false }; },
});
