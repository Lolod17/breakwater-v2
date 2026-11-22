// PASS 7: car radio (PASS 15b: eight stations). Originally four named stations, three tracks each. Every track is a
// short original loop synthesised in code from its own record (tempo, key, mode,
// chord progression, style, seed), so the title and artist shown in the HUD are
// the record that generated the buffer now playing: the source node carries the
// track id, and nowPlaying() reads it back from that node.
//
// Plays only while the player drives (it fades out on foot). R or . = next
// station, , = previous; the list ends with RADIO OFF. No files, no network.

import { on as onEvent } from '../core/events.js';

const RATE = 32000;            // loop sample rate (a car radio; resampled by WebAudio on playback)
const LOOPS_PER_TRACK = 4;     // a track repeats its loop this many times, then the station moves on

const SCALES = { minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10] };
const NOTE = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// prog: scale degrees (0-based), one chord per bar
export const STATIONS = [
  { id: 'bwfm', name: 'BREAKWATER FM', freq: '98.1', genre: 'synthwave', tracks: [
    { id: 'bwfm-1', title: 'Harbour Lights', artist: 'Neon Tidewater', style: 'synthwave', bpm: 100, root: 45, mode: 'minor', prog: [0, 5, 2, 6], seed: 11 },
    { id: 'bwfm-2', title: 'Last Ferry Out', artist: 'Chrome Lagoon', style: 'synthwave', bpm: 104, root: 50, mode: 'minor', prog: [0, 3, 5, 4], seed: 12 },
    { id: 'bwfm-3', title: 'Coastline Static', artist: 'Vera Kade', style: 'synthwave', bpm: 96, root: 47, mode: 'minor', prog: [5, 6, 0, 0], seed: 13 },
  ] },
  { id: 'lowtide', name: 'LOW TIDE', freq: '91.4', genre: 'lo-fi', tracks: [
    { id: 'lowtide-1', title: 'Rain on the Quay', artist: 'Moss & Mooring', style: 'lofi', bpm: 76, root: 50, mode: 'dorian', prog: [0, 3, 6, 2], seed: 21 },
    { id: 'lowtide-2', title: 'Two Coffees, No Sleep', artist: 'Juniper Haze', style: 'lofi', bpm: 82, root: 53, mode: 'major', prog: [3, 4, 2, 5], seed: 22 },
    { id: 'lowtide-3', title: 'Pier Seven', artist: 'Ollie Brann', style: 'lofi', bpm: 72, root: 48, mode: 'dorian', prog: [0, 6, 3, 4], seed: 23 },
  ] },
  { id: 'dockside', name: 'DOCKSIDE 104', freq: '104.7', genre: 'house', tracks: [
    { id: 'dockside-1', title: 'Container Yard', artist: 'Kranwerk', style: 'house', bpm: 124, root: 45, mode: 'minor', prog: [0, 0, 5, 6], seed: 31 },
    { id: 'dockside-2', title: 'Gantry Pulse', artist: 'DJ Salt', style: 'house', bpm: 122, root: 48, mode: 'minor', prog: [0, 3, 0, 4], seed: 32 },
    { id: 'dockside-3', title: 'Night Cargo', artist: 'Ferro & Lune', style: 'house', bpm: 126, root: 43, mode: 'dorian', prog: [0, 6, 5, 6], seed: 33 },
  ] },
  { id: 'nightshift', name: 'THE NIGHT SHIFT', freq: '88.3', genre: 'soul', tracks: [
    { id: 'nightshift-1', title: 'Velvet Overpass', artist: 'The Lamplighters', style: 'soul', bpm: 90, root: 53, mode: 'major', prog: [1, 4, 0, 5], seed: 41 },
    { id: 'nightshift-2', title: 'Slow Lane Serenade', artist: 'Odessa Grey', style: 'soul', bpm: 86, root: 51, mode: 'major', prog: [0, 5, 1, 4], seed: 42 },
    { id: 'nightshift-3', title: 'Blue Hour Taxi', artist: 'Marlo Vance Trio', style: 'soul', bpm: 94, root: 50, mode: 'dorian', prog: [0, 3, 1, 4], seed: 43 },
  ] },
  // PASS 15b: four more stations, same record-driven synth (new styles below)
  { id: 'tidewater', name: 'TIDEWATER AMBIENT', freq: '87.6', genre: 'harbour ambient', tracks: [
    { id: 'tidewater-1', title: 'Fog Over Berth Nine', artist: 'Halyard', style: 'ambient', bpm: 60, root: 45, mode: 'dorian', prog: [0, 3, 5, 3], seed: 51 },
    { id: 'tidewater-2', title: 'Slack Water', artist: 'Mira Okonkwo', style: 'ambient', bpm: 56, root: 48, mode: 'major', prog: [0, 5, 3, 4], seed: 52 },
    { id: 'tidewater-3', title: 'Buoy Light, 3 AM', artist: 'The Lantern Keepers', style: 'ambient', bpm: 62, root: 43, mode: 'minor', prog: [0, 5, 6, 4], seed: 53 },
  ] },
  { id: 'piertalk', name: 'PIER TALK', freq: '95.3', genre: 'talk show', tracks: [
    { id: 'piertalk-1', title: 'The Night Desk', artist: 'Dez Harrow & Juno Pike', style: 'talk', bpm: 96, root: 50, mode: 'major', prog: [0, 3, 4, 0], seed: 61 },
    { id: 'piertalk-2', title: 'Caller Line: Parking Wars', artist: 'Dez Harrow & Juno Pike', style: 'talk', bpm: 92, root: 48, mode: 'major', prog: [0, 4, 3, 0], seed: 62 },
    { id: 'piertalk-3', title: 'Ask the Harbourmaster', artist: 'Juno Pike', style: 'talk', bpm: 100, root: 52, mode: 'dorian', prog: [0, 3, 0, 4], seed: 63 },
  ] },
  { id: 'foundry', name: 'FOUNDRY 107', freq: '107.2', genre: 'industrial', tracks: [
    { id: 'foundry-1', title: 'Rivet Gun Liturgy', artist: 'Slag Choir', style: 'industrial', bpm: 132, root: 40, mode: 'minor', prog: [0, 0, 1, 6], seed: 71 },
    { id: 'foundry-2', title: 'Drydock Machinery', artist: 'Ferrous', style: 'industrial', bpm: 128, root: 38, mode: 'minor', prog: [0, 5, 0, 1], seed: 72 },
    { id: 'foundry-3', title: 'Cold Forge', artist: 'Unit Nine', style: 'industrial', bpm: 136, root: 41, mode: 'dorian', prog: [0, 6, 0, 3], seed: 73 },
  ] },
  { id: 'bwnews', name: 'HARBOUR NEWS 24', freq: '89.9', genre: 'news', tracks: [
    { id: 'bwnews-1', title: 'Top of the Hour', artist: 'Newsdesk: Ada Lennox', style: 'news', bpm: 120, root: 48, mode: 'major', prog: [0, 4, 5, 3], seed: 81 },
    { id: 'bwnews-2', title: 'Port Traffic Update', artist: 'Newsdesk: Sol Brandt', style: 'news', bpm: 116, root: 50, mode: 'major', prog: [0, 3, 4, 4], seed: 82 },
    { id: 'bwnews-3', title: 'Weather on the Water', artist: 'Newsdesk: Ada Lennox', style: 'news', bpm: 124, root: 46, mode: 'major', prog: [0, 5, 3, 4], seed: 83 },
  ] },
];
for (const s of STATIONS) for (const t of s.tracks) {
  t.bars = 4;
  t.seconds = t.bars * 4 * 60 / t.bpm;
  t.key = `${NOTE[t.root % 12]} ${t.mode}`;
}

const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

// ---- tiny offline synth: every voice writes straight into the two channels
function planTrack(t) {
  const beat = 60 / t.bpm, len = Math.round(t.seconds * RATE);
  const L = new Float32Array(len), R = new Float32Array(len);
  const rnd = mulberry(t.seed * 7919);
  const scale = SCALES[t.mode];
  const deg = (d, oct = 0) => t.root + scale[((d % 7) + 7) % 7] + 12 * (Math.floor(d / 7) + oct);
  const chord = (d, n = 3) => Array.from({ length: n }, (_, i) => deg(d + i * 2));

  // wrap-around writes so tails of the last bar ring into the start of the loop (seamless)
  const tone = (t0, dur, f, amp, { wave = 'sine', a = 0.005, d = 0.1, s = 0.6, r = 0.08, pan = 0, cut = 8000, vib = 0, trem = 0, drop = 0 } = {}) => {
    const n0 = Math.round(t0 * RATE), n = Math.round((dur + r) * RATE);
    const k = 1 - Math.exp(-2 * Math.PI * cut / RATE);
    const gl = amp * Math.min(1, 1 - pan), gr = amp * Math.min(1, 1 + pan);
    let ph = rnd(), y = 0, y2 = 0;
    const W = wave === 'saw' ? 0 : wave === 'square' ? 1 : wave === 'tri' ? 2 : 3;
    const inc = f / RATE, endA = a, endD = a + d, w5 = 2 * Math.PI * 5.2 / RATE, w4 = 2 * Math.PI * 4.5 / RATE;
    const nd = dur * RATE, nr = r * RATE;
    for (let i = 0; i < n; i++) {
      const tt = i / RATE;
      let env = tt < endA ? tt / a : tt < endD ? 1 - (1 - s) * (tt - a) / d : s;
      if (i > nd) env *= Math.max(0, 1 - (i - nd) / nr);
      let fi = inc;
      if (vib) fi *= 1 + vib * Math.sin(i * w5);
      if (drop) fi *= 1 + drop * Math.exp(-tt * 30);
      ph += fi; if (ph >= 1) ph -= 1;
      let x = W === 0 ? 2 * ph - 1 : W === 1 ? (ph < 0.5 ? 1 : -1) : W === 2 ? 4 * Math.abs(ph - 0.5) - 1 : Math.sin(ph * 6.283185307179586);
      y += k * (x - y); y2 += k * (y - y2);
      x = y2 * env;
      if (trem) x *= 1 - trem * (0.5 + 0.5 * Math.sin(i * w4));
      let j = n0 + i; if (j >= len) j %= len;
      L[j] += x * gl; R[j] += x * gr;
    }
  };
  const noise = (t0, dur, amp, { hp = 0, lp = 12000, decay = 20, pan = 0 } = {}) => {
    const n0 = Math.round(t0 * RATE), n = Math.round(dur * RATE);
    const kl = 1 - Math.exp(-2 * Math.PI * lp / RATE), kh = 1 - Math.exp(-2 * Math.PI * Math.max(1, hp) / RATE);
    let yl = 0, yh = 0, e = amp;
    const fall = Math.exp(-decay / RATE);
    for (let i = 0; i < n; i++) {
      const x0 = rnd() * 2 - 1;
      yl += kl * (x0 - yl); yh += kh * (yl - yh);
      const x = (hp ? yl - yh : yl) * e; e *= fall;
      const j = (n0 + i) % len;
      L[j] += x * (1 - pan * 0.5); R[j] += x * (1 + pan * 0.5);
    }
  };
  const kick = (t0, amp = 0.9) => {
    const n0 = Math.round(t0 * RATE), n = Math.round(0.4 * RATE);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const tt = i / RATE, f = 45 + 95 * Math.exp(-tt * 28);
      ph += f / RATE;
      const x = Math.sin(ph * 2 * Math.PI) * amp * Math.exp(-tt * 7.5);
      const j = (n0 + i) % len; L[j] += x; R[j] += x;
    }
  };
  const snare = (t0, amp = 0.35) => { noise(t0, 0.22, amp, { hp: 900, lp: 7000, decay: 16 }); tone(t0, 0.05, 190, amp * 0.6, { d: 0.05, s: 0, r: 0.03 }); };
  const clap = (t0, amp = 0.32) => { for (const o of [0, 0.011, 0.023]) noise(t0 + o, 0.14, amp, { hp: 1200, lp: 6000, decay: o > 0.02 ? 14 : 60 }); };
  const hat = (t0, amp = 0.09, open = false, pan = 0.25) => noise(t0, open ? 0.25 : 0.05, amp, { hp: 7000, lp: 14000, decay: open ? 10 : 70, pan });

  // the arrangement queues jobs; they run later, time-sliced across frames (no hitch)
  const jobs = [];
  const q = (fn) => (...args) => jobs.push(() => fn(...args));
  const [qTone, qNoise, qKick, qSnare, qClap, qHat] = [tone, noise, kick, snare, clap, hat].map(q);
  // Chatter beeps: one speaker's phrase as syllable blips (two partials ~ a formant), pitch
  // falling over the phrase, rising at the end of a question, short pauses between words.
  const speak = (t0, dur, voice, question) => {
    let tt = t0, word = 1 + Math.floor(rnd() * 3);
    while (tt < t0 + dur - 0.08) {
      const syl = 0.05 + rnd() * 0.09, prog = (tt - t0) / dur;
      let f = voice.f * (1 + 0.22 * (rnd() - 0.5)) * (1 + 0.16 * (1 - prog));
      if (question && prog > 0.78) f *= 1.25 + (prog - 0.78);
      qTone(tt, syl, f, 0.06, { wave: voice.wave, a: 0.006, d: syl * 0.6, s: 0.55, r: 0.025, pan: voice.pan, cut: 1500, vib: 0.012 });
      qTone(tt, syl * 0.8, f * (2.6 + rnd() * 0.8), 0.015, { a: 0.006, d: syl * 0.5, s: 0.3, r: 0.02, pan: voice.pan, cut: 3500 });
      tt += syl + 0.012;
      if (--word <= 0) { word = 1 + Math.floor(rnd() * 3); tt += 0.06 + rnd() * 0.08 + (rnd() < 0.15 ? 0.2 : 0); }   // between words, now and then a breath
    }
  };
  const bars = t.bars, st = beat / 4;
  const swing = t.style === 'lofi' ? 0.33 : t.style === 'soul' ? 0.22 : 0;
  const at = (s) => s * st + (s % 2 ? swing * st : 0);
  for (let b = 0; b < bars; b++) {
    const c = t.prog[b % t.prog.length], bar0 = b * 16;
    if (t.style === 'synthwave') {
      for (const m of chord(c)) for (const det of [-0.004, 0, 0.004]) qTone(bar0 * st, beat * 4 - 0.02, mtof(m + 12) * (1 + det), 0.035, { wave: 'saw', a: 0.35, d: 0.5, s: 0.8, r: 0.35, pan: det * 120, cut: 1900 });
      for (let s = 0; s < 16; s += 2) qTone(at(bar0 + s), st * 1.6, mtof(deg(c, -1)), 0.13, { wave: 'saw', d: 0.12, s: 0.4, r: 0.04, cut: 650 });
      const arp = [...chord(c), deg(c + 7)];
      for (let s = 0; s < 16; s++) qTone(at(bar0 + s), st * 0.8, mtof(arp[s % 4] + 12), 0.045, { wave: 'square', d: 0.08, s: 0.2, r: 0.05, pan: s % 2 ? 0.4 : -0.4, cut: 3200 });
      for (let s = 0; s < 16; s += 4) qKick(at(bar0 + s), 0.75);
      for (const s of [4, 12]) qSnare(at(bar0 + s), 0.32);
      for (let s = 2; s < 16; s += 4) qHat(at(bar0 + s), 0.07);
    } else if (t.style === 'lofi') {
      for (const m of chord(c, 4)) qTone(bar0 * st + rnd() * 0.02, beat * 3.6, mtof(m + 12), 0.06, { wave: 'tri', a: 0.01, d: 0.8, s: 0.45, r: 0.4, cut: 1500, trem: 0.25, vib: 0.002 });
      qTone(bar0 * st, beat * 1.8, mtof(deg(c, -1)), 0.2, { d: 0.4, s: 0.5, r: 0.1, cut: 400 });
      qTone(at(bar0 + 10), beat * 1.2, mtof(deg(c + 4, -1)), 0.16, { d: 0.3, s: 0.5, r: 0.1, cut: 400 });
      for (const s of [0, 7, 10]) qKick(at(bar0 + s), s ? 0.5 : 0.7);
      for (const s of [4, 12]) qSnare(at(bar0 + s), 0.18);
      for (let s = 0; s < 16; s += 2) qHat(at(bar0 + s), 0.05 + rnd() * 0.02);
      const pent = [0, 1, 2, 4, 5];
      for (const s of [2, 6, 9, 14]) if (rnd() < 0.7) qTone(at(bar0 + s), st * 2.5, mtof(deg(c + pent[Math.floor(rnd() * 5)], 1)), 0.05, { d: 0.3, s: 0.3, r: 0.25, cut: 2500, vib: 0.004 });
      for (let i = 0; i < 6; i++) qNoise((bar0 + rnd() * 16) * st, 0.004, 0.25, { hp: 2000, decay: 400 });
    } else if (t.style === 'house') {
      for (let s = 0; s < 16; s += 4) qKick(at(bar0 + s), 0.9);
      for (const s of [4, 12]) qClap(at(bar0 + s));
      for (let s = 2; s < 16; s += 4) qHat(at(bar0 + s), 0.1, true, -0.2);
      for (let s = 1; s < 16; s += 2) qHat(at(bar0 + s), 0.04);
      for (let s = 2; s < 16; s += 4) qTone(at(bar0 + s), st * 1.5, mtof(deg(c, -1)), 0.17, { wave: 'square', d: 0.1, s: 0.3, r: 0.03, cut: 520 });
      for (const s of [3, 6, 11, 14]) for (const m of chord(c, 4)) qTone(at(bar0 + s), st * 0.9, mtof(m + 12), 0.03, { wave: 'saw', d: 0.1, s: 0.1, r: 0.06, cut: 2400 });
    } else if (t.style === 'ambient') {
      // harbour ambient: slow detuned pads, water lapping on the piles, a far foghorn, buoy bells, gulls
      chord(c, 4).forEach((m, i) => qTone(bar0 * st, beat * 4, mtof(m), 0.055, { wave: 'tri', a: 1.6, d: 1.2, s: 0.85, r: 1.6, pan: i % 2 ? 0.4 : -0.4, cut: 1100, vib: 0.003 }));
      qTone(bar0 * st, beat * 4, mtof(deg(c, -1)), 0.07, { a: 1.2, d: 1, s: 0.9, r: 2, cut: 300 });
      for (let i = 0; i < 3; i++) qNoise((bar0 + rnd() * 16) * st, 1.6 + rnd(), 0.1, { lp: 420 + rnd() * 300, hp: 60, decay: 1.4, pan: rnd() - 0.5 });
      if (b === 1) { qTone(bar0 * st + 0.3, beat * 2.4, mtof(t.root - 24), 0.22, { wave: 'saw', a: 0.45, d: 0.4, s: 0.85, r: 1.1, cut: 260 }); qTone(bar0 * st + 0.3, beat * 2.4, mtof(t.root - 17), 0.07, { wave: 'saw', a: 0.5, d: 0.4, s: 0.8, r: 1.1, cut: 320 }); }
      for (const s of [3, 11]) if (rnd() < 0.7) qTone(at(bar0 + s), 0.05, mtof(deg(c + 4, 2)), 0.05, { wave: 'tri', a: 0.002, d: 2.6, s: 0, r: 0.4, pan: 0.5, cut: 5000 });
      if (rnd() < 0.6) { const g0 = (bar0 + 4 + rnd() * 8) * st; for (let k = 0; k < 2; k++) qTone(g0 + k * 0.32, 0.22, 1500 - k * 120, 0.018, { wave: 'tri', a: 0.02, d: 0.2, s: 0.5, r: 0.08, pan: -0.6, cut: 4000, vib: 0.04, drop: 0.35 }); }
    } else if (t.style === 'talk') {
      // talk show: two hosts trade turns as chatter beeps (syllable blips with a falling phrase contour,
      // questions rise), a quiet studio bed, a sting at the top of the loop, now and then a laugh
      if (b === 0) [0, 4, 7].forEach((d, i) => qTone(i * st * 1.5, st * 2, mtof(deg(d, 1)), 0.08, { wave: 'square', d: 0.15, s: 0.3, r: 0.1, cut: 3000 }));
      qTone(bar0 * st, beat * 4, mtof(deg(c, -1)), 0.008, { a: 0.5, d: 0.5, s: 0.8, r: 0.5, cut: 500 });
      for (const m of chord(c)) qTone(bar0 * st, beat * 4, mtof(m + 12), 0.004, { wave: 'tri', a: 0.6, d: 0.5, s: 0.8, r: 0.6, cut: 1400 });
      const host = b % 2 ? { f: 245, pan: 0.35, wave: 'tri' } : { f: 150, pan: -0.35, wave: 'square' };
      speak(bar0 * st + (b === 0 ? beat * 1.2 : 0.1), beat * (b === 0 ? 2.6 : 3.7), host, rnd() < 0.45);
      if (rnd() < 0.4) { const l0 = (bar0 + 13) * st; for (let k = 0; k < 5; k++) qTone(l0 + k * 0.09, 0.06, (b % 2 ? 150 : 245) * (1.5 - k * 0.07), 0.035, { wave: 'tri', d: 0.05, s: 0.3, r: 0.02, pan: -host.pan, cut: 2200 }); }
    } else if (t.style === 'industrial') {
      // industrial: overdriven four-on-the-floor, inharmonic metal hits, steam hiss, pumping saw bass
      for (let s = 0; s < 16; s += 4) qKick(at(bar0 + s), 1);
      for (const s of [7, 10]) qKick(at(bar0 + s), 0.55);
      for (const s of [4, 12]) { qNoise(at(bar0 + s), 0.18, 0.45, { hp: 600, lp: 5000, decay: 14 }); for (const r of [1, 1.47, 2.09, 2.76]) qTone(at(bar0 + s), 0.05, 310 * r, 0.06, { wave: 'square', d: 0.25, s: 0, r: 0.1, pan: (r - 1.8) * 0.5, cut: 7000 }); }
      for (let s = 2; s < 16; s += 4) qNoise(at(bar0 + s), 0.3, 0.12, { hp: 3500, lp: 12000, decay: 9, pan: 0.4 });
      for (let s = 0; s < 16; s++) if (s % 4) qTone(at(bar0 + s), st * 0.7, mtof(deg(c, -2) + (s % 8 === 6 ? 12 : 0)), 0.16, { wave: 'saw', d: 0.06, s: 0.5, r: 0.02, cut: 420 + 60 * (s % 4) });
      if (b === 3) for (const r of [1, 1.33, 1.91]) qTone(at(bar0 + 14), 0.1, 98 * r, 0.12, { wave: 'saw', d: 0.9, s: 0, r: 0.3, cut: 2400, vib: 0.01 });
    } else if (t.style === 'news') {
      // news: a brass-stab jingle with a timpani roll at the top, then the newsreader over a
      // teletype ticker, and the time pips at the end of the loop
      if (b === 0) {
        for (let k = 0; k < 10; k++) qKick(k * 0.045, 0.18 + k * 0.03);
        for (const [s, d] of [[0, 0], [3, 2], [6, 4]]) for (const m of chord(d, 3)) qTone(at(s), st * 1.6, mtof(m + 12), 0.05, { wave: 'saw', a: 0.01, d: 0.12, s: 0.6, r: 0.08, cut: 2600 });
        for (const m of [...chord(0, 3), deg(7)]) qTone(at(8), beat * 2, mtof(m + 12), 0.05, { wave: 'saw', a: 0.02, d: 0.3, s: 0.7, r: 0.4, cut: 2400, vib: 0.004 });
        qKick(at(8), 0.8);
      } else {
        for (let s = 0; s < 16; s++) qNoise(at(bar0 + s), 0.012, s % 4 ? 0.05 : 0.08, { hp: 2500, lp: 9000, decay: 300, pan: 0.45 });
        for (const s of [0, 8]) qTone(at(bar0 + s), 0.05, 1320, 0.025, { d: 0.05, s: 0, r: 0.02, pan: 0.45 });
        qTone(bar0 * st, beat * 4, mtof(deg(c, -1)), 0.035, { a: 0.4, d: 0.5, s: 0.8, r: 0.4, cut: 400 });
        speak(bar0 * st + 0.15, beat * (b === 3 ? 2.4 : 3.6), { f: 190, pan: 0, wave: 'tri' }, false);
        if (b === 3) for (let k = 0; k < 6; k++) qTone(bar0 * st + beat * 2.6 + k * beat * 0.22, k === 5 ? 0.3 : 0.07, 1000, 0.05, { d: 0.02, s: 0.9, r: 0.02 });
      }
    } else {
      // soul: rhodes comping on 2 and 4, walking quarter-note bass, brushes, rimshot
      for (const s of [4, 10, 12]) for (const m of chord(c, 4)) qTone(at(bar0 + s), st * (s === 10 ? 1.5 : 3), mtof(m + 12), 0.045, { d: 0.5, s: 0.35, r: 0.2, cut: 2200, trem: 0.18 });
      const walk = [deg(c, -1), deg(c + 2, -1), deg(c + 4, -1), deg(c + 5, -1) - 1];
      for (let q = 0; q < 4; q++) qTone(at(bar0 + q * 4), beat * 0.9, mtof(walk[q]), 0.2, { wave: 'tri', d: 0.2, s: 0.6, r: 0.06, cut: 600 });
      for (const s of [0, 9]) qKick(at(bar0 + s), 0.5);
      for (let s = 0; s < 16; s += 2) qNoise(at(bar0 + s), 0.12, 0.05, { hp: 3000, lp: 9000, decay: 22, pan: -0.3 });
      qTone(at(bar0 + 12), 0.04, 420, 0.12, { wave: 'square', d: 0.03, s: 0, r: 0.02, cut: 3000 });
      for (const s of [0, 3, 6, 8, 14]) if (rnd() < 0.6) qTone(at(bar0 + s), st * 2, mtof(deg(c + [0, 2, 4, 6][Math.floor(rnd() * 4)], 1)), 0.05, { wave: 'tri', a: 0.02, d: 0.2, s: 0.5, r: 0.2, cut: 2600, vib: 0.006 });
    }
  }
  const finish = () => {
  // normalise and soft-clip
  let peak = 1e-6;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = 0.9 / peak, drive = t.style === 'industrial' ? 2.2 : 1.2;     // the foundry runs hot
  for (let i = 0; i < len; i++) { L[i] = Math.tanh(L[i] * g * drive) * 0.8; R[i] = Math.tanh(R[i] * g * drive) * 0.8; }
  return { L, R, len };
  };
  return { jobs, finish };
}
// Whole track at once (tools / node); the game uses the sliced path in Radio.
function synthTrack(t) { const p = planTrack(t); for (const j of p.jobs) j(); return p.finish(); }

export class Radio {
  constructor(audio) {
    this.audio = audio;          // VehicleAudio: owns the AudioContext (created on the first gesture)
    this.index = 0;              // station index; STATIONS.length = OFF
    this.trackOf = STATIONS.map(() => 0);
    this.cache = new Map();      // track id -> AudioBuffer (four most recent)
    this.source = null;          // { node, gain, track, started }
    this.on = false;             // radio audible (player driving)
    this.offSince = null;
    this.pending = null;
    this.changedAt = -1e9;       // performance.now() of the last station / track change (HUD toast)
    this.tunedAt = -1e9;         // performance.now() of the last station change by the player (HUD station panel)
    // PASS 15: the radio can only be on while the player sits in a vehicle (vehicle:entered / vehicle:exited)
    this.inVehicle = false;
    onEvent('vehicle:entered', () => { this.inVehicle = true; });
    onEvent('vehicle:exited', () => { this.inVehicle = false; this.on = false; });
  }
  get station() { return STATIONS[this.index] ?? null; }
  reset() { this.index = 0; this.trackOf.fill(0); this._stop(0.05); this.changedAt = -1e9; this.tunedAt = -1e9; }
  next() { this.tune((this.index + 1) % (STATIONS.length + 1)); }
  prev() { this.tune((this.index + STATIONS.length) % (STATIONS.length + 1)); }
  tune(i) { this.index = i; this.changedAt = this.tunedAt = performance.now(); this._stop(0.12); }

  // PASS 15: the tuned station and its queued / playing track, plus whether the radio is on.
  current() { return { index: this.index, on: this.on, inVehicle: this.inVehicle, ...this.nowPlaying() }; }

  // What the radio is playing: the record behind the live source node if there is
  // one, otherwise what the tuned station has queued.
  nowPlaying() {
    const s = this.station;
    if (!s) return { off: true, station: 'RADIO OFF', freq: '', title: '', artist: '', trackId: null, playing: false };
    const live = this.source && this.source.station === s ? this.source.track : null;
    const t = live ?? s.tracks[this.trackOf[this.index]];
    return { off: false, station: s.name, freq: s.freq, genre: s.genre, title: t.title, artist: t.artist, trackId: t.id, bpm: t.bpm, key: t.key,
      playing: !!live, sourceTrackId: live ? this.source.node.buffer.trackId : null };
  }

  _ensureNodes() {
    const a = this.audio;
    if (!a.ctx || this.out) return !!a.ctx;
    const ctx = a.ctx;
    this.out = ctx.createGain(); this.out.gain.value = 0;
    // a cabin speaker: a little low-cut and top-cut
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000;
    this.out.connect(hp).connect(lp).connect(a.master);
    return true;
  }
  // Synthesis runs in ~3 ms slices per frame; the station starts when its loop is ready.
  _build(track, budgetMs = 3) {
    if (this.cache.has(track.id)) return this.cache.get(track.id);
    if (this.pending?.track !== track) this.pending = { track, plan: planTrack(track), i: 0 };
    const p = this.pending, t0 = performance.now();
    while (p.i < p.plan.jobs.length && performance.now() - t0 < budgetMs) p.plan.jobs[p.i++]();
    if (p.i < p.plan.jobs.length) return null;
    const { L, R, len } = p.plan.finish();
    const b = this.audio.ctx.createBuffer(2, len, RATE);
    b.copyToChannel(L, 0); b.copyToChannel(R, 1);
    b.trackId = track.id;
    this.cache.set(track.id, b);
    if (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value);
    this.pending = null;
    return b;
  }
  _start(station, track, buffer) {
    const ctx = this.audio.ctx, now = ctx.currentTime;
    const node = ctx.createBufferSource(); node.buffer = buffer; node.loop = true;
    const gain = ctx.createGain(); gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(1, now + 0.6);
    node.connect(gain).connect(this.out); node.start(now);
    this.source = { node, gain, track, station, started: now };
  }
  _stop(fade) {
    const s = this.source;
    if (!s) return;
    const now = this.audio.ctx.currentTime;
    s.gain.gain.cancelScheduledValues(now); s.gain.gain.setTargetAtTime(0, now, fade / 3);
    s.node.stop(now + fade + 0.05);
    this.source = null;
  }
  // Every frame. driving: the player is in a car with the engine on.
  update(driving) {
    this.on = driving && this.inVehicle && !!this.station;
    if (!this._ensureNodes()) return;
    const ctx = this.audio.ctx, now = ctx.currentTime;
    this.out.gain.setTargetAtTime(this.on ? 0.42 : 0, now, this.on ? 0.25 : 0.12);
    if (!this.on) {
      if (this.offSince === null) this.offSince = now;
      if (this.source && now - this.offSince > 1.2) this._stop(0.1);
      // on foot: quietly pre-build the tuned station's loop so getting in plays at once
      const st = this.station;
      if (st && !this.source) this._build(st.tracks[this.trackOf[this.index]], 1.5);
      return;
    }
    this.offSince = null;
    const st = this.station, want = st.tracks[this.trackOf[this.index]];
    if (!this.source) {
      const buf = this._build(want);
      if (buf) this._start(st, want, buf);
      return;
    }
    if (now - this.source.started > this.source.track.seconds * LOOPS_PER_TRACK) {
      const nextTrack = st.tracks[(this.trackOf[this.index] + 1) % st.tracks.length];
      const buf = this._build(nextTrack);            // keep the current loop going until the next one is ready
      if (!buf) return;
      this.trackOf[this.index] = st.tracks.indexOf(nextTrack);
      this._stop(1.2);
      this._start(st, nextTrack, buf);
      this.changedAt = performance.now();
    } else if (!this.pending && now - this.source.started > this.source.track.seconds * (LOOPS_PER_TRACK - 1)) {
      this._build(st.tracks[(this.trackOf[this.index] + 1) % st.tracks.length], 2);   // pre-build the next track
    }
  }
}

export { synthTrack, RATE as RADIO_RATE };
