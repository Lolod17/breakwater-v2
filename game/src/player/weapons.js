// PASS 14b: weapon data and the equipped weapon. Combat reads every number it
// needs (damage, fire interval, range, magazine, reload) from WEAPONS, and
// stealth reads each weapon's noise;
// nothing about a weapon is hard-coded in combat.js any more.
//
// A weapon is "held" when it is innate (fists, and the pistol the courier has
// carried since PASS 4) or when its inventory item is in the bag (inventory.js).
// The weapon wheel only offers held weapons and equip() refuses any other.
// The equipped id is saved in its own `loadout` section.
import { registerSection } from '../save.js';
import { has } from '../econ/inventory.js';
import { emit } from '../core/events.js';

export const WEAPONS = {
  fists:   { id: 'fists',   name: 'Fists',   kind: 'melee',   innate: true, damage: 9,  interval: 0.45, range: 1.9, noise: 0.15 },
  pistol:  { id: 'pistol',  name: 'Pistol',  kind: 'firearm', innate: true, damage: 18, interval: 0.18, range: 75,
    magazine: 10, reload: 1.35, ammo: '9mm', reserve: 30, noise: 1 },
  crowbar: { id: 'crowbar', name: 'Crowbar', kind: 'melee',   item: 'crowbar', damage: 26, interval: 0.6, range: 2.3, noise: 0.25 },
};
export const ORDER = ['fists', 'pistol', 'crowbar'];
export const DEFAULT_WEAPON = 'pistol';

let equippedId = DEFAULT_WEAPON;

export function isHeld(id) {
  const w = Object.hasOwn(WEAPONS, id) ? WEAPONS[id] : null;
  return !!w && (w.innate || has(w.item, 1));
}
export function held() { return ORDER.filter(isHeld); }
export function weapon(id) { return Object.hasOwn(WEAPONS, id) ? WEAPONS[id] : null; }

// The equipped weapon; one that has left the bag since falls back to the pistol.
export function equipped() {
  if (!isHeld(equippedId)) equippedId = DEFAULT_WEAPON;
  return WEAPONS[equippedId];
}

export function equip(id) {
  if (!isHeld(id)) return false;
  if (id !== equippedId) {
    const from = equippedId;
    equippedId = id;
    emit('weapon:equipped', { id, from });
  }
  return true;
}

export function reset() { equippedId = DEFAULT_WEAPON; }

registerSection('loadout', {
  defaults: () => ({ weapon: DEFAULT_WEAPON }),
  validate: (v) => (v && typeof v === 'object' && Object.hasOwn(WEAPONS, v.weapon) ? null : 'weapon'),
  clean: (v) => ({ weapon: v.weapon }),
  serialize: () => ({ weapon: equippedId }),
  restore: (v) => { equippedId = isHeld(v.weapon) ? v.weapon : DEFAULT_WEAPON; },
});
