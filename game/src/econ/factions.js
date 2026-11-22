// PASS 13 — factions and reputation (logic only).
// Three factions, each owning a district (the district bounds live in
// world/life.js and are read from there). Reputation runs -100..100 per
// faction; standing() buckets it into hostile / neutral / friendly / allied.
// Hooks (core/events.js):
//   side:completed  -> +SIDE_REP for the faction owning the completion point
//   wanted:changed  -> -WANTED_REP per star gained from a crime, charged to the
//                      faction owning the district where it was reported
//   mission:passed  -> the fixed STORY_REP grant for that mission (first pass)
// Life encounters (world/life.js) route their standing through change() via
// attachFactions, so this module is the single ledger. Persists in the save's
// existing 'factions' section; every change emits faction:changed.
import { emit, on } from '../core/events.js';
import { readSave, patchSection, registerSection } from '../save.js';
import { DISTRICTS, districtAt, attachFactions, restore as lifeRestore } from '../world/life.js';

export const FACTIONS = ['dockers', 'midtown', 'northside'];
export const SIDE_REP = 5;
export const WANTED_REP = 4;
// Fixed grants for a story mission's first pass.
export const STORY_REP = {
  pickup: { dockers: 5 },
  cargo: { dockers: 10, northside: -5 },
  witness: { northside: 10 },
  escort: { midtown: 10 },
  finale: { dockers: 15 },
};
// Which district each shop trades in.
export const SHOP_FACTION = { clothing: 'midtown', hardware: 'dockers' };
// Standing thresholds (inclusive lower bounds) and the price each pays.
export const THRESHOLDS = { hostile: -100, neutral: -25, friendly: 25, allied: 70 };
const PRICE = { hostile: null, neutral: 1, friendly: 0.9, allied: 0.8 };

const clamp = (n) => Math.max(-100, Math.min(100, Math.round(n)));
const known = (f) => FACTIONS.includes(f);

function fresh() { return Object.fromEntries(FACTIONS.map((f) => [f, 0])); }
function cleaned(data) {
  const out = fresh();
  if (data && typeof data === 'object') {
    for (const f of FACTIONS) if (Number.isFinite(data[f])) out[f] = clamp(data[f]);
  }
  return out;
}

let rep = cleaned(readSave().data?.factions);

export function serialize() { return { ...rep }; }
export function restore(data) { rep = cleaned(data); lifeRestore({ ...rep }); }
registerSection('factions', { serialize, restore });

function persist() { return patchSection('factions', serialize()); }

export function rep_(faction) { return known(faction) ? rep[faction] : 0; }
export { rep_ as rep };
export function all() { return { ...rep }; }

export function standing(faction) {
  const r = rep_(faction);
  if (r >= THRESHOLDS.allied) return 'allied';
  if (r >= THRESHOLDS.friendly) return 'friendly';
  if (r >= THRESHOLDS.neutral) return 'neutral';
  return 'hostile';
}

// Returns the new reputation, or null if nothing changed.
export function change(faction, delta, reason) {
  if (!known(faction) || !Number.isFinite(delta)) return null;
  const from = rep[faction];
  const to = clamp(from + delta);
  if (to === from) return null;
  const before = standing(faction);
  rep[faction] = to;
  persist();
  lifeRestore({ ...rep });
  emit('faction:changed', { faction, rep: to, delta: to - from, from, standing: standing(faction), previous: before, reason: reason ?? null });
  return to;
}

// Multiplier for a shop in this faction's district; null means it refuses to trade.
export function priceModifier(faction) {
  if (!known(faction)) return 1;
  return PRICE[standing(faction)];
}
export function shopModifier(shopId) {
  return Object.hasOwn(SHOP_FACTION, shopId) ? priceModifier(SHOP_FACTION[shopId]) : 1;
}

export function factionAt(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return districtAt(x, z)?.faction ?? null;
}
export function districtOf(faction) { return DISTRICTS.find((d) => d.faction === faction)?.id ?? null; }

export function reset() {
  rep = fresh();
  persist();
  lifeRestore({ ...rep });
}

// ---- event hooks ------------------------------------------------------------

on('side:completed', (p) => {
  const f = known(p?.faction) ? p.faction : factionAt(p?.at?.x, p?.at?.z);
  if (f) change(f, SIDE_REP, `side:${p.activity}`);
});

on('wanted:changed', (p) => {
  if (!p || p.cause === 'forced' || !(p.level > p.from)) return;
  const f = factionAt(p.x, p.z);
  if (f) change(f, -WANTED_REP * (p.level - p.from), `wanted:${p.level}`);
});

on('mission:passed', (p) => {
  if (!p?.first) return;
  const grant = STORY_REP[p.id];
  if (!grant) return;
  for (const [f, d] of Object.entries(grant)) change(f, d, `story:${p.id}`);
});

// Life encounters already clamp their own copy; this keeps the ledger here.
attachFactions({ adjust: (faction, delta) => change(faction, delta, 'life:encounter') });
