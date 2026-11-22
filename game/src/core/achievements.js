// PASS 16 — achievements. Each one unlocks once, from a game event on core/events.js,
// is remembered in the save's 'achievements' section ({ unlocked: [ids] }) and emits
// achievement:unlocked { id, title, text, unlocked, total } (main.js shows a toast).
import { on, emit } from './events.js';
import { patchSection, registerSection } from '../save.js';

export const ACHIEVEMENTS = [
  { id: 'first-fare', title: 'FIRST FARE', text: 'Finish a taxi job', when: ['side:completed', (p) => p?.activity === 'taxi'] },
  { id: 'courier', title: 'SIGNED FOR', text: 'Finish a courier delivery', when: ['side:completed', (p) => p?.activity === 'delivery'] },
  { id: 'street-racer', title: 'BEAT THE RIVAL', text: 'Win a street race', when: ['side:completed', (p) => p?.activity === 'race'] },
  { id: 'on-the-books', title: 'ON THE BOOKS', text: 'Pass a story mission', when: ['mission:passed', (p) => !!p?.id] },
  { id: 'last-route', title: 'THE LAST ROUTE', text: 'Finish the story', when: ['mission:passed', (p) => !!p?.ending] },
  { id: 'finders-keepers', title: 'FINDERS KEEPERS', text: 'Find a harbour tag', when: ['collectible:found', () => true] },
  { id: 'harbour-sweep', title: 'HARBOUR SWEEP', text: 'Find every harbour tag', when: ['collectible:found', (p) => p?.found >= p?.total] },
  { id: 'shopper', title: 'PAID IN FULL', text: 'Buy something in a shop', when: ['shop:bought', () => true] },
  { id: 'custom-job', title: 'CUSTOM JOB', text: 'Customise a car at Breakwater Customs', when: ['garage:changed', (p) => p?.reason === 'custom'] },
  { id: 'most-wanted', title: 'MOST WANTED', text: 'Reach three wanted stars', when: ['wanted:changed', (p) => p?.cause !== 'forced' && p?.level >= 3] },
  // PASS 15: money and factions
  { id: 'first-grand', title: 'FIRST GRAND', text: 'Hold $1,000 or more', when: ['money:changed', (p) => p?.delta > 0 && p?.balance >= 1000] },
  { id: 'big-earner', title: 'BIG EARNER', text: 'Hold $10,000 or more', when: ['money:changed', (p) => p?.delta > 0 && p?.balance >= 10000] },
  { id: 'good-standing', title: 'GOOD STANDING', text: 'Become friendly with a faction', when: ['faction:changed', (p) => p?.delta > 0 && (p?.standing === 'friendly' || p?.standing === 'allied')] },
  { id: 'burned-bridges', title: 'BURNED BRIDGES', text: 'Make a faction hostile', when: ['faction:changed', (p) => p?.delta < 0 && p?.standing === 'hostile' && p?.previous !== 'hostile'] },
  { id: 'lie-low', title: 'LIE LOW', text: 'Sleep at the safehouse', when: ['interior:slept', () => true] },
];
const IDS = new Set(ACHIEVEMENTS.map((a) => a.id));

let got = [];   // unlocked ids, in unlock order

function serialize() { return { unlocked: got.slice() }; }
function restore(data) { got = (data?.unlocked ?? []).filter((id) => IDS.has(id)); }
registerSection('achievements', { serialize, restore });

export function list() { return ACHIEVEMENTS.map(({ id, title, text }) => ({ id, title, text, unlocked: got.includes(id) })); }
export function isUnlocked(id) { return got.includes(id); }
// PASS 15: the unlocked achievements, in unlock order.
export function unlocked() { return got.map((id) => { const { title, text } = ACHIEVEMENTS.find((a) => a.id === id); return { id, title, text }; }); }
export function count() { return got.length; }
// New game: nothing unlocked (the caller clears the save).
export function reset() { got = []; }

// Returns true only the first time.
export function unlock(id) {
  if (!IDS.has(id) || got.includes(id)) return false;
  got.push(id);
  patchSection('achievements', serialize());
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  emit('achievement:unlocked', { id, title: a.title, text: a.text, unlocked: got.length, total: ACHIEVEMENTS.length });
  return true;
}

for (const a of ACHIEVEMENTS) {
  const [event, test] = a.when;
  on(event, (p) => { if (!got.includes(a.id) && test(p)) unlock(a.id); });
}
