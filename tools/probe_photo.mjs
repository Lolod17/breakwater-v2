// PASS 15b photo mode probe. Real CDP keyboard input throughout (the game is
// started with ?autostart; tool hooks only read state, except stage('drive')
// which sets up the in-car case).
//   node tools/probe_photo.mjs [--port 8122] [--headed]
// 1. on foot: P enters photo mode: HUD hidden, panel shown, audio clock suspended.
// 2. frozen: over 1.5 s the simulation time, the clock, the player, the fleet and the crowd do not move.
// 3. free camera: W / Space / Left / Z / = / ] move, raise, turn, roll the camera, widen the FOV and
//    raise the depth of field; the render camera follows; the FOV slider drives the FOV.
// 4. depth of field: a blurred frame has much less fine detail than a sharp one (edge energy).
// 5. filters 1-4: neutral, noir (no colour), warm film (redder than neutral), neon (more saturated).
// 6. hide: H hides the photo panel (the game HUD stays hidden); H brings it back.
// 7. Enter saves a PNG into the downloads folder (valid signature, canvas size).
// 8. P leaves: the world state at exit equals the state at entry exactly (time, clock, player,
//    fleet, crowd, health, money, wanted), the render camera pose and FOV are restored, the HUD
//    is back, audio resumes, and the simulation runs again.
// 9. the same in a moving car (stage 'drive'): car pose and speed restored exactly.
// Pass: every check true, 0 console errors, 0 off-site requests.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { launch, startServer, watchPage } from './cdp.mjs';

const argv = process.argv.slice(2);
const port = Number(argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : 8122);
const server = await startServer(port);
const page = await launch({ port: 9362, headless: !argv.includes('--headed') });
const watch = watchPage(page, new URL(server.url).host);
const downloads = mkdtempSync(join(tmpdir(), 'bw-photo-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const step = (m) => process.stderr.write(`[probe_photo] ${((Date.now() - T0) / 1000).toFixed(1)}s ${m}\n`);
const ev = (js, ms = 60000) => Promise.race([page.evaluate(js), new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out: ${js.slice(0, 60)}`)), ms))]);
const VK = { KeyP: 80, KeyW: 87, KeyH: 72, KeyZ: 90, Space: 32, ArrowLeft: 37, Equal: 187, BracketRight: 221, BracketLeft: 219, Enter: 13, Digit1: 49, Digit2: 50, Digit3: 51, Digit4: 52, ShiftLeft: 16 };
const KEY = { KeyP: 'p', KeyW: 'w', KeyH: 'h', KeyZ: 'z', Space: ' ', ArrowLeft: 'ArrowLeft', Equal: '=', BracketRight: ']', BracketLeft: '[', Enter: 'Enter', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', ShiftLeft: 'Shift' };
const keyEv = (type, code) => page.send('Input.dispatchKeyEvent', { type, code, key: KEY[code], windowsVirtualKeyCode: VK[code] ?? 0, ...(type === 'keyDown' && code === 'Enter' ? { text: '\r' } : {}) });
const press = async (code) => { await keyEv('keyDown', code); await keyEv('keyUp', code); await sleep(120); };
const hold = async (code, ms) => { await keyEv('keyDown', code); await sleep(ms); await keyEv('keyUp', code); await sleep(60); };

// ---- PNG decode (8-bit RGB/RGBA) for frame statistics
function decodePNG(buf) {
  let p = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    if (type === 'IHDR') { w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12); ct = buf[p + 17]; }
    else if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp, raw = inflateSync(Buffer.concat(idat)), out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, bpp, data: out };
}
async function frameStats() {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1280, height: 720, scale: 0.5 } });
  const img = decodePNG(Buffer.from(data, 'base64'));
  let sat = 0, r = 0, b = 0, edge = 0, n = 0;
  for (let y = 0; y < img.h - 1; y++) for (let x = 0; x < img.w - 1; x++) {
    const o = (y * img.w + x) * img.bpp, R = img.data[o], G = img.data[o + 1], B = img.data[o + 2];
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    sat += mx ? (mx - mn) / mx : 0; r += R; b += B;
    const l = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const o2 = o + img.bpp, o3 = o + img.w * img.bpp;
    edge += Math.abs(l - (0.2126 * img.data[o2] + 0.7152 * img.data[o2 + 1] + 0.0722 * img.data[o2 + 2]))
      + Math.abs(l - (0.2126 * img.data[o3] + 0.7152 * img.data[o3 + 1] + 0.0722 * img.data[o3 + 2]));
    n++;
  }
  return { sat: +(sat / n).toFixed(4), redBlue: +(r / Math.max(1, b)).toFixed(4), edge: +(edge / n).toFixed(3) };
}
const photo = () => ev('window.__game.photo()');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const checks = {}, out = {};

try {
  try { await page.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads }); }
  catch { await page.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads }); }
  await page.goto(`${server.url}?autostart&seed=1337`);
  await page.waitFor(() => page.evaluate('!!(window.__game && window.__game.ready)'), 60000);
  await ev('localStorage.clear()');
  await press('ShiftLeft');                  // a user gesture: the audio context starts
  await sleep(1500);

  // ---------------------------------------------------------------- 1. enter
  step('1. enter on foot');
  await press('KeyP');
  await sleep(500);
  let p = await photo();
  out.enter = { active: p.active, hudVisible: p.hudVisible, panelVisible: p.panelVisible, audio: p.audio, camera: p.camera, fov: p.fov };
  checks.enters = p.active && !p.hudVisible && p.panelVisible;
  checks.audioSuspended = p.audio === 'suspended';

  // ---------------------------------------------------------------- 2. frozen
  step('2. frozen');
  const s0 = await ev('({ t: window.__game.simTime(), clock: window.__game.clock(), player: window.__game.player(), cars: window.__game.vehicles().map((v) => [v.x, v.z]), peds: window.__game.population().peds.map((q) => [q.x, q.z]) })');
  await sleep(1500);
  const s1 = await ev('({ t: window.__game.simTime(), clock: window.__game.clock(), player: window.__game.player(), cars: window.__game.vehicles().map((v) => [v.x, v.z]), peds: window.__game.population().peds.map((q) => [q.x, q.z]) })');
  out.frozen = { t0: s0.t, t1: s1.t, clock: s1.clock };
  checks.simulationFrozen = s0.t === s1.t && same(s0.clock, s1.clock) && same(s0.player, s1.player) && same(s0.cars, s1.cars) && same(s0.peds, s1.peds);

  // ---------------------------------------------------------------- 3. free camera
  step('3. free camera');
  const c0 = (await photo()).camera;
  await hold('KeyW', 700);
  await hold('Space', 400);
  await hold('ArrowLeft', 400);
  await hold('KeyZ', 400);
  await hold('Equal', 400);
  await hold('BracketRight', 500);
  await sleep(150);
  p = await photo();
  const c1 = p.camera;
  out.camera = { from: c0, to: c1, fov: [out.enter.fov, p.fov], dof: p.dof, render: p.renderCamera };
  checks.cameraMoves = Math.hypot(c1.x - c0.x, c1.z - c0.z) > 1.5 && c1.y > c0.y + 0.5;
  checks.cameraTurnsAndRolls = Math.abs(c1.yaw - c0.yaw) > 0.2 && Math.abs(c1.roll) > 0.15;
  checks.fovAndDofKeys = p.fov > out.enter.fov + 4 && p.dof > 0.5;
  checks.renderCameraFollows = Math.abs(p.renderCamera.x - c1.x) < 1e-3 && Math.abs(p.renderCamera.z - c1.z) < 1e-3 && Math.abs(p.renderCamera.fov - p.fov) < 0.01;
  // the FOV slider (as the mouse would move it)
  await ev(`(() => { const s = document.getElementById('photo-fov'); s.value = 35; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); })()`);
  await sleep(200);
  p = await photo();
  out.slider = { fov: p.fov, label: await ev(`document.getElementById('photo-fov-v').textContent`) };
  checks.fovSlider = Math.abs(p.fov - 35) < 0.01 && Math.abs(p.renderCamera.fov - 35) < 0.01 && out.slider.label === '35°';
  await ev(`(() => { const s = document.getElementById('photo-fov'); s.value = 55; s.dispatchEvent(new Event('input')); })()`);

  // ---------------------------------------------------------------- 6 (first half). hide the panel for clean frames
  step('6. hide panel');
  await press('KeyH');
  await sleep(300);
  p = await photo();
  const hidden = { uiHidden: p.uiHidden, panelVisible: p.panelVisible, hudVisible: p.hudVisible };

  // ---------------------------------------------------------------- 4. depth of field
  step('4. depth of field');
  await hold('BracketRight', 1200);
  await sleep(250);
  const blurred = await frameStats();
  const dofHi = (await photo()).dof;
  await hold('BracketLeft', 2200);
  await sleep(250);
  const sharp = await frameStats();
  const dofLo = (await photo()).dof;
  out.dof = { blurred: { dof: dofHi, edge: blurred.edge }, sharp: { dof: dofLo, edge: sharp.edge } };
  checks.depthOfField = dofHi === 1 && dofLo === 0 && blurred.edge < sharp.edge * 0.8;

  // ---------------------------------------------------------------- 5. filters
  step('5. filters');
  const looks = {};
  for (const [code, name] of [['Digit1', 'neutral'], ['Digit2', 'noir'], ['Digit3', 'warm film'], ['Digit4', 'neon']]) {
    await press(code);
    await sleep(300);
    const st = await photo();
    looks[name] = { selected: st.filter, ...(await frameStats()) };
  }
  out.filters = looks;
  checks.filtersSelect = Object.entries(looks).every(([n, l]) => l.selected === n);
  checks.filterNoir = looks.noir.sat < 0.03 && looks.neutral.sat > 0.12;
  checks.filterWarm = looks['warm film'].redBlue > looks.neutral.redBlue * 1.12;
  checks.filterNeon = looks.neon.sat > looks.neutral.sat * 1.15;
  await press('Digit1');

  // ---------------------------------------------------------------- 6 (second half)
  await press('KeyH');
  await sleep(300);
  p = await photo();
  out.hide = { hidden, shown: { uiHidden: p.uiHidden, panelVisible: p.panelVisible, hudVisible: p.hudVisible } };
  checks.hideHud = hidden.uiHidden && !hidden.panelVisible && !hidden.hudVisible && !p.uiHidden && p.panelVisible && !p.hudVisible;

  // ---------------------------------------------------------------- 7. save PNG
  step('7. save PNG');
  await press('Enter');
  let files = [];
  for (let i = 0; i < 50 && !files.length; i++) { await sleep(100); files = readdirSync(downloads).filter((f) => f.endsWith('.png')); }
  await sleep(300);
  const shot = (await photo()).lastShot;
  const buf = files.length ? readFileSync(join(downloads, files[0])) : Buffer.alloc(0);
  const sig = buf.subarray(0, 8).toString('hex'), pw = buf.length > 24 ? buf.readUInt32BE(16) : 0, ph = buf.length > 24 ? buf.readUInt32BE(20) : 0;
  const canvasSize = await ev(`[document.getElementById('game').width, document.getElementById('game').height]`);
  out.png = { files, bytes: buf.length, size: [pw, ph], canvas: canvasSize, shot };
  checks.savesPng = files.length === 1 && files[0] === shot?.name && sig === '89504e470d0a1a0a' && pw === canvasSize[0] && ph === canvasSize[1] && buf.length > 20000;
  if (buf.length) {
    const img = decodePNG(buf);
    let lum = 0;
    for (let i = 0; i < img.w * img.h; i += 7) { const o = i * img.bpp; lum += img.data[o] + img.data[o + 1] + img.data[o + 2]; }
    out.png.meanLuma = +(lum / (3 * 255 * img.w * img.h / 7)).toFixed(3);
    checks.pngHasImage = out.png.meanLuma > 0.03;
  }

  // ---------------------------------------------------------------- 8. exit restores
  step('8. exit restores');
  await press('KeyP');
  await sleep(400);
  p = await photo();
  const snaps = await ev('window.__game.photoSnaps()');
  out.exit = { active: p.active, hudVisible: p.hudVisible, panelVisible: p.panelVisible, audio: p.audio, enter: snaps.enter, exit: snaps.exit };
  checks.exitRestoresWorld = !!snaps.enter && !!snaps.exit && same({ ...snaps.enter, camera: 0 }, { ...snaps.exit, camera: 0 });
  checks.exitRestoresCamera = !!snaps.exit && same(snaps.enter.camera, snaps.exit.camera);
  checks.exitShowsHud = !p.active && p.hudVisible && !p.panelVisible;
  checks.audioResumes = p.audio === 'running';
  const t1 = await ev('window.__game.simTime()');
  await sleep(600);
  const t2 = await ev('window.__game.simTime()');
  out.resumed = { t1, t2 };
  checks.simulationResumes = t2 > t1 + 0.2 && t1 >= snaps.enter.simTime;

  // ---------------------------------------------------------------- 9. in a moving car
  step('9. in a moving car');
  await ev(`window.__game.stage('drive')`);
  await ev('window.__game.resume()');
  await sleep(1200);
  await press('KeyP');
  await sleep(300);
  const inCar = await photo();
  const a = await ev('window.__game.car()');
  await hold('KeyW', 500);
  await sleep(800);
  const b = await ev('window.__game.car()');
  await press('KeyP');
  await sleep(300);
  const carSnaps = await ev('window.__game.photoSnaps()');
  const c = await ev('window.__game.car()');
  out.car = { active: inCar.active, frozen: [a, b].map((v) => ({ x: v.x, z: v.z, speed: v.speed })), enter: carSnaps.enter.car, exit: carSnaps.exit?.car, after: { x: c.x, z: c.z, speed: c.speed } };
  checks.carFrozenAndRestored = inCar.active && same(a, b) && a.speed > 3 && !!carSnaps.exit && same({ ...carSnaps.enter, camera: 0 }, { ...carSnaps.exit, camera: 0 })
    && same(carSnaps.enter.camera, carSnaps.exit.camera) && Math.hypot(c.x - b.x, c.z - b.z) > 1;
} catch (e) {
  out.error = String(e.stack || e);
} finally {
  await page.close();
  server.stop();
  rmSync(downloads, { recursive: true, force: true });
}
out.consoleErrors = watch.errors.length;
out.offsiteRequests = watch.offsite.length;
if (watch.errors.length) out.errors = watch.errors.slice(0, 5);
const pass = !out.error && Object.keys(checks).length >= 22 && Object.values(checks).every(Boolean) && !watch.errors.length && !watch.offsite.length;
console.log(JSON.stringify({ pass, checks, ...out }, null, 1));
if (!pass) process.exitCode = 1;
