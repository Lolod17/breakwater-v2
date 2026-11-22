// Deterministic drivers for the verification tools: an autopilot loop around a
// downtown block (used by tools/gate.mjs while sampling) and staged shots
// (used by tools/shots.mjs). Both drive the real game code.

const ROUTE = [
  [32, 128, false], [32, 48, true], [-32, 48, false], [-32, 128, true],
];

export function autopilotRoute() {
  let i = 0;
  return {
    step(player) {
      const [x, z, sprint] = ROUTE[i];
      const dx = x - player.pos.x, dz = z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.2) { i = (i + 1) % ROUTE.length; return; }
      player.autoWish = { x: dx / d, z: dz / d, sprint };
    },
  };
}

const TYPES7 = ['sedan', 'sports', 'suv', 'pickup', 'van', 'truck', 'police'];
const LANES = [35.15, 38.25, 41.75, 44.85];
const PAINTS = ['#c8102e', '#1d2633', '#e8e4dc', '#2f4f6f', '#9fa6ad', '#ffb000', '#3b5b4a', '#6b1c22'];
const TRAFFIC20 = Array.from({ length: 20 }, (_, i) => ({
  type: TYPES7[i % 7], x: LANES[i % 4], z: 190 - i * 4.2 - (TYPES7[i % 7] === 'truck' ? 3 : 0),
  yaw: LANES[i % 4] > 40 ? Math.PI : 0, paint: PAINTS[i % PAINTS.length],
}));
// PASS 10a2: the whole 21-car collection on both kerbs of the avenue, 11 + 10 (fronts toward -z;
// spawn() clears anything within a car length, so the rows sit a carriageway apart)
const COLLECTION21 = ['vortex', 'tempesta', 'nemesis', 'inferno', 'stratos', 'corsa', 'venom', 'spectre', 'reaper', 'phoenix', 'driftline',
  'carbon', 'apex', 'nightshade', 'bullet', 'thunder', 'ironclad', 'dominator', 'monarch', 'royale', 'executive'];
const COLLECTION_ROWS = COLLECTION21.map((type, i) => ({ type, x: i < 11 ? 44.85 : 35.15, z: 190 - (i % 11) * 6.4, yaw: Math.PI }));
const LINEUP = TYPES7.map((type, i) => ({ type, x: 44.85, z: 182 - i * 9 - (type === 'truck' ? 2 : 0), yaw: Math.PI, paint: PAINTS[(i * 3) % PAINTS.length] }));

// x,z,yaw: player spawn; wish/run: movement before the shot; camYaw/pitch/dist: camera pose.
export const SHOTS = {
  pavement: { x: 32.2, z: 150, yaw: 0, run: 2, time: 30, observe: true },
  market: { x: -112.5, z: -160, yaw: 0, run: 2, time: 30, observe: true },
  // PASS 7 UI shot: the player walking through the old market, chase camera, full HUD
  marketFoot: { x: -112.5, z: -146, yaw: Math.PI, wish: { x: 0, z: -1, sprint: false }, run: 2.2, time: 30, camYaw: 0.38, pitch: 0.14, dist: 4.6 },
  waterfront: { x: 150, z: 221.5, yaw: -Math.PI / 2, wish: { x: -1, z: 0, sprint: false }, run: 1.0, camYaw: -0.6, pitch: 0.12, dist: 7 },
  avenue: { x: 32.2, z: 112, yaw: 0, wish: { x: 0, z: 1, sprint: false }, run: 2.35, camYaw: 0.42, pitch: 0.12, dist: 4.2 },
  harbour: { x: -60, z: 288, yaw: 0, wish: { x: 0, z: 1, sprint: false }, run: 0.5, camYaw: 0.25, pitch: 0.16, dist: 5.5 },
  sprint: { x: -32.2, z: 60, yaw: 0, wish: { x: 0, z: -1, sprint: true }, run: 2.4, camYaw: 1.35, pitch: 0.06, dist: 3.6 },
  // ---- PASS 2 vehicle shots (car: the player's car; extra: more vehicles, optionally AI-driven)
  drive: {
    time: 31,
    car: { use: 'hero', x: 41.75, z: 196, yaw: Math.PI, speed: 12, route: [[40, 200], [40, 120]], cruise: 15, ignoreSignals: true },
    extra: [
      { type: 'van', x: 41.75, z: 150, yaw: Math.PI, drive: true, route: [[40, 200], [40, 120]], cruise: 8, paint: '#f2f2ee' },
      { type: 'truck', x: 38.25, z: 134, yaw: 0, drive: true, route: [[40, 120], [40, 200]], cruise: 9, paint: '#1f4f8a' },
      { type: 'sedan', x: 38.25, z: 100, yaw: 0, drive: true, route: [[40, 40], [40, 120]], cruise: 10, paint: '#d8d9db' },
    ],
    run: 3.0, camOrbit: 0.32, camPitch: 0.02,
  },
  showroom: { x: 32.4, z: 159.6, yaw: Math.PI * 0.62, run: 0, camYaw: 1.05, pitch: 0.1, dist: 7.2, time: 30 },
  closeup: { x: 36.9, z: 157.6, yaw: -Math.PI / 2, run: 0, camYaw: 0, pitch: 0.12, dist: 3.6, time: 30 },
  slide: {
    time: 30,
    car: { use: 'hero', x: 16, z: 38.25, yaw: -Math.PI / 2, speed: 21, paint: '#ffb000',
      before: { throttle: 1 }, input: { throttle: 0.6, steer: 1, handbrake: true }, inputAfter: 0.3 },
    run: 1.25, camOrbit: -1.15, camPitch: 0.05,
  },
  junction: {
    x: 33.2, z: 130.2, yaw: Math.PI * 0.85, run: 4.0, time: 37, camYaw: -2.25, pitch: 0.08, dist: 5.2,
    extra: [
      { type: 'truck', x: 41.75, z: 158, yaw: Math.PI, drive: true, route: [[40, 200], [40, 120]], cruise: 9 },
      { type: 'van', x: 41.75, z: 175, yaw: Math.PI, drive: true, route: [[40, 200], [40, 120]], cruise: 10 },
      { type: 'police', x: 38.25, z: 95, yaw: 0, drive: true, route: [[40, 40], [40, 120]], cruise: 8 },
      { type: 'suv', x: 22, z: 121.75, yaw: Math.PI / 2, drive: true, route: [[-40, 120], [40, 120]], cruise: 9 },
      { type: 'pickup', x: 35.15, z: 141, yaw: 0 },
    ],
  },
  arcade: { x: -8, z: -31.5, yaw: Math.PI / 2, wish: { x: 1, z: 0, sprint: false }, run: 1.4, camYaw: -0.6, pitch: 0.1, dist: 4.8 },
  // ---- PASS 6 visual probes
  // budget worst case: 20 parked cars of every type stacked down the avenue in all four lanes, in frame
  traffic: { x: 32.2, z: 204, yaw: Math.PI, run: 0, time: 30, camYaw: 0.12, pitch: 0.1, dist: 4.2, extra: TRAFFIC20 },
  // every type side by side at the kerb (fronts toward -z), framed by explicit cameras
  lineup: { x: 26, z: 120, yaw: 0, run: 0, time: 30, extra: LINEUP, hidePlayer: true, cam: { from: [50.2, 1.55, 174], to: [43.6, 0.7, 160], fov: 50 } },
  lineup34: { x: 26, z: 120, yaw: 0, run: 0, time: 30, extra: LINEUP, hidePlayer: true, cam: { from: [39.2, 1.45, 138.5], to: [44.6, 0.8, 147], fov: 50 } },
  sportsClose: { x: 26, z: 120, yaw: 0, run: 0, time: 30, extra: LINEUP, hidePlayer: true, cam: { from: [40.4, 1.25, 168.4], to: [44.85, 0.55, 173], fov: 45 } },
  // PASS 10a2: all 21 collection cars in view (probe_cars.mjs aims its close-ups with view())
  collection: { x: 26, z: 120, yaw: 0, run: 0, time: 30, extra: COLLECTION_ROWS, hidePlayer: true, cam: { from: [40, 3.6, 112], to: [40, 0.2, 150], fov: 60 } },
  collectionRear: { x: 26, z: 120, yaw: 0, run: 0, time: 30, extra: COLLECTION_ROWS, hidePlayer: true, cam: { from: [40, 3.4, 200], to: [40, 0.3, 165], fov: 60 } },
  // rear view of the line-up: tail, brake (none: parked) and plate lamps
  tails: { x: 26, z: 120, yaw: 0, run: 0, time: 30, extra: LINEUP, hidePlayer: true, cam: { from: [40.6, 1.5, 191.5], to: [44.85, 0.8, 181], fov: 50 } },
};
