// PASS 10a2: the 21-car civilian collection in one place. Each entry gathers the
// car's tier, price, handling / engine stats, body parameters and audio profile from
// VEHICLE_TYPES (the single source the physics, models and audio read), plus the
// collection data that lives only here: price, the flagship (cockpit) flag and the
// district spawn weights. VehicleManager picks parked and traffic types from these
// weights by district (pickType).
import { VEHICLE_TYPES } from './vehicleTypes.js';

export const TIERS = ['hyper', 'super', 'sports', 'muscle', 'luxury'];
export const DISTRICTS = ['core', 'midtown', 'waterfront', 'industrial', 'oldmarket'];

// Collection data: price ($), engine description, spawn weights.
// parked / traffic: [core, midtown, waterfront, industrial, oldmarket].
const COLLECTION_DATA = {
  vortex:     { price: 2850000, engine: 'twin-turbo V8 hybrid, AWD', parked: [3, 1, 2, 0, 0], traffic: [0.3, 0, 0.2, 0, 0] },
  tempesta:   { price: 2400000, engine: 'naturally aspirated V12, RWD', parked: [3, 1, 2, 0, 0], traffic: [0.3, 0.1, 0.2, 0, 0] },
  nemesis:    { price: 3100000, engine: 'twin-turbo V8 long-tail, AWD', parked: [2, 0.5, 3, 0, 0], traffic: [0.2, 0, 0.3, 0, 0] },
  inferno:    { price: 2650000, engine: 'naturally aspirated V12 speedster, RWD', parked: [2, 0.5, 3, 0, 0], traffic: [0.2, 0, 0.4, 0, 0] },
  stratos:    { price: 395000, engine: 'twin-turbo V6, mid-engine RWD', parked: [2, 1.5, 1.5, 0.3, 0.5], traffic: [0.5, 0.3, 0.4, 0, 0.1] },
  corsa:      { price: 455000, engine: 'naturally aspirated V10, RWD', parked: [2, 1.5, 1.5, 0.2, 0.3], traffic: [0.5, 0.3, 0.4, 0, 0] },
  venom:      { price: 520000, engine: 'twin-turbo V8, RWD', parked: [2, 1, 2, 0.2, 0.2], traffic: [0.5, 0.2, 0.5, 0, 0] },
  spectre:    { price: 480000, engine: 'twin-turbo V8, mid-engine RWD', parked: [2.5, 1.5, 1.5, 0, 0.3], traffic: [0.6, 0.3, 0.4, 0, 0] },
  reaper:     { price: 560000, engine: 'naturally aspirated V12, AWD', parked: [2, 1, 1.5, 0.3, 0.2], traffic: [0.5, 0.2, 0.3, 0.1, 0] },
  phoenix:    { price: 88000, engine: 'turbo straight-six, front-engine RWD', parked: [1, 2, 1, 1, 1.5], traffic: [1, 1.5, 1, 0.8, 1] },
  driftline:  { price: 46000, engine: 'turbo four, RWD drift build', parked: [0.5, 1.5, 0.5, 2.5, 2], traffic: [0.5, 1, 0.5, 1.8, 1.5] },
  carbon:     { price: 74000, engine: 'turbo four, mid-engine RWD', parked: [1, 2, 1.5, 0.5, 1], traffic: [0.8, 1.5, 1, 0.3, 0.6] },
  apex:       { price: 168000, engine: 'naturally aspirated flat-six, rear-engine RWD', parked: [2, 2, 1.5, 0.3, 0.8], traffic: [1.2, 1.2, 1, 0.2, 0.5] },
  nightshade: { price: 112000, engine: 'twin-turbo straight-six, AWD', parked: [1, 1.5, 0.5, 2, 1.5], traffic: [0.8, 1.2, 0.4, 1.5, 1.2] },
  bullet:     { price: 39000, engine: 'turbo four, FWD hot hatch', parked: [1.5, 2.5, 1, 1.5, 2.5], traffic: [1.5, 2.5, 1, 1.5, 2.5] },
  thunder:    { price: 64000, engine: 'naturally aspirated V8, RWD', parked: [0.5, 1.5, 1, 2, 2], traffic: [0.6, 1.5, 0.8, 1.8, 1.8] },
  ironclad:   { price: 92000, engine: 'big-block V8, four-speed, RWD', parked: [0.3, 1, 1, 1.5, 3], traffic: [0.2, 0.8, 0.6, 1, 2] },
  dominator:  { price: 79000, engine: 'supercharged V8, RWD', parked: [0.8, 1.5, 0.8, 2, 1.5], traffic: [0.8, 1.5, 0.7, 1.8, 1.4] },
  monarch:    { price: 245000, engine: 'naturally aspirated V12 saloon, RWD', parked: [3, 1.5, 1.5, 0, 0.5], traffic: [2, 1, 1, 0, 0.3] },
  royale:     { price: 288000, engine: 'twin-turbo W12, AWD grand tourer', parked: [2.5, 1, 2, 0, 0.3], traffic: [1.5, 0.6, 1.2, 0, 0.2] },
  executive:  { price: 215000, engine: 'naturally aspirated V12, long saloon, RWD', parked: [3, 1.5, 1, 0.2, 0.3], traffic: [2, 1.2, 0.8, 0.1, 0.2] },
};
// The five cars that carry the detailed cockpit (one per tier); the rest a simple dash.
export const FLAGSHIPS = ['inferno', 'spectre', 'apex', 'dominator', 'royale'];

// Everyday cars keep the streets believable: [core, midtown, waterfront, industrial, oldmarket].
const EVERYDAY = {
  parked: { sedan: [4, 5, 3, 2, 4], suv: [3, 4, 2, 1.5, 2], pickup: [0.5, 1.5, 1.5, 4, 2], van: [1.5, 2, 2, 4, 3], truck: [0.3, 0.5, 1.5, 4, 0.5], sports: [0.5, 0.5, 0.5, 0.2, 0.2] },
  traffic: { sedan: [9, 9, 6, 4, 7], suv: [5, 6, 4, 3, 4], pickup: [1, 2.5, 2, 5, 3], van: [2.5, 3, 3, 5, 4], truck: [0.6, 1, 2.5, 5, 1], police: [1.5, 1.2, 1, 0.8, 1], sports: [0.4, 0.4, 0.4, 0.2, 0.2] },
};

export const CATALOGUE = Object.keys(COLLECTION_DATA).map((id) => {
  const t = VEHICLE_TYPES[id], c = COLLECTION_DATA[id];
  return {
    id, model: t.label, tier: t.tier, price: c.price, engine: c.engine, flagship: FLAGSHIPS.includes(id),
    stats: { mass: t.mass, torque: t.torque, redline: t.redline, gears: t.gears.length, final: t.final, top: t.top, drive: t.drive,
      grip: t.grip, brakes: t.brakes, drift: t.drift, steerLock: t.steerLock, cgH: t.cgH },
    body: { length: t.length, width: t.width, height: t.height, wheelbase: t.wheelbase, frontAxle: t.frontAxle, wheelR: t.wheelR, tyreW: t.tyreW,
      wheelStyle: t.wheelStyle, cabin: t.cabin ?? 'sealed', paints: t.paints.slice() },
    audio: { cyl: t.cyl, pitch: t.pitch, rough: t.rough, whine: t.whine, idle: t.idle, redline: t.redline },
    spawn: { parked: Object.fromEntries(DISTRICTS.map((d, i) => [d, c.parked[i]])), traffic: Object.fromEntries(DISTRICTS.map((d, i) => [d, c.traffic[i]])) },
  };
});
export const CATALOGUE_BY_ID = Object.fromEntries(CATALOGUE.map((e) => [e.id, e]));

// Which district a ground position is in (same areas as the HUD banner; the core is
// the tall-tower ring the buildings use, centred on (0, -40)).
export function districtOf(x, z) {
  if (x >= 114 && z >= 34 && z <= 200) return 'industrial';
  if (z > 160) return 'waterfront';
  if (x >= -200 && x <= -40 && z >= -200 && z <= -120) return 'oldmarket';
  return 1 - Math.min(1, Math.hypot(x, z + 40) / 250) > 0.45 ? 'core' : 'midtown';
}

const TABLES = {};
for (const role of ['parked', 'traffic']) {
  TABLES[role] = {};
  DISTRICTS.forEach((d, i) => {
    const rows = Object.entries(EVERYDAY[role]).map(([id, w]) => [id, w[i]]);
    for (const e of CATALOGUE) rows.push([e.id, e.spawn[role][d]]);
    const list = rows.filter(([, w]) => w > 0), total = list.reduce((s, [, w]) => s + w, 0);
    TABLES[role][d] = { list, total };
  });
}
// A type for a parked or traffic slot at (x, z); u in [0, 1) from the caller's seeded stream.
export function pickType(role, x, z, u) {
  const { list, total } = TABLES[role][districtOf(x, z)];
  let r = u * total;
  for (const [id, w] of list) { if ((r -= w) < 0) return id; }
  return list[list.length - 1][0];
}
