// PASS 15b: speed lines. Above ~95 km/h thin streaks rush outward from the
// centre of the screen on a 2D overlay canvas (no WebGL draw calls), denser and
// brighter with speed; the centre of the view stays clear. Half-resolution
// backing store; nothing is drawn (and the canvas is cleared once) when slow.
const N = 56;

export class SpeedLines {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext('2d') ?? null;
    this.k = 0;                      // eased intensity 0..1
    this.drawn = false;
    let s = 0x5eed;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    this.lines = Array.from({ length: N }, () => ({ a: rnd() * Math.PI * 2, r: rnd(), v: 0.8 + rnd() * 0.9, w: 0.8 + rnd() * 1.6, len: 0.08 + rnd() * 0.14 }));
    this.rnd = rnd;
  }
  // kmh: the player's car speed (0 on foot); still: deterministic capture mode (no lines)
  update(kmh, dt, still = false) {
    const c = this.canvas, g = this.ctx;
    if (!g) return;
    const target = still ? 0 : Math.min(1, Math.max(0, (kmh - 95) / 85));
    this.k += (target - this.k) * Math.min(1, dt * 4);
    if (this.k < 0.02) {
      if (this.drawn) { g.clearRect(0, 0, c.width, c.height); this.drawn = false; }
      return;
    }
    const w = Math.max(1, Math.round(innerWidth / 2)), h = Math.max(1, Math.round(innerHeight / 2));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h * 0.46, R = Math.hypot(w, h) * 0.55, k = this.k;
    g.lineCap = 'round';
    const shown = Math.round(N * (0.35 + 0.65 * k));
    for (let i = 0; i < shown; i++) {
      const L = this.lines[i];
      L.r += L.v * dt * (1.2 + 2.2 * k);
      if (L.r > 1) { L.r = 0; L.a = this.rnd() * Math.PI * 2; }
      const r0 = (0.42 + 0.58 * L.r) * R, r1 = r0 + L.len * R * (0.6 + k);
      const ca = Math.cos(L.a), sa = Math.sin(L.a);
      g.strokeStyle = `rgba(235, 245, 255, ${(0.16 + 0.5 * k) * Math.sin(Math.PI * L.r)})`;
      g.lineWidth = L.w;
      g.beginPath(); g.moveTo(cx + ca * r0, cy + sa * r0); g.lineTo(cx + ca * r1, cy + sa * r1); g.stroke();
    }
    this.drawn = true;
  }
  state() { return { intensity: +this.k.toFixed(3), drawn: this.drawn }; }
}
