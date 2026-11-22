// PASS 7 UI probe: title screen, HUD, minimap, radio and feedback, through real
// CDP keyboard and mouse input on a fresh profile (no ?autostart).
//   node tools/probe_ui.mjs [--port 8096] [--headed]
// 1. loading -> title: every captured frame of the transition stays dark (no white flash);
//    the menu sits over the live city (title camera drifting, a car moving behind the menu).
// 2. no save: Continue hidden with a reason; the menu row takes keyboard focus; hover focuses.
// 3. Enter on START NEW STORY starts the game (real key event): title gone, HUD in, game started.
// 4. HUD: the four groups (objective, status, map, vehicle) are present, visible, inside the
//    1280x720 viewport and not clipped, on foot (armed) and driving; one minimap, 100 px,
//    circular, 3 px #00E6FF rim, drop shadow, bottom-left, drawn, with a location label.
// 5. radio: the HUD names the station and "title — artist" of the buffer actually playing
//    (track id carried by the AudioBuffer); R changes station and both follow.
// 6. feedback: wanted escalation, damage, objective change, mission fail and complete each
//    log an event with a sound and put a visible cue class on the HUD.
// 7. save, reload: Continue appears ("CONTINUE DAY n — $m"), focus starts on it, Up/Down move
//    the focus across both rows (visible focus state), Enter on Continue resumes the save.
// Pass: every check true, 0 console errors, 0 off-site requests.
import { inflateSync } from 'node:zlib';
import { launch, startServer, watchPage } from './cdp.mjs';
import { DRIVER, PLAY } from './mission_driver.mjs';

const argv = process.argv.slice(2);
const port = Number(argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : 8096);
const server = await startServer(port);
const page = await launch({ port: 9341, headless: !argv.includes('--headed') });
const watch = watchPage(page, new URL(server.url).host);
const url = `${server.url}?seed=1337`;
const ev = (js, ms = 120000) => Promise.race([page.evaluate(js),
  new Promise((_, rej) => setTimeout(() => rej(new Error(`evaluate timed out after ${ms / 1000}s: ${js.slice(0, 80)}`)), ms))]);
const T0 = Date.now();
const step = (m) => process.stderr.write(`[probe_ui] ${((Date.now() - T0) / 1000).toFixed(1)}s ${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- tiny PNG decoder (8-bit RGB/RGBA, non-interlaced) for screenshot luminance
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
async function frameLuma() {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1280, height: 720, scale: 0.1 } });
  const img = decodePNG(Buffer.from(data, 'base64'));
  let sum = 0, bright = 0, n = img.w * img.h;
  for (let i = 0; i < n; i++) {
    const o = i * img.bpp, l = (0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2]) / 255;
    sum += l; if (l > 0.85) bright++;
  }
  return { mean: sum / n, brightShare: bright / n };
}
const send = (method, params, ms = 15000) => Promise.race([page.send(method, params),
  new Promise((_, rej) => setTimeout(() => rej(new Error(`${method} ${params.type ?? ''} ${params.code ?? ''} timed out`)), ms))]);
async function key(code, keyName = code, opts = {}) {
  const vk = { Enter: 13, ArrowUp: 38, ArrowDown: 40, KeyR: 82, KeyQ: 81, Space: 32 }[code] ?? 0;
  const { hold, ...rest } = opts;
  // no nativeVirtualKeyCode: on macOS it names a different physical key (81 stalled frame production)
  const base = { code, key: keyName, windowsVirtualKeyCode: vk, ...rest };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(keyName === 'Enter' ? { text: '\r' } : {}) });
  if (!hold) await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}
const rowState = () => ev(`(() => { const t = window.__game.title(); return { ...t, active: document.activeElement?.id ?? null,
  styles: Object.fromEntries(['continue', 'play'].map((id) => { const b = document.getElementById(id), cs = getComputedStyle(b);
    return [id, { focusClass: b.classList.contains('is-focus'), bg: cs.backgroundColor, transform: cs.transform, bar: getComputedStyle(b, '::before').width }]; })) }; })()`);

const checks = {};
const out = {};
try {
  // ---------------------------------------------------------------- 1. loading -> title, no white flash
  step('1. loading -> title, no white flash');
  await page.goto('about:blank');
  await page.goto(url);
  await ev('localStorage.clear()');
  const nav = page.send('Page.navigate', { url });
  await nav;
  const frames = [];
  const t0 = Date.now();
  for (;;) {
    const f = await frameLuma().catch(() => null);    // no frame while the document swaps
    if (f) frames.push(f);
    const st = await ev(`({ ready: !!(window.__game && window.__game.ready), title: !document.getElementById('start').hidden })`).catch(() => ({}));
    if (st.ready && st.title && (out.titleAt ??= Date.now()) && Date.now() - out.titleAt > 1800) break;
    if (Date.now() - t0 > 60000) throw new Error('title never appeared');
    await sleep(60);
  }
  out.transition = { frames: frames.length, maxMean: +Math.max(...frames.map((f) => f.mean)).toFixed(3), maxBrightShare: +Math.max(...frames.map((f) => f.brightShare)).toFixed(3) };
  checks.noWhiteFlash = frames.length >= 5 && out.transition.maxMean < 0.45 && out.transition.maxBrightShare < 0.08;
  const bgs = await ev(`[getComputedStyle(document.body).backgroundColor, getComputedStyle(document.getElementById('game')).backgroundColor]`);
  checks.darkBackdrops = bgs.every((c) => c === 'rgb(0, 0, 0)');

  // live city behind the menu: camera drifts, the car moves, frames keep rendering
  const a = await ev('window.__game.title()');
  await sleep(1500);
  const b = await ev('window.__game.title()');
  out.titleLive = { a: { cam: a.camera, car: a.car, t: a.t }, b: { cam: b.camera, car: b.car, t: b.t } };
  checks.titleOverLiveCity = b.active && b.t > a.t && Math.hypot(b.camera.x - a.camera.x, b.camera.z - a.camera.z) > 0.01 && !!b.car && b.car.speed > 3
    && (a.car?.type !== b.car.type || Math.abs(b.car.x - a.car.x) > 3);
  const layout = await ev(`(() => { const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
    const logo = document.querySelector('#start .t-logo'), cs = getComputedStyle(logo);
    return { logo: r('#start .t-logo'), sub: r('#start .t-sub'), menu: r('#start .t-menu'), controls: r('#start .t-controls'), footer: r('#start .t-footer'),
      logoGradient: cs.backgroundImage.includes('gradient'), logoWeight: cs.fontWeight, keycaps: [...document.querySelectorAll('.t-keys kbd')].map((k) => k.getBoundingClientRect().x),
      keycapLabels: [...document.querySelectorAll('.t-keys kbd')].map((k) => k.textContent), keyTexts: [...document.querySelectorAll('.t-keys span')].map((k) => k.getBoundingClientRect().x),
      footer: document.querySelector('.t-footer').textContent.replace(/\\s+/g, ' ').trim(), barWidth: getComputedStyle(document.getElementById('play'), '::before').width,
      barColor: getComputedStyle(document.getElementById('play'), '::before').backgroundColor }; })()`);
  out.titleLayout = layout;
  checks.titleLayout = layout.logo.x < 120 && layout.logo.x + layout.logo.w < 700 && layout.logoGradient && +layout.logoWeight >= 800
    && layout.menu.y > layout.sub.y && layout.controls.y > layout.menu.y + layout.menu.h && layout.controls.x < 120
    && new Set(layout.keycaps.map(Math.round)).size === 1 && new Set(layout.keyTexts.map(Math.round)).size === 1
    && ['WASD', 'SHIFT', 'MOUSE', 'ESC', 'F3'].every((k) => layout.keycapLabels.includes(k))
    && /BUILD \d+\.\d+\.\d+/.test(layout.footer) && /DAY \d+ · \d\d:\d\d/.test(layout.footer) && layout.barColor === 'rgb(0, 230, 255)';

  // ---------------------------------------------------------------- 2. no save: Continue hidden with a reason, focus
  step('2. no save: Continue hidden with a reason, focus');
  const noSave = await rowState();
  const reason = await ev(`document.getElementById('save-info').hidden ? '' : document.getElementById('save-info').textContent`);
  out.noSave = { rows: noSave.rows, focused: noSave.focused, reason };
  checks.continueHiddenWithoutSave = !noSave.rows.find((r) => r.id === 'continue').visible && reason.length > 10;
  await key('ArrowDown'); await key('ArrowUp');
  const kb1 = await rowState();
  checks.keyboardFocusNoSave = kb1.focused === 'play' && kb1.active === 'play' && kb1.styles.play.focusClass;
  // hover = focus (one shared state)
  const pr = await ev(`(() => { const b = document.getElementById('play').getBoundingClientRect(); return { x: b.x + 40, y: b.y + b.height / 2 }; })()`);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 300 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pr.x, y: pr.y });
  checks.hoverFocuses = (await rowState()).styles.play.focusClass;

  // ---------------------------------------------------------------- 3. Enter starts the game
  step('3. Enter starts the game');
  await key('Enter', 'Enter');
  await sleep(700);
  const started = await ev(`({ started: window.__game.started(), title: window.__game.title(), titleOn: document.body.classList.contains('title-on'),
    hud: !document.getElementById('hud').hidden && getComputedStyle(document.getElementById('hud')).visibility === 'visible', audio: window.__game.radio().audio,
    player: window.__game.player() })`);
  out.started = { started: started.started, titleHidden: started.title.hidden, titleOn: started.titleOn, hud: started.hud, audio: started.audio, at: [started.player.x, started.player.z] };
  checks.enterStartsGame = started.started && started.title.hidden && !started.title.active && !started.titleOn && started.hud
    && Math.hypot(started.player.x - 32.2, started.player.z - 150) < 3;

  // ---------------------------------------------------------------- 4. HUD groups, minimap
  step('4. HUD groups, minimap');
  const hudCheck = (label) => ev(`(() => {
    const vw = innerWidth, vh = innerHeight, res = {};
    for (const id of ['hud-objective', 'hud-status', 'hud-map', 'hud-vehicle']) {
      const el = document.getElementById(id), r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      const inside = r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh;
      // every visible text leaf inside the group: in the viewport and not cut off
      const leaves = [...el.querySelectorAll('*')].filter((n) => n.offsetParent !== null && n.children.length === 0 && n.textContent.trim());
      const clipped = leaves.filter((n) => { const b = n.getBoundingClientRect(); return n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).display !== 'inline'
        || b.left < 0 || b.top < 0 || b.right > vw || b.bottom > vh; }).map((n) => n.id || n.className || n.tagName);
      res[id] = { visible: cs.display !== 'none' && cs.visibility === 'visible' && el.offsetParent !== null, inside, clipped,
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], text: el.innerText.replace(/\\s+/g, ' ').trim().slice(0, 90) };
    }
    return res;
  })()`);
  // on foot, armed (aiming)
  await ev('window.__game.resume()');
  step('4a resumed');
  await key('KeyQ', 'q', { hold: true });
  step('4b aiming');
  await sleep(500);
  const foot = await hudCheck('foot');
  step('4c foot hud');
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyQ', key: 'q', windowsVirtualKeyCode: 81 });
  out.hudFoot = foot;
  const groupsOk = (h) => Object.values(h).every((g) => g.visible && g.inside && !g.clipped.length);
  checks.hudGroupsOnFoot = groupsOk(foot) && /PISTOL/.test(foot['hud-vehicle'].text) && /DAY \d+/.test(foot['hud-status'].text) && /\$\d/.test(foot['hud-status'].text);
  const map = await ev(`(() => { const all = document.querySelectorAll('#minimap, canvas[aria-label="Minimap"]'); const m = document.getElementById('minimap'), r = m.getBoundingClientRect(), cs = getComputedStyle(m);
    const d = m.getContext('2d').getImageData(0, 0, m.width, m.height).data; let drawn = 0; for (let i = 3; i < d.length; i += 4) drawn += d[i] > 0;
    const c = m.getContext('2d').getImageData(m.width / 2 - 1, m.height / 2 + 4, 2, 2).data;
    const label = document.getElementById('district'), ls = getComputedStyle(label), lr = label.getBoundingClientRect();
    return { count: all.length, w: r.width, h: r.height, left: r.left, bottom: innerHeight - r.bottom, border: cs.borderTopWidth, borderColor: cs.borderTopColor, radius: cs.borderTopLeftRadius,
      shadow: cs.boxShadow, drawnShare: drawn / (m.width * m.height), arrowCentre: [c[0], c[1], c[2]], label: label.textContent, labelSize: parseFloat(ls.fontSize), labelWeight: ls.fontWeight,
      labelBg: ls.backgroundColor, labelInside: lr.right <= innerWidth && lr.bottom <= innerHeight }; })()`);
  out.minimap = map;
  step('4d minimap');
  checks.minimapSpec = map.count === 1 && map.w === 100 && map.h === 100 && map.border === '3px' && map.borderColor === 'rgb(0, 230, 255)' && map.radius === '50%'
    && map.shadow !== 'none' && map.left <= 40 && map.bottom <= 40 && map.drawnShare > 0.7 && map.arrowCentre.every((v) => v > 200)
    && map.label.length > 3 && map.labelSize >= 16 && +map.labelWeight >= 700 && map.labelInside;

  // driving (the staged drive: hero car on the avenue), then real frames
  await ev(`window.__game.stage('drive')`);
  await ev('window.__game.resume()');
  await sleep(900);
  const drive = await hudCheck('drive');
  out.hudDrive = drive;
  checks.hudGroupsDriving = groupsOk(drive) && /KM\/H/i.test(drive['hud-vehicle'].text) && /FM/.test(drive['hud-vehicle'].text);

  // ---------------------------------------------------------------- 5. radio: HUD == buffer playing
  step('5. radio: HUD == buffer playing');
  const waitRadio = async () => { for (let i = 0; i < 80; i++) { const r = await ev('window.__game.radio()'); if (r.buffer && r.playing) return r; await sleep(100); } return ev('window.__game.radio()'); };
  const consistent = (r) => {
    const st = r.stations.find((s) => s.name === r.station), tr = st?.tracks.find((t) => t.id === r.buffer?.trackId);
    return !!tr && r.trackId === r.buffer.trackId && r.hud.trackId === r.buffer.trackId && r.hud.station === r.station && r.hud.track === `${tr.title} — ${tr.artist}`
      && Math.abs(r.buffer.duration - tr.seconds) < 0.01 && r.buffer.channels === 2 && !r.hud.hidden;
  };
  const r1 = await waitRadio();
  await key('KeyR', 'r');
  await sleep(150);
  const r2 = await waitRadio();
  out.radio = [r1, r2].map((r) => ({ station: r.station, trackId: r.trackId, title: r.title, artist: r.artist, buffer: r.buffer, hud: r.hud }));
  checks.radioMatchesAudio = consistent(r1) && consistent(r2) && r2.station !== r1.station && r1.stations.length >= 4;

  // ---------------------------------------------------------------- 6. feedback
  step('6. feedback');
  const fbFrom = (await ev('window.__game.feedback()')).length;
  await ev('window.__game.forceWanted(2); window.__game.step(2)');
  const wantedCue = await ev(`document.getElementById('wanted').classList.contains('fx-wanted')`);
  await ev('window.__game.hurt(12); window.__game.step(2)');
  const hurtCue = await ev(`document.getElementById('damage-vignette').classList.contains('fx-damage') && document.getElementById('health-bar').classList.contains('fx-shake')`);
  // a mission played by the scripted courier, failing the first attempt on purpose
  // a fail: start THE PICKUP and fail it through Missions.fail, let the card time out
  await ev('window.__game.newGame()');
  await ev(`window.__game.missionStart(0); window.__game.step(3); window.__game.missionFail('Probe: forced fail'); window.__game.step(3); window.__game.drawNow(1)`);
  const failCue = await ev(`document.getElementById('result').classList.contains('fx-fail') && !document.getElementById('result').hidden`);
  await ev(`(() => { for (let i = 0; i < 12 * 60 && window.__game.missions().phase === 'result'; i++) window.__game.step(1); })()`);
  // then the whole mission played by the scripted courier: objective changes and the pass
  await ev(`${DRIVER};${PLAY};true`);
  const run = await ev('window.__probe.runMission(0)', 600000);
  const fb = (await ev('window.__game.feedback()')).slice(fbFrom);
  const kinds = new Set(fb.map((e) => e.kind));
  // the pass cue class stays on the result card after it times out
  const passCue = run.ok && await ev(`document.getElementById('result').classList.contains('fx-complete')`);
  out.feedback = { run: { ok: run.ok, attempts: run.attempts, failures: run.failures }, events: fb.map((e) => `${e.kind}${e.sound ? '+sound' : ''}@${e.t}`), wantedCue, hurtCue, failCue, passCue };
  checks.feedbackEvents = ['wanted', 'damage', 'objective', 'fail', 'complete'].every((k) => kinds.has(k)) && fb.every((e) => e.sound) && wantedCue && hurtCue && failCue && passCue;

  // ---------------------------------------------------------------- 7. save -> reload -> Continue, keyboard across two rows
  step('7. save -> reload -> Continue, keyboard across two rows');
  await ev('window.__game.save()');
  const saved = await ev('window.__game.readSave()');
  step('7a saved ' + JSON.stringify({ money: saved.data?.money, day: saved.data?.clock?.day }));
  await page.goto(url);
  step('7b reloaded');
  await page.waitFor(() => ev('!!(window.__game && window.__game.ready) && !document.getElementById("start").hidden'), 60000);
  await sleep(1200);
  const s0 = await rowState();
  step('7c rows');
  const contRow = s0.rows.find((r) => r.id === 'continue');
  out.withSave = { rows: s0.rows, focused: s0.focused, saved: { money: saved.data?.money, day: saved.data?.clock?.day, mission: saved.data?.mission } };
  checks.continueOnlyWithSave = contRow.visible && contRow.text.includes(`DAY ${saved.data.clock.day ?? 1} — $${saved.data.money}`) && s0.focused === 'continue';
  const settle = () => sleep(350);       // the focus transition is 220 ms
  await key('ArrowDown'); await settle();
  const s1 = await rowState();
  await key('ArrowDown'); await settle();
  const s2 = await rowState();
  await key('ArrowUp'); await settle();
  const s3 = await rowState();
  out.keyboard = [s0, s1, s2, s3].map((s) => ({ focused: s.focused, active: s.active, cont: s.styles.continue, play: s.styles.play }));
  const differs = (f, o) => f.focusClass && !o.focusClass && (f.bg !== o.bg || f.transform !== o.transform);
  checks.everyRowKeyboardFocus = s1.focused === 'play' && s2.focused === 'continue' && s3.focused === 'play' && s1.active === 'play' && s2.active === 'continue'
    && differs(s1.styles.play, s1.styles.continue) && differs(s2.styles.continue, s2.styles.play);
  step('7d keyboard done');
  await key('ArrowUp');                  // back to Continue
  await key('Enter', 'Enter');
  await sleep(500);
  const resumed = await ev(`({ started: window.__game.started(), money: window.__game.money(), mission: window.__game.missions().progress, title: window.__game.title().hidden })`);
  out.resumed = resumed;
  checks.continueResumes = resumed.started && resumed.title && resumed.money === saved.data.money && resumed.mission === saved.data.mission;
} catch (e) {
  out.error = String(e.stack || e);
} finally {
  await page.close();
  server.stop();
}
out.consoleErrors = watch.errors.length;
out.offsiteRequests = watch.offsite.length;
if (watch.errors.length) out.errors = watch.errors.slice(0, 5);
out.checks = checks;
out.pass = !out.error && Object.keys(checks).length === 16 && Object.values(checks).every(Boolean) && !watch.errors.length && !watch.offsite.length;
console.log(JSON.stringify(out, null, 1));
// PASS 16: exit on the result (the evaluate() timeout races above leave timers that held the process ~600 s)
process.exit(out.pass ? 0 : 1);
