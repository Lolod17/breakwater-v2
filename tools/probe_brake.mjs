// PASS 17e brake-dive probe (node only, real Vehicle dynamics, flat ground, 1/120 s step).
// For every civilian (non-police) type: full brakes from ~100 km/h and from ~40 km/h,
// released at the stop (as a player does, so the held brake does not select reverse),
// then 3 s of coast. Records the peak nose-down dive (deg), the rebound past level after
// the stop (deg, nose up), and the number of overshoots after the stop (pitch swings
// past its rest value by more than 0.15 deg). Launch: full throttle from rest for 2.5 s,
// peak squat (deg, nose up). Also the 100-0 stopping distance, to show it did not change.
//   node tools/probe_brake.mjs [--json] [--out=file.json] [--check]
import { writeFileSync } from 'node:fs';
import { Vehicle } from '../game/src/vehicles/vehicle.js';
import { VEHICLE_TYPES } from '../game/src/vehicles/vehicleTypes.js';

const argv = process.argv.slice(2);
const DT = 1 / 120, KMH = 3.6, DEG = 180 / Math.PI;

function make(id) {
  const v = new Vehicle(1, id, null);
  v.driver = { update() {} };
  v.place(0, 0, 0);
  v.step = () => { v.savePrev(); v.dynamics(DT); v.x += v.vx * DT; v.z += v.vz * DT; v.yaw += v.r * DT; };
  return v;
}

function brakeRun(id, kmh) {
  const v = make(id);
  v.ctrl.throttle = 1;
  while (v.fwd * KMH < kmh) v.step();
  // hold the speed briefly on part throttle so launch squat has settled before braking
  v.ctrl.throttle = 0;
  for (let i = 0; i < 120; i++) { v.step(); }
  v.ctrl.brake = 1;
  let peak = 0, dist = 0, t = 0;
  while (v.fwd > 0.6 && t < 30) { const s = v.fwd; v.step(); dist += (s + Math.max(0, v.fwd)) / 2 * DT; t += DT; peak = Math.max(peak, v.pitch); }
  v.ctrl.brake = 0;
  // after the stop: 3 s settle
  const trace = [];
  for (let i = 0; i < 360; i++) { v.step(); trace.push(v.pitch); peak = Math.max(peak, v.pitch); }
  const rest = trace[trace.length - 1];
  let rebound = 0, over = 0, sign = 0;
  const thr = 0.15 / DEG;
  for (const p of trace) {
    rebound = Math.max(rebound, -(p - rest));
    const d = p - rest;
    if (Math.abs(d) > thr) { const sg = Math.sign(d); if (sg !== sign) { if (sign !== 0) over++; sign = sg; } }
  }
  return { peak: peak * DEG, rebound: rebound * DEG, overshoots: over, dist, brakeT: t };
}

function launchRun(id) {
  const v = make(id);
  v.ctrl.throttle = 1;
  let squat = 0;
  for (let i = 0; i < 300; i++) { v.step(); squat = Math.max(squat, -v.pitch); }
  return squat * DEG;
}

const rows = [];
for (const [id, t] of Object.entries(VEHICLE_TYPES)) {
  if (t.category === 'police') continue;
  const hi = brakeRun(id, 100), lo = brakeRun(id, 40), sq = launchRun(id);
  rows.push({ id, cat: t.category, cgH: t.cgH, brakes: t.brakes,
    dive100: +hi.peak.toFixed(2), dive40: +lo.peak.toFixed(2),
    rebound100: +hi.rebound.toFixed(2), rebound40: +lo.rebound.toFixed(2),
    over100: hi.overshoots, over40: lo.overshoots, squat: +sq.toFixed(2), stop100m: +hi.dist.toFixed(2) });
}

if (argv.includes('--json')) console.log(JSON.stringify(rows, null, 1));
else {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('car', 11) + pad('cat', 9) + pad('cgH', 5) + pad('dive100', 8) + pad('dive40', 7) + pad('rebnd100', 9) + pad('rebnd40', 8) + pad('osc100', 7) + pad('osc40', 6) + pad('squat', 6) + 'stop100 m');
  for (const r of rows) console.log(pad(r.id, 11) + pad(r.cat, 9) + pad(r.cgH, 5) + pad(r.dive100, 8) + pad(r.dive40, 7) + pad(r.rebound100, 9) + pad(r.rebound40, 8) + pad(r.over100, 7) + pad(r.over40, 6) + pad(r.squat, 6) + r.stop100m);
}
const outArg = argv.find((a) => a.startsWith('--out='));
if (outArg) writeFileSync(outArg.slice(6), JSON.stringify(rows, null, 1));

if (argv.includes('--check')) {
  const fails = [];
  const sporty = ['hyper', 'super', 'sports'];
  for (const r of rows) {
    const max = sporty.includes(r.cat) ? 3.0 : r.cat === 'utility' && r.id === 'truck' ? 4.5 : 4.0;
    const min = sporty.includes(r.cat) ? 1.5 : 1.2;
    if (r.dive100 > max || r.dive100 < min) fails.push(`${r.id}: dive ${r.dive100} deg outside ${min}-${max}`);
    if (r.squat >= r.dive100) fails.push(`${r.id}: squat ${r.squat} >= dive ${r.dive100}`);
    if (r.over100 > 1 || r.over40 > 1) fails.push(`${r.id}: bounces after stop (${r.over100}/${r.over40})`);
  }
  const dives = new Set(rows.map((r) => r.dive100.toFixed(1)));
  if (dives.size < 8) fails.push(`only ${dives.size} distinct dive values: cars feel the same`);
  console.log(fails.length ? 'FAIL\n  ' + fails.join('\n  ') : 'PASS');
  process.exitCode = fails.length ? 1 : 0;
}
