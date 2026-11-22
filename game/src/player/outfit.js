// PASS 15b: the saved look on the player model. The wardrobe section
// (world/interiors.js: top / head / feet) already rebuilds the body when a save
// is restored. On top of that, if a save carries an `outfitId` and / or a
// `colours` map (top level, or inside the player or wardrobe section), they are
// laid over the wardrobe palette: outfitId picks a named preset, colours
// overrides single palette keys with #rrggbb values. Unknown ids, unknown keys
// and malformed colours are ignored. The validated save drops fields it does not
// know, so these are read from the raw stored JSON (read only, never written).
import { SAVE_KEY } from '../save.js';

export const OUTFIT_PRESETS = {
  courier: {},
  windbreaker: { jacket: '#1f6f8b', lining: '#0e3442', accent: '#ffd23f', shirt: '#22262b' },
  denim: { jacket: '#3f5f86', lining: '#24364f', accent: '#d9d4ca', shirt: '#f1ede4' },
  dockhand: { jacket: '#c4561c', lining: '#5a2a10', accent: '#f2f2f2', shirt: '#2b2f33', pants: '#3a3b37', cap: '#22344a', shoe: '#6b4423', sole: '#1c140d' },
  night: { jacket: '#15171c', lining: '#08090b', accent: '#00e6ff', shirt: '#1d2027', pants: '#121418', shoe: '#101114', sole: '#050505' },
};
const KEYS = ['jacket', 'lining', 'accent', 'shirt', 'pants', 'belt', 'skin', 'hair', 'shoe', 'sole', 'cap'];
const HEX = /^#[0-9a-f]{6}$/i;

// { outfitId, colours } found in the stored save, or null when neither is there.
export function savedLook(storage = globalThis.localStorage) {
  let raw;
  try { raw = JSON.parse(storage?.getItem(SAVE_KEY) ?? 'null'); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const at = [raw, raw.player, raw.wardrobe].filter((o) => o && typeof o === 'object');
  const outfitId = at.map((o) => o.outfitId).find((v) => typeof v === 'string' && Object.hasOwn(OUTFIT_PRESETS, v)) ?? null;
  const src = at.map((o) => o.colours ?? o.colors).find((v) => v && typeof v === 'object' && !Array.isArray(v)) ?? null;
  const colours = {};
  if (src) for (const k of KEYS) if (typeof src[k] === 'string' && HEX.test(src[k])) colours[k] = src[k].toLowerCase();
  if (!outfitId && !Object.keys(colours).length) return null;
  return { outfitId, colours };
}

// The wardrobe palette with the saved preset and colours laid over it.
export function lookPalette(base, look) {
  return { ...base, ...(look?.outfitId ? OUTFIT_PRESETS[look.outfitId] : {}), ...(look?.colours ?? {}) };
}
