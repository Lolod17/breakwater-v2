// Vehicle catalogue: real-world proportions (metres, kg) and per-type engine,
// gearbox, grip and handling numbers. Models and physics both read from here,
// so a sedan drives like it looks.

// Paint palettes per type (linear-ish sRGB hex, converted by THREE.Color).
const CIVIL = ['#9fa6ad', '#1d2633', '#e8e4dc', '#6b1c22', '#2f4f6f', '#34383d', '#c9b48a', '#3b5b4a', '#d8d9db', '#14161a'];

export const VEHICLE_TYPES = {
  sedan: {
    category: 'civilian', label: 'Mariner Sedan', length: 4.75, width: 1.83, height: 1.45, wheelbase: 2.80, frontAxle: 1.40, wheelR: 0.33, tyreW: 0.23,
    mass: 1450, torque: 320, redline: 6500, idle: 800, gears: [3.4, 2.1, 1.45, 1.08, 0.86], final: 3.7, top: 52, cyl: 4,
    grip: 1.0, steerLock: 0.62, cgH: 0.52, reverseTop: 9, paints: CIVIL,
  },
  sports: {
    category: 'sports', label: 'Veloce GT', length: 4.45, width: 1.95, height: 1.18, wheelbase: 2.55, frontAxle: 1.08, wheelR: 0.34, tyreW: 0.29,
    mass: 1350, torque: 560, redline: 8200, idle: 950, gears: [3.1, 2.15, 1.6, 1.25, 1.0, 0.82], final: 3.6, top: 78, cyl: 8,
    grip: 1.18, steerLock: 0.58, cgH: 0.42, reverseTop: 9, paints: ['#c8102e', '#ffb000', '#0a5ad6', '#f4f4f2', '#1a1a1c', '#ff5f1f', '#18a37a'],
  },
  suv: {
    category: 'civilian', label: 'Ridgeback SUV', length: 4.85, width: 1.96, height: 1.78, wheelbase: 2.86, frontAxle: 1.38, wheelR: 0.38, tyreW: 0.26,
    mass: 2100, torque: 470, redline: 6000, idle: 750, gears: [3.6, 2.2, 1.5, 1.12, 0.88, 0.72], final: 3.5, top: 50, cyl: 6,
    grip: 0.92, steerLock: 0.6, cgH: 0.72, reverseTop: 8, paints: CIVIL,
  },
  pickup: {
    category: 'utility', label: 'Haulmark Pickup', length: 5.6, width: 2.0, height: 1.88, wheelbase: 3.55, frontAxle: 1.85, wheelR: 0.40, tyreW: 0.27,
    mass: 2300, torque: 540, redline: 5600, idle: 700, gears: [3.8, 2.3, 1.5, 1.0, 0.75], final: 3.4, top: 48, cyl: 8,
    grip: 0.88, steerLock: 0.6, cgH: 0.75, reverseTop: 8, paints: ['#7a1f1b', '#203a5c', '#e3e1da', '#2d3a2a', '#1b1b1d', '#8a8f94', '#b5652a'],
  },
  van: {
    category: 'utility', label: 'Courier Van', length: 5.3, width: 2.0, height: 2.35, wheelbase: 3.30, frontAxle: 1.75, wheelR: 0.36, tyreW: 0.23,
    mass: 2400, torque: 380, redline: 5200, idle: 750, gears: [3.9, 2.3, 1.45, 1.0, 0.78], final: 3.9, top: 40, cyl: 4,
    grip: 0.85, steerLock: 0.62, cgH: 0.9, reverseTop: 7, paints: ['#f2f2ee', '#e9e6dc', '#bfc3c7', '#2b4a7a', '#c23b22', '#f2f2ee'],
  },
  truck: {
    category: 'utility', label: 'Atlas Cargo Truck', length: 8.2, width: 2.45, height: 3.45, wheelbase: 4.7, frontAxle: 2.9, wheelR: 0.50, tyreW: 0.32,
    mass: 7800, torque: 1500, redline: 2600, idle: 600, gears: [6.2, 3.8, 2.4, 1.6, 1.15, 0.86], final: 4.4, top: 29, cyl: 6,
    grip: 0.8, steerLock: 0.58, cgH: 1.25, reverseTop: 5, rearTandem: 1.35, paints: ['#d23b2a', '#1f4f8a', '#f0ede6', '#2e6b3a', '#e0a21b'],
  },
  police: {
    category: 'police', label: 'Harbour Patrol Cruiser', length: 5.05, width: 1.90, height: 1.52, wheelbase: 2.95, frontAxle: 1.45, wheelR: 0.35, tyreW: 0.25,
    mass: 1800, torque: 450, redline: 6400, idle: 800, gears: [3.3, 2.1, 1.5, 1.12, 0.88, 0.7], final: 3.4, top: 64, cyl: 8,
    grip: 1.05, steerLock: 0.6, cgH: 0.55, reverseTop: 10, paints: ['#101418'],
  },
  // ---- PASS 10a1 sports car collection. Handling fields (defaults in brackets,
  // read by vehicle.js): drive 'rwd' | 'awd' [rwd], brakes = brake force multiplier [1],
  // drift = 0..1 rear-end looseness: less rear lateral grip and stiffness, more
  // grip fall-off once sliding [0]. Audio (vehicleAudio.js): pitch = engine voice
  // pitch multiplier [1], rough = 0..1 grit / lope [0.5]. Render: headY / tailY lamp
  // glow heights, wheelStyle (vehicleModels.js WHEEL_STYLES).
  vortex: {
    category: 'hyper', label: 'Squall X1', length: 4.62, width: 2.06, height: 1.12, wheelbase: 2.72, frontAxle: 1.30, wheelR: 0.36, tyreW: 0.33,
    mass: 1420, torque: 900, redline: 8600, idle: 1000, gears: [3.0, 2.2, 1.7, 1.36, 1.12, 0.94, 0.8], final: 3.5, top: 96, cyl: 8,
    grip: 1.32, steerLock: 0.56, cgH: 0.38, reverseTop: 9, drive: 'awd', brakes: 1.4, drift: 0.05, pitch: 1.12, rough: 0.3,
    headY: 0.42, tailY: 0.74, wheelStyle: 'turbine', paints: ['#e8e9eb', '#101114', '#0a7bd6', '#ff5f1f', '#7fd13b', '#5b2a86'],
  },
  tempesta: {
    category: 'hyper', label: 'Riptide V12', length: 4.78, width: 2.02, height: 1.16, wheelbase: 2.80, frontAxle: 1.55, wheelR: 0.36, tyreW: 0.31,
    mass: 1560, torque: 780, redline: 9200, idle: 1000, gears: [3.1, 2.15, 1.62, 1.3, 1.08, 0.92, 0.79], final: 3.4, top: 93, cyl: 12,
    grip: 1.22, steerLock: 0.56, cgH: 0.4, reverseTop: 9, brakes: 1.3, drift: 0.25, pitch: 1.38, rough: 0.12,
    headY: 0.58, tailY: 0.72, wheelStyle: 'mesh10', paints: ['#b0101c', '#f2c200', '#1c1d21', '#e6e3da', '#14365e'],
  },
  stratos: {
    category: 'super', label: 'Cormorant R', length: 4.32, width: 1.98, height: 1.13, wheelbase: 2.60, frontAxle: 1.32, wheelR: 0.34, tyreW: 0.31,
    mass: 1300, torque: 560, redline: 8600, idle: 950, gears: [3.2, 2.2, 1.65, 1.3, 1.06, 0.88], final: 3.7, top: 84, cyl: 6,
    grip: 1.26, steerLock: 0.64, cgH: 0.4, reverseTop: 9, brakes: 1.25, drift: 0.18, pitch: 1.2, rough: 0.4,
    headY: 0.53, tailY: 0.75, wheelStyle: 'y5', paints: ['#f4f4f2', '#00875a', '#ff8c00', '#c8102e', '#2a2d33'],
  },
  corsa: {
    category: 'super', label: 'Fathom V10', length: 4.55, width: 2.0, height: 1.17, wheelbase: 2.65, frontAxle: 1.25, wheelR: 0.35, tyreW: 0.32,
    mass: 1420, torque: 620, redline: 8700, idle: 1000, gears: [3.15, 2.2, 1.65, 1.3, 1.07, 0.9, 0.78], final: 3.6, top: 89, cyl: 10,
    grip: 1.24, steerLock: 0.58, cgH: 0.41, reverseTop: 9, brakes: 1.3, drift: 0.1, pitch: 1.25, rough: 0.22,
    headY: 0.6, tailY: 0.78, wheelStyle: 'mono7', paints: ['#8dc63f', '#ffb000', '#5a5f66', '#0d0e10', '#e04a1f', '#2b55c8'],
  },
  phoenix: {
    category: 'sports', label: 'Kestrel R', length: 4.42, width: 1.86, height: 1.3, wheelbase: 2.60, frontAxle: 1.42, wheelR: 0.33, tyreW: 0.26,
    mass: 1380, torque: 480, redline: 7600, idle: 850, gears: [3.3, 2.2, 1.6, 1.25, 1.0, 0.84], final: 3.6, top: 72, cyl: 6,
    grip: 1.1, steerLock: 0.64, cgH: 0.46, reverseTop: 9, brakes: 1.1, drift: 0.4, pitch: 1.0, rough: 0.3,
    headY: 0.6, tailY: 0.78, wheelStyle: 'star5', paints: ['#d4421e', '#1b3f8b', '#e9e7e1', '#202226', '#c9a227', '#6d7378'],
  },
  driftline: {
    category: 'sports', label: 'Driftline Z', length: 4.32, width: 1.9, height: 1.28, wheelbase: 2.55, frontAxle: 1.35, wheelR: 0.32, tyreW: 0.27,
    mass: 1260, torque: 420, redline: 7800, idle: 900, gears: [3.4, 2.3, 1.65, 1.25, 1.0, 0.86], final: 4.1, top: 66, cyl: 4,
    grip: 0.98, steerLock: 0.8, cgH: 0.46, reverseTop: 9, brakes: 1.05, drift: 0.85, pitch: 0.95, rough: 0.6,
    headY: 0.62, tailY: 0.78, wheelStyle: 'dish6', paints: ['#f1f1ee', '#e4007c', '#1f7a8c', '#111214', '#f5d000', '#8a1c1c'],
  },
  thunder: {
    category: 'muscle', label: 'Thunder V8', length: 5.0, width: 1.96, height: 1.36, wheelbase: 2.95, frontAxle: 1.60, wheelR: 0.35, tyreW: 0.29,
    mass: 1760, torque: 720, redline: 6300, idle: 700, gears: [2.9, 1.95, 1.42, 1.1, 0.86, 0.7], final: 3.4, top: 80, cyl: 8,
    grip: 1.0, steerLock: 0.58, cgH: 0.52, reverseTop: 9, brakes: 0.82, drift: 0.55, pitch: 0.72, rough: 0.9,
    headY: 0.63, tailY: 0.75, wheelStyle: 'slot5', paints: ['#1a3e7a', '#e8a200', '#151618', '#8b0f14', '#e9e6dc', '#3d5a3a'],
  },
  monarch: {
    category: 'luxury', label: 'Monarch S', length: 5.25, width: 1.95, height: 1.5, wheelbase: 3.15, frontAxle: 1.65, wheelR: 0.36, tyreW: 0.26,
    mass: 2300, torque: 600, redline: 6600, idle: 650, gears: [3.6, 2.4, 1.6, 1.25, 1.0, 0.84, 0.7, 0.6], final: 3.2, top: 70, cyl: 12,
    grip: 1.02, steerLock: 0.56, cgH: 0.58, reverseTop: 8, brakes: 1.0, drift: 0.05, pitch: 0.85, rough: 0.04,
    headY: 0.74, tailY: 0.86, wheelStyle: 'multi14', paints: ['#0e0f12', '#e7e5df', '#3a3f47', '#4a1622', '#1d3a2f', '#b8b2a4'],
  },
  // ---- PASS 10a2: the rest of the 21-car collection. New fields: drive 'fwd' (front
  // axle drives, understeers), whine = 0..1 forced-induction whine in the engine voice
  // (vehicleAudio.js) [0], cabin = 'full' | 'simple': hollow cabin behind see-through
  // glass with a detailed cockpit or a simple dashboard (vehicleModels.js).
  nemesis: {
    category: 'hyper', label: 'Undertow GT', length: 4.95, width: 2.04, height: 1.1, wheelbase: 2.75, frontAxle: 1.36, wheelR: 0.36, tyreW: 0.33,
    mass: 1580, torque: 980, redline: 8300, idle: 950, gears: [2.95, 2.15, 1.66, 1.33, 1.1, 0.92, 0.78], final: 3.3, top: 101, cyl: 8,
    grip: 1.3, steerLock: 0.54, cgH: 0.37, reverseTop: 9, drive: 'awd', brakes: 1.45, drift: 0.04, pitch: 1.05, rough: 0.34, whine: 0.6,
    headY: 0.44, tailY: 0.8, wheelStyle: 'aero6', cabin: 'simple', paints: ['#d9dadc', '#0c0d10', '#ff4d00', '#2246a8', '#9b1b30', '#4b5320'],
  },
  inferno: {
    category: 'hyper', label: 'Brazier RS', length: 4.6, width: 2.02, height: 1.08, wheelbase: 2.68, frontAxle: 1.3, wheelR: 0.35, tyreW: 0.34,
    mass: 1280, torque: 720, redline: 9800, idle: 1100, gears: [3.2, 2.3, 1.76, 1.4, 1.15, 0.97, 0.84], final: 3.7, top: 92, cyl: 12,
    grip: 1.38, steerLock: 0.6, cgH: 0.35, reverseTop: 9, brakes: 1.55, drift: 0.16, pitch: 1.5, rough: 0.14,
    headY: 0.5, tailY: 0.72, wheelStyle: 'center5', cabin: 'full', paints: ['#c40f1b', '#101114', '#f2f2ef', '#ffcc00', '#2a7d4f', '#1a4fd0'],
  },
  venom: {
    category: 'super', label: 'Lionfish GT', length: 4.7, width: 1.98, height: 1.14, wheelbase: 2.72, frontAxle: 1.28, wheelR: 0.35, tyreW: 0.33,
    mass: 1300, torque: 850, redline: 7400, idle: 900, gears: [2.8, 2.0, 1.52, 1.22, 1.0, 0.84], final: 3.4, top: 95, cyl: 8,
    grip: 1.19, steerLock: 0.56, cgH: 0.4, reverseTop: 9, brakes: 1.2, drift: 0.32, pitch: 0.95, rough: 0.56, whine: 0.8,
    headY: 0.55, tailY: 0.8, wheelStyle: 'split10', cabin: 'simple', paints: ['#e8e9e6', '#0f6ad1', '#121316', '#e2b400', '#7d0f1e', '#ff6a13'],
  },
  spectre: {
    category: 'super', label: 'Halyard 720', length: 4.55, width: 1.96, height: 1.18, wheelbase: 2.67, frontAxle: 1.3, wheelR: 0.35, tyreW: 0.31,
    mass: 1420, torque: 770, redline: 8400, idle: 950, gears: [3.1, 2.2, 1.66, 1.32, 1.08, 0.9, 0.77], final: 3.55, top: 91, cyl: 8,
    grip: 1.27, steerLock: 0.57, cgH: 0.4, reverseTop: 9, brakes: 1.36, drift: 0.12, pitch: 1.16, rough: 0.3, whine: 0.5,
    headY: 0.57, tailY: 0.82, wheelStyle: 'aero6', cabin: 'full', paints: ['#ff7a00', '#e9eae7', '#2b2f36', '#00a0b0', '#5d1a8a', '#b5121b'],
  },
  reaper: {
    category: 'super', label: 'Moray SV', length: 4.8, width: 2.05, height: 1.13, wheelbase: 2.7, frontAxle: 1.34, wheelR: 0.36, tyreW: 0.34,
    mass: 1550, torque: 730, redline: 8900, idle: 1000, gears: [3.15, 2.2, 1.65, 1.32, 1.08, 0.9, 0.78], final: 3.5, top: 90, cyl: 12,
    grip: 1.29, steerLock: 0.55, cgH: 0.39, reverseTop: 9, drive: 'awd', brakes: 1.32, drift: 0.07, pitch: 1.3, rough: 0.22,
    headY: 0.56, tailY: 0.78, wheelStyle: 'blade5', cabin: 'simple', paints: ['#5c6b1f', '#f2b705', '#111214', '#e6e6e3', '#c21d1d', '#3d2b6b'],
  },
  carbon: {
    category: 'sports', label: 'Flint S', length: 3.95, width: 1.8, height: 1.15, wheelbase: 2.38, frontAxle: 1.18, wheelR: 0.31, tyreW: 0.25,
    mass: 1050, torque: 380, redline: 7600, idle: 900, gears: [3.3, 2.25, 1.68, 1.32, 1.08, 0.9], final: 4.0, top: 70, cyl: 4,
    grip: 1.22, steerLock: 0.68, cgH: 0.4, reverseTop: 9, brakes: 1.25, drift: 0.22, pitch: 1.1, rough: 0.46, whine: 0.7,
    headY: 0.6, tailY: 0.76, wheelStyle: 'split10', cabin: 'simple', paints: ['#f2c500', '#1c1d20', '#e8e8e4', '#d11d4d', '#0d8f6f', '#3858d6'],
  },
  apex: {
    category: 'sports', label: 'Apex GT', length: 4.5, width: 1.9, height: 1.28, wheelbase: 2.45, frontAxle: 1.32, wheelR: 0.34, tyreW: 0.3,
    mass: 1480, torque: 520, redline: 8800, idle: 900, gears: [3.4, 2.3, 1.7, 1.33, 1.08, 0.9, 0.76], final: 3.6, top: 83, cyl: 6,
    grip: 1.21, steerLock: 0.6, cgH: 0.44, reverseTop: 9, brakes: 1.32, drift: 0.16, pitch: 1.18, rough: 0.5,
    headY: 0.62, tailY: 0.84, wheelStyle: 'center5', cabin: 'full', paints: ['#9aa0a6', '#1e3d2f', '#f1f0ea', '#0f1012', '#e04f1a', '#6a8fbf'],
  },
  nightshade: {
    category: 'sports', label: 'Nocturne', length: 4.62, width: 1.96, height: 1.34, wheelbase: 2.7, frontAxle: 1.42, wheelR: 0.34, tyreW: 0.29,
    mass: 1580, torque: 560, redline: 7200, idle: 850, gears: [3.3, 2.2, 1.6, 1.25, 1.0, 0.82], final: 3.7, top: 80, cyl: 6,
    grip: 1.15, steerLock: 0.6, cgH: 0.47, reverseTop: 9, drive: 'awd', brakes: 1.16, drift: 0.1, pitch: 1.0, rough: 0.4, whine: 0.9,
    headY: 0.62, tailY: 0.86, wheelStyle: 'blade5', cabin: 'simple', paints: ['#17181b', '#3b2a5e', '#2c4b6e', '#8a8d91', '#6b0d0d', '#e9e9e6'],
  },
  bullet: {
    category: 'sports', label: 'Tracer RS', length: 4.1, width: 1.82, height: 1.44, wheelbase: 2.62, frontAxle: 1.08, wheelR: 0.33, tyreW: 0.24,
    mass: 1250, torque: 400, redline: 6900, idle: 850, gears: [3.5, 2.1, 1.48, 1.14, 0.94, 0.8], final: 3.9, top: 68, cyl: 4,
    grip: 1.08, steerLock: 0.66, cgH: 0.52, reverseTop: 9, drive: 'fwd', brakes: 1.14, drift: 0, pitch: 1.05, rough: 0.6, whine: 0.6,
    headY: 0.72, tailY: 0.98, wheelStyle: 'split10', cabin: 'simple', paints: ['#d0101e', '#f3f3f0', '#0a3a8c', '#222326', '#c8d400', '#7a7f85'],
  },
  ironclad: {
    category: 'muscle', label: 'Ironclad 69', length: 4.85, width: 1.9, height: 1.32, wheelbase: 2.82, frontAxle: 1.5, wheelR: 0.36, tyreW: 0.27,
    mass: 1650, torque: 680, redline: 5800, idle: 650, gears: [2.6, 1.8, 1.32, 1.0], final: 3.7, top: 74, cyl: 8,
    grip: 0.92, steerLock: 0.56, cgH: 0.55, reverseTop: 8, brakes: 0.75, drift: 0.62, pitch: 0.64, rough: 1.0,
    headY: 0.68, tailY: 0.76, wheelStyle: 'slot5', cabin: 'simple', paints: ['#2f6b2f', '#c2a14a', '#7c1416', '#e7e2d2', '#1b2c58', '#e66d10'],
  },
  dominator: {
    category: 'muscle', label: 'Bulwark XR', length: 5.02, width: 1.98, height: 1.4, wheelbase: 2.98, frontAxle: 1.56, wheelR: 0.36, tyreW: 0.31,
    mass: 1900, torque: 880, redline: 6500, idle: 700, gears: [2.7, 1.9, 1.4, 1.1, 0.88, 0.72, 0.6], final: 3.3, top: 80, cyl: 8,
    grip: 1.04, steerLock: 0.57, cgH: 0.52, reverseTop: 9, brakes: 1.02, drift: 0.46, pitch: 0.78, rough: 0.82, whine: 1.0,
    headY: 0.7, tailY: 0.86, wheelStyle: 'blade5', cabin: 'full', paints: ['#101114', '#b80e1a', '#e7e7e4', '#f2a900', '#2a4b8d', '#4a4e55'],
  },
  royale: {
    category: 'luxury', label: 'Royale GT', length: 4.85, width: 1.98, height: 1.38, wheelbase: 2.85, frontAxle: 1.5, wheelR: 0.36, tyreW: 0.28,
    mass: 2250, torque: 900, redline: 6400, idle: 650, gears: [3.5, 2.4, 1.66, 1.3, 1.05, 0.88, 0.74, 0.64], final: 3.0, top: 88, cyl: 12,
    grip: 1.08, steerLock: 0.56, cgH: 0.5, reverseTop: 9, drive: 'awd', brakes: 1.15, drift: 0.04, pitch: 0.95, rough: 0.08, whine: 0.3,
    headY: 0.68, tailY: 0.86, wheelStyle: 'multi14', cabin: 'full', paints: ['#203a2c', '#e5e2da', '#0d0e11', '#5a1b26', '#7d8590', '#2a3550'],
  },
  executive: {
    category: 'luxury', label: 'Executive V12', length: 5.35, width: 1.94, height: 1.46, wheelbase: 3.2, frontAxle: 1.62, wheelR: 0.36, tyreW: 0.26,
    mass: 2150, torque: 760, redline: 6200, idle: 600, gears: [3.6, 2.4, 1.6, 1.25, 1.0, 0.82, 0.68, 0.58], final: 3.1, top: 72, cyl: 12,
    grip: 1.03, steerLock: 0.55, cgH: 0.56, reverseTop: 8, brakes: 1.06, drift: 0.06, pitch: 0.9, rough: 0.05,
    headY: 0.72, tailY: 0.9, wheelStyle: 'split10', cabin: 'simple', paints: ['#121317', '#c7c9cc', '#2d3238', '#e4e1d9', '#3b1f2b', '#1e3b5a'],
  },
};

export const TYPE_NAMES = Object.keys(VEHICLE_TYPES);
// PASS 10a1 collection categories; police and the utility / civilian bodies stay apart.
export const SPORT_CATEGORIES = ['hyper', 'super', 'sports', 'muscle', 'luxury'];
export const COLLECTION = TYPE_NAMES.filter((n) => SPORT_CATEGORIES.includes(VEHICLE_TYPES[n].category) && n !== 'sports');

// Derived constants used by the physics. Drag is chosen so the engine force in top
// gear just balances it at the type's top speed.
for (const [name, t] of Object.entries(VEHICLE_TYPES)) {
  t.name = name;
  t.drive ??= 'rwd'; t.brakes ??= 1; t.drift ??= 0; t.pitch ??= 1; t.rough ??= 0.5; t.whine ??= 0; t.wheelStyle ??= 'twin5';
  t.tier = SPORT_CATEGORIES.includes(t.category) ? t.category : null;   // collection tier (catalogue.js)
  // PASS 17e sprung-body pitch (visual only): softness per category, scaled by CG height.
  // diveGrad / squatGrad in rad per m/s^2, clamps in rad, pitchK the pitch spring rate.
  const SUSP = { hyper: [0.78, 3.0, 200], super: [0.84, 3.0, 190], sports: [0.95, 3.0, 175], muscle: [1.3, 4.0, 125],
    luxury: [1.3, 4.0, 120], civilian: [1.2, 4.0, 135], utility: [1.25, 4.0, 115], police: [1.05, 3.5, 150] }[t.category] || [1.1, 4.0, 140];
  t.dive ??= SUSP[0];
  const g = 0.0335 / 9.81 * t.dive * Math.pow(t.cgH / 0.45, 0.6);   // ~1.9 deg per g at dive 1, cgH 0.45
  t.diveGrad = g; t.squatGrad = g * 0.5;
  t.diveMax = SUSP[1] * Math.PI / 180; t.squatMax = t.diveMax * 0.6;
  t.pitchK = SUSP[2];
  t.bodyAxMax = 9.81 * 1.6;
  t.rearAxle = t.frontAxle - t.wheelbase;                 // z of the (mid) rear axle, car space (+z forward)
  t.a = t.frontAxle;                                       // CG (origin) to front axle
  t.b = -t.rearAxle;                                       // CG to rear axle
  const topForce = t.torque * 0.8 * t.gears[t.gears.length - 1] * t.final / t.wheelR * 0.85;
  t.drag = topForce / (t.top * t.top);
  t.inertia = t.mass * (t.length * t.length + t.width * t.width) / 12 * 1.1;
  t.radius = t.width / 2 * 1.02;                           // collision circle radius
  const n = Math.max(2, Math.ceil((t.length - t.width) / (t.radius * 0.9)) + 1);
  t.circles = [];
  const span = t.length / 2 - t.radius;
  for (let i = 0; i < n; i++) t.circles.push(-span + (2 * span * i) / (n - 1));
  t.doorZ = t.frontAxle - (t.name === 'truck' || t.name === 'van' ? 0.55 : 1.15); // driver door handle position
}
