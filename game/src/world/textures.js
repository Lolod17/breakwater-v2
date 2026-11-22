// Every texture in the game is painted here on canvases at load time from the
// seeded RNG: asphalt, paving, four facade styles, shopfronts, neon signs,
// billboards, awnings and soft decals. No image files, no network.
import * as THREE from '../../vendor/three.min.js';

// PASS 17e: ss > 1 supersamples. The canvas is ss times larger and the context is scaled,
// so painting code keeps its logical pixel coordinates and its RNG sequence (the same
// layout, drawn sharper). Note shadowBlur and ImageData ignore the transform.
function canvas(w, h, ss = 1) {
  const c = document.createElement('canvas');
  c.width = w * ss; c.height = h * ss;
  const g = c.getContext('2d');
  if (ss !== 1) g.scale(ss, ss);
  return [c, g];
}

// Fine grain painted at the full (supersampled) resolution from its own hash, so the
// shared seeded RNG stream is not touched. Gives close-up detail on road and paving.
function grain(c, g, count, colors, seed) {
  let h = seed >>> 0;
  const rnd = () => { h = (h + 0x6d2b79f5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[(rnd() * colors.length) | 0];
    const sz = rnd() < 0.8 ? 1 : 2;
    g.fillRect((rnd() * c.width) | 0, (rnd() * c.height) | 0, sz, sz);
  }
  g.restore();
}

// Anisotropy 16 (three.js clamps to the GPU's maximum); trilinear mips are the default.
function tex(c, { srgb = true, repeat = true, aniso = 16 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

function speckle(g, rng, w, h, count, colors, size = [1, 2]) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = rng.pick(colors);
    const s = rng.float(size[0], size[1]);
    g.fillRect(rng.float(0, w), rng.float(0, h), s, s);
  }
}

// ---------------------------------------------------------------- asphalt
export function asphalt(rng) {
  const N = 512;
  const [c, g] = canvas(N, N, 2);
  g.fillStyle = '#2a2c31';
  g.fillRect(0, 0, N, N);
  speckle(g, rng, N, N, 22000, ['#25272b', '#2e3035', '#33353a', '#222327', '#35363b'], [1, 2.2]);
  // tar patches and seams
  for (let i = 0; i < 9; i++) {
    g.fillStyle = `rgba(18,18,20,${rng.float(0.25, 0.5)})`;
    g.beginPath();
    g.ellipse(rng.float(0, N), rng.float(0, N), rng.float(20, 70), rng.float(10, 40), rng.float(0, 3), 0, 6.3);
    g.fill();
  }
  g.strokeStyle = 'rgba(14,14,16,0.7)';
  for (let i = 0; i < 14; i++) {
    g.lineWidth = rng.float(0.8, 2);
    g.beginPath();
    let x = rng.float(0, N), y = rng.float(0, N);
    g.moveTo(x, y);
    for (let k = 0; k < 8; k++) { x += rng.float(-24, 24); y += rng.float(-24, 24); g.lineTo(x, y); }
    g.stroke();
  }
  grain(c, g, 120000, ['rgba(16,16,18,0.5)', 'rgba(70,72,78,0.35)', 'rgba(52,54,60,0.45)', 'rgba(90,90,96,0.22)'], 0xa5f1);
  // roughness (G) / metalness (B): wet sheen with darker smooth puddles
  const [r, rg] = canvas(N, N);
  rg.fillStyle = 'rgb(0,150,0)';
  rg.fillRect(0, 0, N, N);
  for (let i = 0; i < 3000; i++) {
    // fine grain kept subtle: strong speckle turns into confetti glints once the road is wet
    rg.fillStyle = `rgb(0,${Math.round(150 + (rng.int(120, 190) - 155) * 0.35)},0)`;
    rg.fillRect(rng.float(0, N), rng.float(0, N), 3, 3);
  }
  for (let i = 0; i < 9; i++) {
    const x = rng.float(0, N), y = rng.float(0, N), rad = rng.float(14, 46);
    const gr = rg.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(0,70,0,0.8)');
    gr.addColorStop(0.5, 'rgba(0,100,0,0.5)');
    gr.addColorStop(1, 'rgba(0,150,0,0)');
    rg.fillStyle = gr;
    rg.beginPath();
    rg.ellipse(x, y, rad * 1.6, rad, rng.float(0, 3), 0, 6.3);
    rg.fill();
  }
  // darken puddles in albedo too (wet = darker): multiply by a neutral grey copy
  // of the roughness channel (1 on dry asphalt, darker in puddles; no colour cast)
  const [gr2, gg2] = canvas(N, N);
  const src = rg.getImageData(0, 0, N, N), dst = gg2.createImageData(N, N);
  for (let i = 0; i < src.data.length; i += 4) {
    const v = Math.min(255, Math.round(255 * (0.55 + 0.45 * Math.min(1, src.data[i + 1] / 150))));
    dst.data[i] = dst.data[i + 1] = dst.data[i + 2] = v; dst.data[i + 3] = 255;
  }
  gg2.putImageData(dst, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.drawImage(gr2, 0, 0);
  g.globalCompositeOperation = 'source-over';
  return { map: tex(c), rough: tex(r, { srgb: false }) };
}

// ---------------------------------------------------------------- paving
export function paving(rng) {
  const N = 512, cells = 8; // 8x8 slabs per tile
  const [c, g] = canvas(N, N, 2);
  const s = N / cells;
  g.fillStyle = '#5e5b57';
  g.fillRect(0, 0, N, N);
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const v = rng.int(-10, 10);
      g.fillStyle = `rgb(${112 + v},${108 + v},${102 + v})`;
      g.fillRect(x * s + 1, y * s + 1, s - 2, s - 2);
    }
  }
  speckle(g, rng, N, N, 9000, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.08)'], [1, 2]);
  for (let i = 0; i < 20; i++) {
    g.fillStyle = `rgba(30,28,26,${rng.float(0.1, 0.25)})`;
    g.beginPath();
    g.arc(rng.float(0, N), rng.float(0, N), rng.float(4, 22), 0, 6.3);
    g.fill();
  }
  grain(c, g, 70000, ['rgba(0,0,0,0.10)', 'rgba(255,255,255,0.07)', 'rgba(60,56,50,0.12)'], 0x51ab);
  const [r, rg] = canvas(N, N);
  rg.fillStyle = 'rgb(0,185,0)';
  rg.fillRect(0, 0, N, N);
  rg.fillStyle = 'rgb(0,150,0)'; // joints
  for (let k = 0; k <= cells; k++) { rg.fillRect(k * s - 1, 0, 2, N); rg.fillRect(0, k * s - 1, N, 2); }
  for (let i = 0; i < 10; i++) {
    const x = rng.float(0, N), y = rng.float(0, N), rad = rng.float(14, 46);
    const gr = rg.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(0,45,0,0.9)');
    gr.addColorStop(1, 'rgba(0,185,0,0)');
    rg.fillStyle = gr;
    rg.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return { map: tex(c), rough: tex(r, { srgb: false }) };
}

// ---------------------------------------------------------------- facades
// Each facade tile is 16 bays x 16 floors. albedo / emissive (lit windows) /
// surface (G roughness, B metalness).
export const FACADE_BAYS = 16;

export function facade(style, rng) {
  const N = 1024, B = N / FACADE_BAYS;
  const [c, g] = canvas(N, N, 2);   // albedo at 2048 (emissive / surface stay at 512)
  const [e, eg] = canvas(N / 2, N / 2);
  const [s, sg] = canvas(N / 2, N / 2);
  eg.fillStyle = '#000'; eg.fillRect(0, 0, N / 2, N / 2);
  eg.scale(0.5, 0.5);
  sg.scale(0.5, 0.5);
  const warm = ['#ffcf8a', '#ffd9a0', '#ffc070', '#ffe2b8'];
  const cool = ['#cfe2ff', '#e6f0ff', '#bcd6ff'];
  const lit = (x, y, w, h, color, k) => {
    const gr = eg.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, shade(color, 0.55 * k));
    gr.addColorStop(1, shade(color, k));
    eg.fillStyle = gr;
    eg.fillRect(x, y, w, h);
  };

  if (style === 0) { // glass curtain wall
    sg.fillStyle = 'rgb(0,40,170)'; sg.fillRect(0, 0, N, N);
    for (let fy = 0; fy < FACADE_BAYS; fy++) {
      const floorLit = rng.chance(0.55) ? rng.float(0.2, 0.85) : rng.float(0, 0.1);
      const floorCol = rng.chance(0.7) ? rng.pick(cool) : rng.pick(warm);
      for (let fx = 0; fx < FACADE_BAYS; fx++) {
        const x = fx * B, y = fy * B;
        const gr = g.createLinearGradient(0, y, 0, y + B);
        gr.addColorStop(0, '#2a3c4c'); gr.addColorStop(1, '#16222e');
        g.fillStyle = gr; g.fillRect(x, y, B, B);
        g.fillStyle = '#2c333b'; g.fillRect(x, y + B - 12, B, 12); // spandrel
        g.fillStyle = '#4a5560'; g.fillRect(x, y, 3, B); g.fillRect(x, y + B - 13, B, 2);
        sg.fillStyle = 'rgb(0,170,40)'; sg.fillRect(x, y + B - 12, B, 12);
        if (rng.chance(floorLit)) lit(x + 3, y + 2, B - 3, B - 15, floorCol, rng.float(0.45, 0.95));
      }
    }
  } else if (style === 1) { // brick with punched windows
    g.fillStyle = '#5b2b22'; g.fillRect(0, 0, N, N);
    for (let y = 0; y < N; y += 4) {
      for (let x = (y / 4) % 2 ? -4 : 0; x < N; x += 9) {
        const v = rng.int(-14, 14);
        g.fillStyle = `rgb(${128 + v},${62 + v * 0.5},${48 + v * 0.4})`;
        g.fillRect(x, y, 8, 3);
      }
    }
    sg.fillStyle = 'rgb(0,235,0)'; sg.fillRect(0, 0, N, N);
    for (let fy = 0; fy < FACADE_BAYS; fy++) {
      for (let fx = 0; fx < FACADE_BAYS; fx++) {
        const x = fx * B + 18, y = fy * B + 12, w = B - 36, h = B - 26;
        g.fillStyle = '#c9bfae'; g.fillRect(x - 3, y - 5, w + 6, 4); // lintel
        g.fillStyle = '#d8d0c0'; g.fillRect(x - 2, y + h, w + 4, 3);  // sill
        g.fillStyle = '#e4ddcf'; g.fillRect(x - 2, y - 1, w + 4, h + 1);
        g.fillStyle = '#141a22'; g.fillRect(x, y + 1, w, h - 2);
        g.fillStyle = '#e4ddcf'; g.fillRect(x, y + h / 2 - 1, w, 2);
        sg.fillStyle = 'rgb(0,30,0)'; sg.fillRect(x, y, w, h);
        if (rng.chance(0.34)) {
          const tv = rng.chance(0.12);
          lit(x, y + 1, w, h - 2, tv ? '#8fb4ff' : rng.pick(warm), rng.float(0.5, 1));
          eg.fillStyle = 'rgba(0,0,0,0.6)'; eg.fillRect(x, y + h / 2 - 1, w, 2);
          if (rng.chance(0.5)) { eg.fillStyle = 'rgba(0,0,0,0.45)'; eg.fillRect(x, y + 1, w * rng.float(0.2, 0.45), h - 2); }
        }
      }
    }
  } else if (style === 2) { // concrete with ribbon windows
    g.fillStyle = '#8f8d88'; g.fillRect(0, 0, N, N);
    speckle(g, rng, N, N, 12000, ['rgba(0,0,0,0.08)', 'rgba(255,255,255,0.06)']);
    sg.fillStyle = 'rgb(0,215,0)'; sg.fillRect(0, 0, N, N);
    for (let fy = 0; fy < FACADE_BAYS; fy++) {
      const y = fy * B + 16, h = B - 30;
      g.fillStyle = '#1a222b'; g.fillRect(0, y, N, h);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y + h, N, 4);
      sg.fillStyle = 'rgb(0,35,90)'; sg.fillRect(0, y, N, h);
      let run = 0, on = false, col = cool[0], k = 1;
      for (let fx = 0; fx < FACADE_BAYS * 2; fx++) {
        if (run-- <= 0) { run = rng.int(1, 6); on = rng.chance(0.4); col = rng.chance(0.6) ? rng.pick(cool) : rng.pick(warm); k = rng.float(0.5, 1); }
        if (on) lit(fx * B / 2, y, B / 2, h, col, k);
      }
      g.fillStyle = '#6f6d69';
      for (let fx = 0; fx < FACADE_BAYS * 2; fx++) g.fillRect(fx * B / 2, y, 2, h);
    }
  } else { // stucco with shutters (tinted pastel by vertex colour)
    g.fillStyle = '#e9e2d6'; g.fillRect(0, 0, N, N);
    speckle(g, rng, N, N, 16000, ['rgba(0,0,0,0.05)', 'rgba(120,100,80,0.06)', 'rgba(255,255,255,0.08)'], [1, 3]);
    sg.fillStyle = 'rgb(0,225,0)'; sg.fillRect(0, 0, N, N);
    for (let fy = 0; fy < FACADE_BAYS; fy++) {
      for (let fx = 0; fx < FACADE_BAYS; fx++) {
        const x = fx * B + 22, y = fy * B + 12, w = B - 44, h = B - 24;
        g.fillStyle = '#f6f1e8'; g.fillRect(x - 3, y - 3, w + 6, h + 6);
        g.fillStyle = '#151a20'; g.fillRect(x, y, w, h);
        sg.fillStyle = 'rgb(0,30,0)'; sg.fillRect(x, y, w, h);
        const closed = rng.chance(0.25);
        g.fillStyle = rng.chance(0.5) ? '#2f5a52' : '#3b4f6b';
        if (closed) { g.fillRect(x, y, w, h); g.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = 3; k < h; k += 4) g.fillRect(x, y + k, w, 1); }
        else { g.fillRect(x - 10, y, 8, h); g.fillRect(x + w + 2, y, 8, h); }
        g.fillStyle = '#2a2a2a'; g.fillRect(x - 4, y + h + 2, w + 8, 2); // balcony rail
        for (let k = x - 4; k < x + w + 4; k += 4) g.fillRect(k, y + h - 6, 1, 8);
        if (!closed && rng.chance(0.4)) lit(x, y, w, h, rng.pick(warm), rng.float(0.55, 1));
      }
    }
  }
  return { map: tex(c), emissive: tex(e), surface: tex(s, { srgb: false }) };
}

function shade(hex, k) {
  const c = new THREE.Color(hex);
  return `rgb(${Math.round(c.r * 255 * k)},${Math.round(c.g * 255 * k)},${Math.round(c.b * 255 * k)})`;
}

// ---------------------------------------------------------------- shopfronts
// 4 variants stacked vertically; each 1 UV unit wide = one 4.5 m bay.
export const SHOP_VARIANTS = 4;
export function shopfronts(rng) {
  const W = 256, H = 128, N = SHOP_VARIANTS;
  const [c, g] = canvas(W, H * N, 2);
  const [e, eg] = canvas(W, H * N, 2);
  eg.fillStyle = '#000'; eg.fillRect(0, 0, W, H * N);
  const glows = ['#ffc98a', '#93b3d3', '#000000', '#ffa868'];
  for (let v = 0; v < N; v++) {
    const y0 = v * H;
    g.fillStyle = '#1c1d20'; g.fillRect(0, y0, W, H);
    if (v === 2) { // roller shutter
      g.fillStyle = '#5d6066'; g.fillRect(8, y0 + 6, W - 16, H - 8);
      for (let k = 6; k < H - 2; k += 4) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(8, y0 + k, W - 16, 1); }
      continue;
    }
    const gr = g.createLinearGradient(0, y0, 0, y0 + H);
    gr.addColorStop(0, '#30343a'); gr.addColorStop(1, '#101215');
    g.fillStyle = gr; g.fillRect(10, y0 + 8, W - 20, H - 14);
    const eg2 = eg.createLinearGradient(0, y0, 0, y0 + H);
    eg2.addColorStop(0, glows[v]); eg2.addColorStop(1, shade(glows[v], 0.45));
    eg.fillStyle = eg2; eg.fillRect(10, y0 + 8, W - 20, H - 14);
    // interior: ceiling lights, shelving or counter, a few soft figures
    for (let k = 0; k < 5; k++) {
      const x = 20 + k * 48 + rng.float(-6, 6);
      const gl = eg.createRadialGradient(x, y0 + 14, 0, x, y0 + 14, 22);
      gl.addColorStop(0, 'rgba(255,250,235,0.9)'); gl.addColorStop(1, 'rgba(255,250,235,0)');
      eg.fillStyle = gl; eg.fillRect(x - 22, y0 + 8, 44, 30);
    }
    if (v === 1) {
      for (let k = 0; k < 4; k++) { eg.fillStyle = 'rgba(0,0,0,0.28)'; eg.fillRect(12, y0 + 46 + k * 17, W - 24, 4); }
      for (let k = 0; k < 40; k++) {
        eg.fillStyle = `hsla(${rng.int(0, 360)},60%,60%,0.35)`;
        eg.fillRect(rng.float(14, W - 20), y0 + 36 + rng.int(0, 3) * 17, rng.float(4, 9), 8);
      }
    } else {
      eg.fillStyle = 'rgba(30,14,6,0.35)'; eg.fillRect(12, y0 + 92, W - 24, 20); // counter / tables
    }
    for (let k = 0; k < 3; k++) {
      const x = rng.float(30, W - 40), h = rng.float(46, 58);
      eg.fillStyle = 'rgba(20,10,8,0.32)';
      eg.beginPath(); eg.arc(x, y0 + H - 14 - h, 7, 0, 6.3); eg.fill();
      eg.beginPath(); eg.ellipse(x, y0 + H - 14 - h / 2 + 6, 10, h / 2 - 6, 0, 0, 6.3); eg.fill();
    }
    // mullions & door
    g.fillStyle = '#0b0b0c'; eg.fillStyle = '#000';
    for (const x of [0, W / 2 - 3, W - 10]) { g.fillRect(x, y0, 10, H); eg.fillRect(x, y0, 10, H); }
    g.fillRect(0, y0 + 30, W, 4); eg.fillRect(0, y0 + 30, W, 4);
    g.fillStyle = '#2b2b2e'; g.fillRect(0, y0 + H - 8, W, 8); eg.fillRect(0, y0 + H - 8, W, 8);
  }
  const map = tex(c), emissive = tex(e);
  map.wrapT = emissive.wrapT = THREE.ClampToEdgeWrapping;
  return { map, emissive };
}

// ---------------------------------------------------------------- neon signs
// Horizontal signs: 2 columns x 6 rows of 512x96 in the top 576 px.
// Vertical blades: 10 columns of 96x448 below. Returns UV rects.
export const SIGN_WORDS = ['NOODLE BAR', 'PAWN & LOAN', 'HOTEL MARINA', 'OYSTERS', 'LIQUOR', 'KARAOKE',
  'DINER 24H', 'TATTOO', 'CLUB TIDE', 'PHARMACY', 'LAUNDROMAT', 'BAIT & TACKLE'];
export const BLADE_WORDS = ['HOTEL', 'BAR', 'LIVE', 'CLUB', 'RAMEN', 'DANCE', 'GRILL', 'SALOON', 'JAZZ', 'MOTEL'];

export function neonSigns(rng, palette) {
  const N = 1024, SS = 2;            // UV rects stay in N space; the atlas is drawn at 2048
  const [c, g] = canvas(N, N, SS);
  g.fillStyle = '#000'; g.fillRect(0, 0, N, N);
  const hRects = [], vRects = [], hColors = [], vColors = [];
  const glowText = (text, x, y, size, color, vertical) => {
    g.save();
    g.font = `900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [blur, alpha, col] of [[28, 0.9, color], [12, 1, color], [0, 1, '#fff6ee']]) {
      g.shadowColor = color; g.shadowBlur = blur * SS; g.globalAlpha = alpha; g.fillStyle = col;
      if (!vertical) g.fillText(text, x, y);
      else [...text].forEach((ch, i, arr) => g.fillText(ch, x, y + (i - (arr.length - 1) / 2) * size * 1.02));
      if (blur === 0) { g.lineWidth = 2; g.strokeStyle = color; }
    }
    g.restore();
  };
  SIGN_WORDS.forEach((word, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = col * 512, y = row * 96;
    const color = palette[(i * 3) % palette.length];
    hColors.push(color);
    g.strokeStyle = color; g.lineWidth = 3; g.shadowColor = color; g.shadowBlur = 10 * SS;
    g.strokeRect(x + 10, y + 10, 492, 76);
    g.shadowBlur = 0;
    let size = 54;
    g.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
    while (g.measureText(word).width > 440 && size > 20) { size -= 2; g.font = `900 ${size}px "Arial Black", Arial, sans-serif`; }
    glowText(word, x + 256, y + 50, size, color, false);
    hRects.push([x / N, 1 - (y + 96) / N, 512 / N, 96 / N]);
  });
  BLADE_WORDS.forEach((word, i) => {
    const x = i * 96 + 32 * 0, y = 576;
    const color = palette[(i * 5 + 1) % palette.length];
    vColors.push(color);
    g.strokeStyle = color; g.lineWidth = 3; g.shadowColor = color; g.shadowBlur = 10 * SS;
    g.strokeRect(x + 8, y + 8, 80, 432);
    g.shadowBlur = 0;
    const size = Math.min(62, 400 / word.length);
    glowText(word, x + 48, y + 224, size, color, true);
    vRects.push([x / N, 1 - (y + 448) / N, 96 / N, 448 / N]);
  });
  const t = tex(c, { repeat: false });
  return { map: t, hRects, vRects, hColors, vColors };
}

// ---------------------------------------------------------------- billboards
export const BILLBOARD_COUNT = 4;
export function billboards() {
  const W = 1024, H = 512;
  const [c, g] = canvas(W, H, 2);
  const ads = [
    { bg: ['#ff6f61', '#ffb347'], title: 'SALVO', sub: 'COLA · ICE COLD SINCE 1961', fg: '#fff8ee' },
    { bg: ['#0f3b46', '#3fe0d0'], title: 'TIDEWATER', sub: 'SAVINGS & TRUST', fg: '#e8fff9' },
    { bg: ['#2a1640', '#ff4f7a'], title: '98.4 FM', sub: 'NIGHTSHIFT RADIO', fg: '#ffe6f0' },
    { bg: ['#1c1c22', '#9aa3ad'], title: 'KAITO GT', sub: 'DRIVE THE HARBOUR', fg: '#ffffff' },
  ];
  ads.forEach((ad, i) => {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 256;
    const gr = g.createLinearGradient(x, y, x + 512, y + 256);
    gr.addColorStop(0, ad.bg[0]); gr.addColorStop(1, ad.bg[1]);
    g.fillStyle = gr; g.fillRect(x, y, 512, 256);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath(); g.arc(x + 420, y + 70, 110, 0, 6.3); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y + 196, 512, 60);
    g.fillStyle = ad.fg; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = '900 86px "Arial Black", Impact, sans-serif'; g.fillText(ad.title, x + 28, y + 140);
    g.font = 'bold 26px "Helvetica Neue", Arial, sans-serif'; g.fillText(ad.sub, x + 30, y + 236);
    g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(x + 3, y + 3, 506, 250);
  });
  return tex(c, { repeat: false });
}

// ---------------------------------------------------------------- misc
export function awningStripes() {
  const [c, g] = canvas(128, 32);
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#f2ece0' : '#ffffff'; g.fillRect(i * 16, 0, 16, 32); }
  g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(0, 26, 128, 6);
  return tex(c);
}

// Soft radial falloff: white at centre, transparent at edge. Used for contact
// shadows (tinted black) and lamp light pools (tinted amber, additive).
export function radial(power = 1.6) {
  const N = 128;
  const [c, g] = canvas(N, N);
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - N / 2 + 0.5, y - N / 2 + 0.5) / (N / 2);
      const a = Math.max(0, 1 - d);
      const v = Math.pow(a, power);
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(v * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return tex(c, { repeat: false, srgb: false });
}
