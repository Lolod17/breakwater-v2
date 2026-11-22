// Synthesised car audio for the player's vehicle (WebAudio, no files):
// an engine voice whose firing frequency follows rpm (so gear changes are heard
// as pitch steps) with load-dependent brightness and a per-type character
// (type.pitch scales the voice, type.rough sets the sub-octave growl, the rasp
// partial and, above 0.5, a lumpy crank-rate lope; type.whine (PASS 10a2) mixes in a
// supercharger / turbo whine that climbs with rpm and load), a tyre screech from filtered
// noise when sliding, a two-tone horn, and a thump on impacts. Created on the
// first user gesture, as browsers require.

export class VehicleAudio {
  constructor() {
    this.ctx = null;
    const start = () => this._init();
    addEventListener('keydown', start, { once: true });
    addEventListener('pointerdown', start, { once: true });
  }

  _init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(ctx.destination);

    // engine: saw + square an octave down, gentle waveshaper grit, load-controlled lowpass
    this.eng = ctx.createGain(); this.eng.gain.value = 0;
    const lp = (this.engLP = ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 3;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.2); }
    shaper.curve = curve;
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator(); this.o2.type = 'square';
    this.o3 = ctx.createOscillator(); this.o3.type = 'sawtooth';
    const g1 = ctx.createGain(); g1.gain.value = 0.5;
    const g2 = (this.g2 = ctx.createGain()); g2.gain.value = 0.35;
    const g3 = (this.g3 = ctx.createGain()); g3.gain.value = 0.18;
    this.o1.connect(g1).connect(shaper); this.o2.connect(g2).connect(shaper); this.o3.connect(g3).connect(shaper);
    shaper.connect(lp).connect(this.eng).connect(this.master);
    for (const o of [this.o1, this.o2, this.o3]) { o.frequency.value = 30; o.start(); }
    // lope: crank-rate amplitude wobble added onto the engine gain (depth 0 for smooth engines)
    this.lope = ctx.createOscillator(); this.lope.type = 'sine'; this.lope.frequency.value = 6;
    this.lopeDepth = ctx.createGain(); this.lopeDepth.gain.value = 0;
    this.lope.connect(this.lopeDepth).connect(this.eng.gain); this.lope.start();
    // forced-induction whine: a band-passed triangle tracking rpm, gain from type.whine x load
    this.wh = ctx.createOscillator(); this.wh.type = 'triangle'; this.wh.frequency.value = 800;
    const whBP = ctx.createBiquadFilter(); whBP.type = 'bandpass'; whBP.frequency.value = 2400; whBP.Q.value = 2;
    this.whine = ctx.createGain(); this.whine.gain.value = 0;
    this.wh.connect(whBP).connect(this.whine).connect(this.master); this.wh.start();

    // noise source shared by screech and impacts
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < d.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = seed / 0x3fffffff - 1; }
    this.noiseBuf = buf;
    const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 6;
    this.screech = ctx.createGain(); this.screech.gain.value = 0;
    n.connect(bp).connect(this.screech).connect(this.master); n.start();
    this.screechBP = bp;

    // horn: two detuned squares through a bandpass
    this.horn = ctx.createGain(); this.horn.gain.value = 0;
    const hb = ctx.createBiquadFilter(); hb.type = 'bandpass'; hb.frequency.value = 900; hb.Q.value = 1.2;
    for (const f of [392, 494]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(hb); o.start(); }
    hb.connect(this.horn).connect(this.master);

    this.sirenVoices = Array.from({ length: 3 }, () => {
      const osc = ctx.createOscillator(), gain = ctx.createGain(), pan = ctx.createStereoPanner();
      osc.type = 'triangle';
      gain.gain.value = 0;
      osc.connect(gain).connect(pan).connect(this.master);
      osc.start();
      return { osc, gain, pan };
    });
  }

  sirens(units, listener, time, yaw) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.sirenVoices.forEach(({ osc, gain, pan }, i) => {
      const unit = units[i];
      if (!unit?.siren) { gain.gain.setTargetAtTime(0, now, 0.09); return; }
      const dx = unit.car.x - listener.x, dz = unit.car.z - listener.z;
      const distance = Math.hypot(dx, dz);
      const approach = -(dx * unit.car.vx + dz * unit.car.vz) / Math.max(1, distance);
      const pitch = 690 + Math.sin(time * (5.8 + i * 0.6) + i) * 230;
      osc.frequency.setTargetAtTime(pitch * (1 + approach / 150), now, 0.035);
      gain.gain.setTargetAtTime(0.23 / (1 + (distance / 22) ** 2), now, 0.075);
      pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, (-dx * Math.cos(yaw) + dz * Math.sin(yaw)) / Math.max(1, distance))), now, 0.09);
    });
  }

  shot() {
    if (!this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const noise = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    noise.buffer = this.noiseBuf;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(4800, now);
    filter.frequency.exponentialRampToValueAtTime(330, now + 0.13);
    gain.gain.setValueAtTime(0.56, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    noise.connect(filter).connect(gain).connect(this.master);
    noise.start(now); noise.stop(now + 0.16);
  }

  // Called every frame. v: the player's vehicle or null.
  update(v, dt) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (!v) {
      this.eng.gain.setTargetAtTime(0, now, 0.15);
      this.lopeDepth.gain.setTargetAtTime(0, now, 0.05);
      this.whine.gain.setTargetAtTime(0, now, 0.05);
      this.screech.gain.setTargetAtTime(0, now, 0.05);
      this.horn.gain.setTargetAtTime(0, now, 0.03);
      return;
    }
    const t = v.type;
    const fire = (v.rpm / 60) * (t.cyl / 2) * (t.pitch ?? 1); // firing frequency, voiced per type
    const rough = t.rough ?? 0.5;
    this.g2.gain.setTargetAtTime(0.1 + rough * 0.5, now, 0.1);
    this.g3.gain.setTargetAtTime(0.06 + rough * 0.24, now, 0.1);
    this.lope.frequency.setTargetAtTime(v.rpm / 120, now, 0.05);
    this.lopeDepth.gain.setTargetAtTime(Math.max(0, rough - 0.5) * 0.16 * (1 - Math.min(1, v.rpm / t.redline)), now, 0.1);
    this.o1.frequency.setTargetAtTime(fire, now, 0.03);
    this.o2.frequency.setTargetAtTime(fire / 2, now, 0.03);
    this.o3.frequency.setTargetAtTime(fire * 1.505, now, 0.03);
    const load = Math.max(v.ctrl.throttle, v.gear < 0 ? v.ctrl.brake : 0);
    this.engLP.frequency.setTargetAtTime(350 + fire * 3 + load * 1800, now, 0.05);
    const rx = Math.min(1, v.rpm / t.redline);
    this.wh.frequency.setTargetAtTime(700 + rx * 3600, now, 0.05);
    this.whine.gain.setTargetAtTime((t.whine ?? 0) * (0.004 + 0.05 * load) * rx, now, 0.08);
    this.eng.gain.setTargetAtTime(0.12 + load * 0.16 + Math.min(0.1, v.speed * 0.002), now, 0.08);
    this.screech.gain.setTargetAtTime(Math.max(0, v.slip - 0.25) * 0.5, now, 0.06);
    this.screechBP.frequency.setTargetAtTime(1500 + v.speed * 18, now, 0.1);
    this.horn.gain.setTargetAtTime(v.horn ? 0.22 : 0, now, 0.02);
    if (v.impact > 2) this.thump(Math.min(1, v.impact / 10));
  }

  thump(k) {
    const ctx = this.ctx;
    if (!ctx || (this._lastThump && ctx.currentTime - this._lastThump < 0.15)) return;
    this._lastThump = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500 + k * 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * k, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    src.connect(lp).connect(g).connect(this.master);
    src.start(); src.stop(ctx.currentTime + 0.4);
  }
}
