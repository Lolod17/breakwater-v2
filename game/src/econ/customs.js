// PASS 10c: the customisation catalogue. Eight categories, each one or two rows
// of options; every option has an id (what the save stores), a label and a price
// (what wallet.spend charges in garage.customise). The first option of each row
// is the factory default and is free. What an option looks like lives in
// vehicles/customParts.js; this file is data only so garage.js can validate saves.

const P = (id, label, price, extra = {}) => ({ id, label, price, ...extra });

// paint colours are free-form hex in the save (garage colour field); these are the swatches the menu sells
export const PAINT_SWATCHES = [
  P('#c8102e', 'Harbour Red', 120), P('#0a5ad6', 'Signal Blue', 120), P('#f4f4f2', 'Chalk White', 120),
  P('#111214', 'Midnight Black', 120), P('#ffb000', 'Dock Amber', 140), P('#18a37a', 'Jade', 140),
  P('#ff5f1f', 'Sunset Orange', 140), P('#5b2a86', 'Ultraviolet', 160), P('#8a8f94', 'Gunmetal', 120),
  P('#e4007c', 'Neon Magenta', 160), P('#7fd13b', 'Acid Lime', 160), P('#1d3a2f', 'Racing Green', 140),
];
export const PAINT_PRICE = (hex) => PAINT_SWATCHES.find((s) => s.id === hex)?.price ?? 120;

export const OPTIONS = {
  finish: [P('gloss', 'Gloss', 0), P('matte', 'Matte', 180), P('metallic', 'Metallic', 220), P('pearl', 'Pearlescent', 350)],
  wheels: [P('stock', 'Factory', 0), P('twin5', 'Twin Five', 150), P('mesh10', 'Cross Mesh', 220), P('y5', 'Y-Spoke', 200),
    P('dish6', 'Deep Dish', 260), P('slot5', 'Slot Mag', 180), P('turbine', 'Turbine', 320), P('multi14', 'Fourteen', 300),
    P('blade5', 'Blade', 240)],
  spoiler: [P('none', 'None', 0), P('lip', 'Duck Lip', 120), P('wing', 'Street Wing', 280), P('gt', 'GT Wing', 450)],
  aero: [P('stock', 'Factory', 0), P('splitter', 'Front Splitter', 150), P('sport', 'Sport Kit', 320), P('track', 'Track Kit', 520)],
  ride: [P('stock', 'Factory', 0), P('raised', 'Raised +5 cm', 90), P('lowered', 'Lowered -4 cm', 100), P('slammed', 'Slammed -8 cm', 180)],
  tint: [P('stock', 'Factory', 0), P('clear', 'Clear', 60), P('light', 'Light 35%', 80), P('dark', 'Dark 15%', 110), P('limo', 'Limo 5%', 150)],
  head: [P('stock', 'Halogen', 0), P('xenon', 'Xenon Blue', 90), P('amber', 'Amber', 80), P('ice', 'Ice White', 100), P('violet', 'Violet', 120)],
  glow: [P('off', 'Off', 0), P('cyan', 'Cyan', 200), P('magenta', 'Magenta', 200), P('lime', 'Lime', 200), P('amber', 'Amber', 200), P('white', 'White', 200)],
  livery: [P('none', 'None', 0), P('twin', 'Rally Twin', 220), P('centre', 'Centre Stripe', 160), P('side', 'Side Stripe', 150),
    P('twotone', 'Two-Tone', 260), P('roundel', 'Race Roundel', 300)],
  liveryColour: [P('white', 'White', 0), P('black', 'Black', 40), P('gold', 'Gold', 60), P('red', 'Red', 40), P('cyan', 'Cyan', 40), P('orange', 'Orange', 40)],
};
export const CUSTOM_KEYS = Object.keys(OPTIONS);

export function defaultCustom() {
  const c = {};
  for (const k of CUSTOM_KEYS) c[k] = OPTIONS[k][0].id;
  return c;
}
export const isOption = (key, id) => Object.hasOwn(OPTIONS, key) && OPTIONS[key].some((o) => o.id === id);
export const optionPrice = (key, id) => OPTIONS[key]?.find((o) => o.id === id)?.price ?? null;

// The menu: eight categories, each a list of rows (a row edits one key; 'colour' is the paint hex).
export const CATEGORIES = [
  { id: 'paint', label: 'Paint', rows: [{ key: 'colour', label: 'Colour' }, { key: 'finish', label: 'Finish' }] },
  { id: 'wheels', label: 'Wheels', rows: [{ key: 'wheels', label: 'Design' }] },
  { id: 'spoiler', label: 'Spoiler', rows: [{ key: 'spoiler', label: 'Rear' }] },
  { id: 'aero', label: 'Bumpers & Splitters', rows: [{ key: 'aero', label: 'Kit' }] },
  { id: 'ride', label: 'Ride Height', rows: [{ key: 'ride', label: 'Suspension' }] },
  { id: 'tint', label: 'Window Tint', rows: [{ key: 'tint', label: 'Glass' }] },
  { id: 'lights', label: 'Lights', rows: [{ key: 'head', label: 'Headlights' }, { key: 'glow', label: 'Underglow' }] },
  { id: 'livery', label: 'Livery', rows: [{ key: 'livery', label: 'Design' }, { key: 'liveryColour', label: 'Colour' }] },
];
export const rowOptions = (key) => (key === 'colour' ? PAINT_SWATCHES : OPTIONS[key]);
