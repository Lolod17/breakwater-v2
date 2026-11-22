// One vehicle: state, controls and the arcade-realistic dynamics for a fixed step.
// Bicycle model in the ISO body frame (x forward, y left, yaw positive = left):
// slip-angle tyre forces with a friction circle, load transfer under braking and
// acceleration, rear-wheel drive through a torque curve and an automatic gearbox,
// speed-sensitive steering, a handbrake that locks the rears into a slide, and a
// per-type character (PASS 10a1): rear-, all- or (PASS 10a2) front-wheel drive, brake strength and a
// drift tendency that loosens the rear axle. Also a
// sprung body (pitch, roll, heave) that follows the accelerations and the kerbs.
// Positions are integrated by VehicleManager in swept substeps with collisions.
import { VEHICLE_TYPES } from './vehicleTypes.js';

const G = 9.81;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Vehicle {
  constructor(id, typeName, paint) {
    this.id = id;
    this.type = VEHICLE_TYPES[typeName];
    this.paint = paint;                        // THREE.Color
    this.x = 0; this.z = 0; this.yaw = 0;
    this.vx = 0; this.vz = 0; this.r = 0;      // world velocity, yaw rate
    this.px = 0; this.pz = 0; this.pyaw = 0;   // previous step, for render interpolation
    this.steer = 0;                            // actual front wheel angle (rad, + = left)
    this.gear = 1; this.rpm = this.type.idle; this.shift = 0;
    this.ctrl = { throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false };
    this.driver = null;                        // null | 'player' | AI driver object
    this.sleeping = false; this._still = 0;
    // sprung body
    this.pitch = 0; this.roll = 0; this.heave = 0; this.dPitch = 0; this.dRoll = 0; this.dHeave = 0;
    this.prevPitch = 0; this.prevRoll = 0; this.prevHeave = 0;
    this.gPitch = 0; this.gRoll = 0; this.gY = 0;     // ground plane under the wheels (kerbs)
    this.ax = 0; this.ay = 0; this.axB = 0;   // axB: filtered accel for the sprung body only
    const nW = this.type.rearTandem ? 6 : 4;
    this.wheelSpin = new Float32Array(nW); this.prevSpin = new Float32Array(nW);
    this.wheelH = new Float32Array(nW);
    this.lamps = { brake: 0, reverse: 0, head: 1, siren: 0 };
    this.slip = 0;         // 0..1 how hard the rear tyres are sliding / spinning
    this.slipF = 0;
    this.impact = 0;       // largest velocity change from a hit this step (m/s)
    this.speed = 0; this.fwd = 0;
    this.sirenOn = typeName === 'police' ? 0 : -1;
    this.horn = false;
  }

  place(x, z, yaw) {
    this.x = this.px = x; this.z = this.pz = z; this.yaw = this.pyaw = yaw;
    this.vx = this.vz = this.r = 0; this.steer = 0; this.gear = 1; this.rpm = this.type.idle;
    this.pitch = this.roll = this.heave = this.dPitch = this.dRoll = this.dHeave = 0; this.axB = 0;
    this.sleeping = !this.driver;
    this.lamps.head = this.driver ? 1 : 0;
    this.wheelH.fill(-1);
  }

  // Wheel positions in car space: [x, z, isFront] (x + = left)
  wheels() {
    if (this._wheels) return this._wheels;
    const t = this.type, hx = t.width / 2 - t.tyreW / 2 - 0.04;
    const out = [[hx, t.frontAxle, true], [-hx, t.frontAxle, true]];
    if (t.rearTandem) for (const dz of [t.rearTandem / 2, -t.rearTandem / 2]) out.push([hx, t.rearAxle + dz, false], [-hx, t.rearAxle + dz, false]);
    else out.push([hx, t.rearAxle, false], [-hx, t.rearAxle, false]);
    return (this._wheels = out);
  }

  savePrev() {
    this.px = this.x; this.pz = this.z; this.pyaw = this.yaw;
    this.prevPitch = this.pitch; this.prevRoll = this.roll; this.prevHeave = this.heave;
    this.prevSpin.set(this.wheelSpin);
  }

  wake() { this.sleeping = false; this._still = 0; }

  // Forces and velocity update for one fixed step. Positions move later (swept).
  dynamics(dt) {
    const t = this.type, c = this.ctrl;
    const s = Math.sin(this.yaw), co = Math.cos(this.yaw);
    // body frame: forward f = (s, co), left l = (co, -s)
    let vxl = this.vx * s + this.vz * co;
    let vyl = this.vx * co - this.vz * s;
    const speed = Math.hypot(vxl, vyl);
    const L = t.wheelbase, a = t.a, b = t.b, m = t.mass;

    // ---- gear selection: S brakes when rolling forward, reverses when stopped (and W the other way round)
    let drive = 0, brake = 0;
    if (c.throttle > 0) { if (vxl < -0.6) brake = c.throttle; else { drive = c.throttle; if (this.gear < 0) this.gear = 1; } }
    if (c.brake > 0) { if (vxl > 0.6) brake = Math.max(brake, c.brake); else if (c.throttle <= 0) { drive = -c.brake; this.gear = -1; } }

    // ---- engine and automatic gearbox
    const ratio = this.gear < 0 ? t.gears[0] * 1.15 : t.gears[this.gear - 1];
    const wheelRpm = Math.abs(vxl) / t.wheelR * 60 / (2 * Math.PI);
    let rpm = wheelRpm * ratio * t.final;
    const launch = t.idle + Math.abs(drive) * (t.redline * 0.42);      // clutch slip at launch
    if (rpm < launch && Math.abs(vxl) < 8) rpm = rpm + (launch - rpm) * (1 - Math.abs(vxl) / 8);
    rpm = Math.max(t.idle, rpm);
    if (this.shift > 0) this.shift -= dt;
    else if (this.gear > 0) {
      // automatic: shifts early on part throttle, hangs to the redline on full throttle
      const upAt = t.redline * (0.55 + 0.38 * Math.max(0, drive));
      if (rpm > upAt && this.gear < t.gears.length && brake === 0) { this.gear++; this.shift = 0.22; }
      else if (this.gear > 1 && rpm < t.redline * 0.42) { this.gear--; this.shift = 0.12; }
    }
    this.rpm += (Math.min(rpm, t.redline * 1.02) - this.rpm) * Math.min(1, dt * 14);
    const x = clamp((this.rpm - t.idle) / (t.redline - t.idle), 0, 1);
    const curve = 0.62 + 0.38 * Math.sin(Math.PI * (0.18 + 0.8 * x));   // broad torque peak around 60 % of the rev range
    const limiter = this.rpm >= t.redline ? 0.15 : 1;
    let Fdrive = drive * t.torque * curve * ratio * t.final / t.wheelR * 0.85 * limiter * (this.shift > 0 ? 0.25 : 1);
    if (this.gear < 0 && vxl < -t.reverseTop) Fdrive = 0;

    // ---- load transfer and grip
    const h = t.cgH;
    const Nf = clamp(m * G * b / L - m * this.ax * h / L, m * G * 0.12, m * G * 0.88);
    const Nr = m * G - Nf;
    const mu = t.grip * 1.05;
    // drift tendency: a looser rear axle (less lateral grip, softer build-up, more fall-off past the peak)
    const muR = mu * (1 - 0.1 * t.drift) * (c.handbrake ? 0.42 : 1);
    const awd = t.drive === 'awd', fwd = t.drive === 'fwd';
    // driven wheels limited by traction (excess becomes wheelspin); AWD uses both axles, 40/60 split;
    // FWD drives the fronts, so weight moving back under acceleration costs traction (PASS 10a2)
    const tracR = awd ? muR * Nr + mu * Nf * 0.9 : fwd ? mu * Nf : muR * Nr;
    let spin = 0;
    if (Math.abs(Fdrive) > tracR * 0.95) { spin = clamp((Math.abs(Fdrive) / tracR - 0.95) * 2, 0, 1) * (speed < 18 ? 1 : 0.3); Fdrive = Math.sign(Fdrive) * tracR * 0.95; }

    // brakes: 65/35 split, each limited by its axle's grip; the handbrake locks the rears
    const sv = Math.sign(vxl);
    let Fxf = awd ? Fdrive * 0.4 : fwd ? Fdrive : 0, Fxr = awd ? Fdrive * 0.6 : fwd ? 0 : Fdrive;
    const bk = brake * t.brakes * m * G;
    if (brake > 0) { Fxf -= sv * Math.min(bk * 0.62, mu * Nf); Fxr -= sv * Math.min(bk * 0.34, muR * Nr); }
    if (c.handbrake && Math.abs(vxl) > 0.3) Fxr = -sv * muR * Nr * 0.75;

    // ---- steering: lock shrinks with speed, rate-limited, self-centring
    const lock = t.steerLock / (1 + speed / 13);
    const target = -c.steer * lock;
    const rate = (Math.abs(target) < Math.abs(this.steer) ? 3.2 : 2.2) * t.steerLock;
    this.steer += clamp(target - this.steer, -rate * dt, rate * dt);
    const d = this.steer;

    // ---- lateral tyre forces (slip angles, friction circle, sliding friction past the peak)
    let Fyf = 0, Fyr = 0;
    const vden = Math.max(Math.abs(vxl), 2.5);
    const af = Math.atan2(vyl + a * this.r, vden) - d * (vxl >= 0 ? 1 : -1);
    const ar = Math.atan2(vyl - b * this.r, vden);
    const tyre = (alpha, N, muAx, Fx, stiff, fall = 0.18) => {
      const max = Math.sqrt(Math.max(0, (muAx * N) ** 2 - Fx * Fx));
      const lin = -stiff * N * alpha;
      const peak = muAx * N;
      if (Math.abs(lin) <= max) return lin;
      const over = Math.min(1, (Math.abs(lin) - peak) / peak);
      return Math.sign(lin) * max * (1 - fall * Math.max(0, over));
    };
    Fyf = tyre(af, Nf, mu, Fxf, 9.5);
    Fyr = tyre(ar, Nr, muR, Fxr, (c.handbrake ? 6 : 11) * (1 - 0.3 * t.drift), 0.18 + 0.22 * t.drift);

    // ---- body forces, drag, rolling resistance
    const cd = Math.cos(d), sd = Math.sin(d);
    let Fx = Fxr + Fxf * cd - Fyf * sd;
    let Fy = Fyr + Fyf * cd + Fxf * sd;
    Fx -= t.drag * vxl * Math.abs(vxl) + sv * m * 0.12 * Math.min(1, Math.abs(vxl));
    Fy -= t.drag * 2 * vyl * Math.abs(vyl);
    const torque = a * (Fyf * cd + Fxf * sd) - b * Fyr;

    const axl = Fx / m, ayl = Fy / m;
    vxl += axl * dt;
    vyl += ayl * dt;
    this.r += (torque / t.inertia) * dt;

    // low speed: blend towards the kinematic bicycle (no slip-angle jitter when crawling)
    const lowK = clamp(1 - speed / 4, 0, 1);
    if (lowK > 0) {
      const rKin = vxl * Math.tan(d) / L;
      this.r += (rKin - this.r) * Math.min(1, lowK * dt * 12);
      vyl *= 1 - Math.min(1, lowK * dt * 10);
    }
    if (brake > 0 && Math.abs(vxl) < 0.6) vxl *= 0.8;
    if (drive === 0 && brake === 0 && speed < 0.15) { vxl = 0; vyl = 0; this.r *= 0.5; }
    this.r *= 1 - Math.min(1, dt * 0.6);

    this.vx = vxl * s + vyl * co;
    this.vz = vxl * co - vyl * s;
    // smoothed accelerations for load transfer and the body
    this.ax += (axl - this.ax) * Math.min(1, dt * 10);
    this.ay += (vxl * this.r - this.ay) * Math.min(1, dt * 10);
    this.fwd = vxl;
    this.speed = Math.hypot(this.vx, this.vz);

    // ---- feedback state
    const slideR = Math.max(0, Math.abs(ar) - 0.1) * 3 * clamp(speed / 6, 0, 1);
    const lockR = c.handbrake && speed > 3 ? 0.8 : 0;
    this.slip = clamp(Math.max(slideR, lockR, spin, brake > 0.8 && speed > 12 && Math.abs(Fxf) >= mu * Nf * 0.99 ? 0.5 : 0), 0, 1);
    this.slipF = clamp(Math.max(0, Math.abs(af) - 0.14) * 3 * clamp(speed / 6, 0, 1), 0, 1);
    this.lamps.brake = brake > 0.05 || (c.handbrake && speed > 0.5) ? 1 : 0;
    this.lamps.reverse = this.gear < 0 ? 1 : 0;
    this.lamps.head = this.driver ? 1 : 0;

    // ---- wheel spin (rears: locked under handbrake, faster on wheelspin)
    const wl = this.wheels();
    for (let i = 0; i < wl.length; i++) {
      let w = vxl / t.wheelR;
      if (!wl[i][2]) { if (c.handbrake) w = 0; else if (t.drive !== 'fwd') w += Math.sign(drive || 1) * spin * 40; }
      else if (t.drive === 'fwd') w += Math.sign(drive || 1) * spin * 40;
      this.wheelSpin[i] += w * dt;
    }

    // ---- sprung body: pitch from longitudinal accel, roll from lateral, heave from kerbs
    // PASS 17e: the body reads its own accel signal (this.ax stays as it was for load transfer).
    // The force accel is spike-clamped, low-passed and jerk-limited, and held at zero once the car
    // is stopped, so the brake force vanishing at lock-up eases the nose back instead of
    // springing it. Dive and squat have per-type gradients (squat smaller: anti-squat) and are
    // clamped per type; the pitch spring is near-critically damped (one small rebound at most).
    const stopped = Math.abs(vxl) < 0.6 && Math.abs(drive) < 0.05;
    const axIn = stopped ? 0 : clamp(axl, -t.bodyAxMax, t.bodyAxMax);
    const jerk = 80 * dt;
    this.axB += clamp((axIn - this.axB) * Math.min(1, dt * 7), -jerk, jerk);
    const tp = this.axB < 0 ? Math.min(-this.axB * t.diveGrad, t.diveMax) : -Math.min(this.axB * t.squatGrad, t.squatMax);
    const tr = clamp(this.ay * 0.014 * (h / 0.55), -0.11, 0.11);
    const k = 140, cdmp = 2 * 0.38 * Math.sqrt(k);
    const kp = t.pitchK, cp = 2 * 0.74 * Math.sqrt(kp);
    this.dPitch += (kp * (tp - this.pitch) - cp * this.dPitch) * dt; this.pitch += this.dPitch * dt;
    this.dRoll += (k * 0.8 * (tr - this.roll) - cdmp * 0.9 * this.dRoll) * dt; this.roll += this.dRoll * dt;
    this.dHeave += (-k * 1.2 * this.heave - cdmp * 1.1 * this.dHeave) * dt; this.heave += this.dHeave * dt;

    // police lights
    // lamps.siren in [1, 2): the shader reads >= 1 as on and the fraction as the flash phase.
    // (The old form kept JS's negative remainder and never reached 1, so the bar never lit.)
    if (this.sirenOn > 0) this.lamps.siren = 1 + (((this.lamps.siren % 1) + dt * 1.6) % 1);
    else this.lamps.siren = 0;

    // sleep when parked and still
    if (!this.driver && speed < 0.05 && Math.abs(this.r) < 0.05) { this._still += dt; if (this._still > 1) this.sleeping = true; }
    else this._still = 0;
  }

  // Ground plane from the wheel contact heights (kerbs, pavements).
  settle(ground, dt) {
    const s = Math.sin(this.yaw), co = Math.cos(this.yaw);
    const wl = this.wheels();
    let hf = 0, hr = 0, hl = 0, hrt = 0, nf = 0, nr = 0, nl = 0, nrt = 0;
    for (let i = 0; i < wl.length; i++) {
      const [lx, lz, front] = wl[i];
      const wx = this.x + co * lx + s * lz, wz = this.z - s * lx + co * lz;
      const hgt = ground(wx, wz);
      const prev = this.wheelH[i];
      this.wheelH[i] = hgt;
      if (prev >= 0 && Math.abs(hgt - prev) > 0.05) {
        // a wheel climbed or dropped a kerb: jolt the body
        const up = hgt > prev ? 1 : -0.6;
        this.dHeave += up * 0.5 * Math.min(1, this.speed / 6 + 0.3);
        this.dPitch += (front ? -1 : 1) * up * 0.8 * Math.min(1, this.speed / 8 + 0.2);
        this.dRoll += (lx > 0 ? 1 : -1) * up * 0.6 * Math.min(1, this.speed / 8 + 0.2);
        this.bump = Math.max(this.bump || 0, up > 0 ? 0.35 : 0.15);
      }
      if (front) { hf += hgt; nf++; } else { hr += hgt; nr++; }
      if (lx > 0) { hl += hgt; nl++; } else { hrt += hgt; nrt++; }
    }
    hf /= nf; hr /= nr; hl /= nl; hrt /= nrt;
    const t = this.type;
    const k = Math.min(1, dt * 20);
    this.gY += ((hf + hr) / 2 - this.gY) * k;
    this.gPitch += ((hr - hf) / t.wheelbase - this.gPitch) * k;
    this.gRoll += ((hl - hrt) / (t.width - t.tyreW) - this.gRoll) * k;
  }
}
