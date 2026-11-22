// PASS 15b polish probe: menu transition, mission toasts, objective fade, damage /
// low-health vignette, speed lines, the saved look on the player, and HUD
// legibility when a 1280x720 frame is shown at 768x432.
//   node tools/probe_polish.mjs [--port 8124] [--headed] [--shots DIR]
// --shots DIR also writes the 768x432 frames it judged (foot + mission, driving fast) as PNG.
// Legibility rule, per visible text element of the HUD (the station panel is part of it; the photo panel when open):
// font size x 0.6 >= 7.8 px (13 px at 720p), weight >= 600 below 16 px, inside the viewport,
// and either a backing panel (alpha >= .35 on it or an ancestor in the HUD) or a dark text shadow.
// Pass: every check true, 0 console errors, 0 off-site requests.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, startServer, watchPage } from './cdp.mjs';

const argv = process.argv.slice(2);
const port = Number(argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : 8124);
const shotsDir = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : null;
const server = await startServer(port);
const page = await launch({ port: 9364, headless: !argv.includes('--headed') });
const watch = watchPage(page, new URL(server.url).host);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const step = (m) => process.stderr.write(`[probe_polish] ${((Date.now() - T0) / 1000).toFixed(1)}s ${m}\n`);
const ev = (js, ms = 60000) => Promise.race([page.evaluate(js), new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out: ${js.slice(0, 60)}`)), ms))]);
const VK = { Enter: 13, KeyW: 87, KeyR: 82, ShiftLeft: 16 };
const KEY = { Enter: 'Enter', KeyW: 'w', KeyR: 'r', ShiftLeft: 'Shift' };
const keyEv = (type, code) => page.send('Input.dispatchKeyEvent', { type, code, key: KEY[code], windowsVirtualKeyCode: VK[code], ...(type === 'keyDown' && code === 'Enter' ? { text: '\r' } : {}) });
const press = async (code) => { await keyEv('keyDown', code); await keyEv('keyUp', code); await sleep(120); };

const LEGIBLE = `(() => {
  const vw = innerWidth, vh = innerHeight, bad = [], seen = [];
  const roots = ['hud', 'photo'].map((id) => document.getElementById(id)).filter(Boolean);
  const alphaOf = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return 0; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1; };
  const backed = (n) => { for (let e = n; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e);
    if (alphaOf(cs.backgroundColor) >= 0.35 || /gradient/.test(cs.backgroundImage)) return true; if (e.id === 'hud') break; } return false; };
  for (const root of roots) for (const n of root.querySelectorAll('*')) {
    if (n.closest('[hidden]') || !n.getClientRects().length) continue;
    const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(n);
    if (cs.visibility !== 'visible' || +cs.opacity === 0) continue;
    let hiddenUp = false; for (let e = n; e; e = e.parentElement) { const s = getComputedStyle(e); if (+s.opacity === 0 || s.visibility === 'hidden') { hiddenUp = true; break; } }
    if (hiddenUp) continue;
    const r = n.getBoundingClientRect(), size = parseFloat(cs.fontSize), weight = +cs.fontWeight;
    const shadow = cs.textShadow !== 'none', panel = backed(n);
    const item = { el: n.id || n.className || n.tagName, text: n.textContent.trim().slice(0, 24), size, at432: +(size * 0.6).toFixed(1), weight, shadow, panel };
    seen.push(item);
    const why = [];
    if (size * 0.6 < 7.8) why.push('small');
    if (size < 16 && weight < 600) why.push('thin');
    if (!shadow && !panel) why.push('no backing');
    if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) why.push('off screen');
    if (why.length) bad.push({ ...item, why });
  }
  return { count: seen.length, min: Math.min(...seen.map((s) => s.size)), bad, sample: seen.slice(0, 60) };
})()`;
async function shot432(name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1280, height: 720, scale: 0.6 } });
  if (shotsDir) writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(data, 'base64'));
  const b = Buffer.from(data, 'base64');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}
const checks = {}, out = {};

try {
  // ---------------------------------------------------------------- 1. title -> play transition
  step('1. menu transition');
  await page.goto(`${server.url}?seed=1337`);
  await ev('localStorage.clear()');
  await page.goto(`${server.url}?seed=1337`);
  await page.waitFor(() => page.evaluate(`!!(window.__game && window.__game.ready) && !document.getElementById('start').hidden`), 60000);
  await sleep(800);
  await press('Enter');
  await sleep(80);
  const tr = await ev(`(() => { const t = document.getElementById('transition'); return { play: t.classList.contains('play'), anims: t.getAnimations().map((a) => a.animationName),
    opacity: +getComputedStyle(t).opacity, started: window.__game.started(), title: document.getElementById('start').hidden }; })()`);
  await sleep(1000);
  const trAfter = await ev(`+getComputedStyle(document.getElementById('transition')).opacity`);
  out.transition = { ...tr, after: trAfter };
  checks.menuTransition = tr.play && tr.anims.includes('dip') && tr.opacity > 0.2 && tr.started && tr.title && trAfter < 0.01;

  // ---------------------------------------------------------------- 2. toasts + objective fade
  step('2. toasts / objective');
  await ev('window.__game.missionStart(0)');
  await sleep(700);
  let t = await ev(`({ toasts: [...document.querySelectorAll('#toasts .toast')].map((e) => e.textContent), swap: document.getElementById('mission-objective').classList.contains('obj-swap'),
    anim: document.getElementById('mission-objective').getAnimations().map((a) => a.animationName), objective: document.getElementById('mission-objective').textContent })`);
  out.objective = t;
  checks.objectiveFades = t.swap && t.objective.length > 3;
  checks.toastObjective = t.toasts.some((x) => x.startsWith('NEW OBJECTIVE') && x.includes(t.objective));
  await ev('window.__game.forceWanted(2)');
  await sleep(400);
  await ev(`window.__game.missionFail('Probe: the package was lost')`);
  await sleep(400);
  t = await ev(`[...document.querySelectorAll('#toasts .toast')].map((e) => ({ cls: e.className, text: e.textContent }))`);
  out.toasts = t;
  checks.toastWanted = t.some((x) => /toast-wanted/.test(x.cls) && x.text.startsWith('WANTED') && x.text.includes('★★'));
  checks.toastFail = t.some((x) => /toast-fail/.test(x.cls) && x.text.includes('MISSION FAILED') && x.text.includes('package was lost'));
  checks.toastsCapped = t.length <= 3;
  // legibility: on foot, mission failed card + toasts + wanted on screen
  const legFoot = await ev(LEGIBLE);
  out.legibleFoot = { count: legFoot.count, minPx: legFoot.min, bad: legFoot.bad };
  out.frameFoot = await shot432('hud-foot-768x432');
  await sleep(4200);
  const gone = await ev(`document.querySelectorAll('#toasts .toast').length`);
  checks.toastsExpire = gone === 0;

  // ---------------------------------------------------------------- 3. damage + low health vignette
  step('3. vignettes');
  await ev('window.__game.hurt(20)');
  await sleep(250);   // a few frames at any rAF rate (headless here runs ~16 fps, 60 ms was under one frame); fx-damage stays on until the next cue
  const d1 = await ev(`({ damage: document.getElementById('damage-vignette').classList.contains('fx-damage'), low: +document.getElementById('lowhp-vignette').style.opacity, status: window.__game.status().hp })`);
  await ev('window.__game.hurt(30)');
  await sleep(700);
  const d2 = await ev(`({ low: +getComputedStyle(document.getElementById('lowhp-vignette')).opacity, beat: document.getElementById('lowhp-vignette').classList.contains('beat'), hp: window.__game.status().hp })`);
  await ev('window.__game.hurt(25)');
  await sleep(700);
  const d3 = await ev(`({ low: +getComputedStyle(document.getElementById('lowhp-vignette')).opacity, beat: document.getElementById('lowhp-vignette').classList.contains('beat'), hp: window.__game.status().hp })`);
  out.vignette = { d1, d2, d3 };
  checks.damageVignette = d1.damage && d1.low === 0 && d2.low > 0 && !d2.beat && d3.low > d2.low && d3.beat;

  // ---------------------------------------------------------------- 4. speed lines at speed, radio panel, driving legibility
  step('4. speed lines');
  await ev(`window.__game.stage({ time: 31, car: { type: 'sports', x: 41.75, z: 196, yaw: Math.PI, speed: 36, paint: '#ff6a1a' }, run: 0 })`);
  await ev('window.__game.resume()');
  await keyEv('keyDown', 'KeyW');
  await sleep(900);
  const fast = await ev(`({ lines: window.__game.speedLines(), car: window.__game.car() })`);
  await press('KeyR');
  await sleep(150);
  const legDrive = await ev(LEGIBLE);
  out.frameDrive = await shot432('hud-drive-768x432');
  await keyEv('keyUp', 'KeyW');
  out.legibleDrive = { count: legDrive.count, minPx: legDrive.min, bad: legDrive.bad };
  await ev(`window.__game.stage('drive')`);           // 12 m/s
  await ev('window.__game.resume()');
  await sleep(1200);
  const slow = await ev(`({ lines: window.__game.speedLines(), car: window.__game.car() })`);
  out.speedLines = { fast: { kmh: +(fast.car.speed * 3.6).toFixed(1), ...fast.lines }, slow: { kmh: +(slow.car.speed * 3.6).toFixed(1), ...slow.lines } };
  checks.speedLines = fast.car.speed * 3.6 > 110 && fast.lines.intensity > 0.15 && fast.lines.drawn && slow.lines.intensity < 0.02 && !slow.lines.drawn;

  // ---------------------------------------------------------------- 5. photo panel legibility
  step('5. photo panel');
  await ev(`window.__game.tap('KeyP')`);
  await sleep(400);
  const legPhoto = await ev(LEGIBLE);
  out.legiblePhoto = { count: legPhoto.count, minPx: legPhoto.min, bad: legPhoto.bad };
  out.framePhoto = await shot432('photo-768x432');
  await ev(`window.__game.tap('KeyP')`);
  await sleep(300);
  checks.legibleAt768x432 = legFoot.count > 10 && legDrive.count > 10 && legPhoto.count > 10 && !legFoot.bad.length && !legDrive.bad.length && !legPhoto.bad.length
    && [out.frameFoot, out.frameDrive, out.framePhoto].every(([w, h]) => w === 768 && h === 432);
  checks.drivingHudIncludesRadioPanel = legDrive.sample.some((s) => s.el === 'rp-name');

  // ---------------------------------------------------------------- 6. the saved look on the player
  step('6. saved look');
  await ev(`window.__game.teleport(32.2, 150, true)`);
  await ev('window.__game.resume()');
  const saved = await ev('window.__game.save()');
  // a plain save: no outfitId / colours, the wardrobe look only
  await ev('window.__game.continueGame()');
  const plain = await ev('window.__game.outfitLook()');
  // the same save carrying outfitId + colours (as another writer would store them)
  await ev(`(() => { const raw = JSON.parse(localStorage.getItem('breakwater.save')); raw.outfitId = 'night'; raw.colours = { jacket: '#AA00FF', pants: '#123456', bogus: '#ffffff', shoe: 'red' };
    localStorage.setItem('breakwater.save', JSON.stringify(raw)); })()`);
  const cont = await ev('window.__game.continueGame()');
  const styled = await ev('window.__game.outfitLook()');
  out.look = { saved: !!saved.ok, plain, cont: cont.ok, styled };
  checks.outfitFromSave = !!saved.ok && plain.applied === null && cont.ok && styled.applied?.outfitId === 'night'
    && styled.palette.jacket === '#aa00ff' && styled.palette.pants === '#123456' && styled.palette.accent === '#00e6ff'
    && styled.palette.shoe === '#101114' && !('bogus' in styled.palette);
} catch (e) {
  out.error = String(e.stack || e);
} finally {
  await page.close();
  server.stop();
}
out.consoleErrors = watch.errors.length;
out.offsiteRequests = watch.offsite.length;
if (watch.errors.length) out.errors = watch.errors.slice(0, 5);
const pass = !out.error && Object.keys(checks).length >= 12 && Object.values(checks).every(Boolean) && !watch.errors.length && !watch.offsite.length;
console.log(JSON.stringify({ pass, checks, ...out }, null, 1));
if (!pass) process.exitCode = 1;
