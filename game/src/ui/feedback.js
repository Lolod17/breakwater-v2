// PASS 7: gameplay feedback. Watches the state the HUD already shows and, on a
// change, plays a short synthesised sound and adds a visible cue:
//   objective  — new objective text: chime + the objective panel flashes "NEW OBJECTIVE"
//   wanted     — wanted level rises: two-tone alarm + the stars pulse red
//   complete   — mission passed: rising arpeggio + gold sweep behind the result card
//   fail       — mission failed: falling minor tones + red sweep
//   damage     — health drops: low thump + red edge vignette, health bar shakes
// PASS 15b: objective / complete / fail / wanted also post a toast (top centre,
// at most three, each slides in and fades out after ~3.4 s).
// Every event is logged (kind, simulated time, whether a sound was played) for
// tools/probe_ui.mjs.

const $ = (id) => document.getElementById(id);

export class Feedback {
  constructor(audio) {
    this.audio = audio;
    this.log = [];
    this.prev = null;
    this.el = { objective: $('hud-objective'), kicker: $('objective-kicker'), stars: $('wanted'), status: $('hud-status'),
      vignette: $('damage-vignette'), result: $('result'), health: $('health-bar'), toasts: $('toasts') };
    this.toasts = [];
  }
  reset() { this.prev = null; for (const t of this.toasts) t.el.remove(); this.toasts = []; }

  // A mission toast: a kind label over one line of text.
  toast(kind, head, text = '') {
    const box = this.el.toasts;
    if (!box) return null;
    const el = document.createElement('div');
    el.className = `toast toast-${kind}`;
    const h = document.createElement('b'); h.textContent = head; el.appendChild(h);
    if (text) { const p = document.createElement('span'); p.textContent = text; el.appendChild(p); }
    box.appendChild(el);
    const t = { el, kind, head, text, born: performance.now() };
    this.toasts.push(t);
    while (this.toasts.length > 3) this.toasts.shift().el.remove();
    setTimeout(() => el.classList.add('out'), 3400);
    setTimeout(() => { el.remove(); this.toasts = this.toasts.filter((o) => o !== t); }, 3900);
    return t;
  }

  // Restart a CSS animation class on an element.
  cue(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  emit(kind, t, detail = '', more = '') {
    const sound = this.play(kind);
    this.log.push({ kind, t: +t.toFixed(2), sound, detail });
    if (this.log.length > 64) this.log.shift();
    const e = this.el;
    if (kind === 'objective') this.toast('objective', 'NEW OBJECTIVE', detail);
    else if (kind === 'complete') this.toast('complete', detail || 'MISSION PASSED', more);
    else if (kind === 'fail') this.toast('fail', detail || 'MISSION FAILED', more);
    else if (kind === 'wanted') this.toast('wanted', 'WANTED', '\u2605'.repeat(Math.max(1, Math.min(5, Number(detail) || 1))));
    if (kind === 'objective') { this.cue(e.objective, 'fx-objective'); }
    else if (kind === 'wanted') { this.cue(e.stars, 'fx-wanted'); }
    else if (kind === 'complete' || kind === 'fail') { this.cue(e.result, kind === 'complete' ? 'fx-complete' : 'fx-fail'); }
    else if (kind === 'damage') { this.cue(e.vignette, 'fx-damage'); this.cue(e.health, 'fx-shake'); }
  }

  // s: { objective, phase, wanted, hp, result, incident }
  update(s, t) {
    const p = this.prev;
    this.prev = { ...s };
    if (!p) return;
    if (s.objective && s.objective !== p.objective && s.phase === 'active' && !s.result) this.emit('objective', t, s.objective);
    if (s.wanted > p.wanted) this.emit('wanted', t, String(s.wanted));
    if (s.result && !p.result) this.emit(s.result.ok ? 'complete' : 'fail', t, s.result.title, s.result.detail ?? '');
    if (s.hp < p.hp - 0.5 && !s.incident) this.emit('damage', t, String(Math.round(p.hp - s.hp)));
  }

  // ---- sounds (WebAudio, nothing loaded) ------------------------------------
  play(kind) {
    const a = this.audio, ctx = a.ctx;
    if (!ctx) return false;
    const now = ctx.currentTime;
    const out = ctx.createGain(); out.gain.value = 0.9; out.connect(a.master);
    const note = (t0, f, dur, { type = 'triangle', amp = 0.25, to = null, cut = 6000 } = {}) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
      o.type = type; o.frequency.setValueAtTime(f, now + t0);
      if (to) o.frequency.exponentialRampToValueAtTime(to, now + t0 + dur);
      lp.type = 'lowpass'; lp.frequency.value = cut;
      g.gain.setValueAtTime(0.0001, now + t0);
      g.gain.exponentialRampToValueAtTime(amp, now + t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t0 + dur);
      o.connect(lp).connect(g).connect(out);
      o.start(now + t0); o.stop(now + t0 + dur + 0.05);
    };
    const thump = (t0, amp) => {
      const n = ctx.createBufferSource(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
      n.buffer = a.noiseBuf; lp.type = 'lowpass'; lp.frequency.value = 380;
      g.gain.setValueAtTime(amp, now + t0); g.gain.exponentialRampToValueAtTime(0.001, now + t0 + 0.22);
      n.connect(lp).connect(g).connect(out); n.start(now + t0); n.stop(now + t0 + 0.25);
    };
    if (kind === 'objective') { note(0, 1046.5, 0.22, { amp: 0.16 }); note(0.09, 1568, 0.34, { amp: 0.14 }); }
    else if (kind === 'wanted') { for (const t0 of [0, 0.2]) { note(t0, 880, 0.15, { type: 'square', amp: 0.07, cut: 2600 }); note(t0 + 0.1, 660, 0.15, { type: 'square', amp: 0.07, cut: 2600 }); } }
    else if (kind === 'complete') { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(i * 0.09, f, 0.5 - i * 0.05, { amp: 0.15 })); note(0.36, 1318.5, 0.7, { type: 'sine', amp: 0.08 }); }
    else if (kind === 'fail') { [392, 311.13, 233.08].forEach((f, i) => note(i * 0.16, f, 0.4, { type: 'sawtooth', amp: 0.09, cut: 1200 })); thump(0, 0.35); }
    else if (kind === 'damage') { thump(0, 0.6); note(0, 140, 0.18, { type: 'sine', amp: 0.3, to: 55 }); }
    setTimeout(() => out.disconnect(), 1600);
    return true;
  }
}
