// PASS 15b radio probe: the station list, tuning through every station with the
// real keys in a car, the station panel, and the radio staying off on foot.
//   node tools/probe_radio.mjs [--port 8123] [--headed]
// 1. at least 6 stations, each with a name, frequency, genre and 3 tracks; the genres cover
//    harbour ambient, synth, talk show, industrial, lo-fi and news.
// 2. on foot: radio off (nothing playing, HUD readout hidden); R on foot does not tune (it reloads).
// 3. in a car (stage 'drive'): R steps through every station in turn. For each one the buffer
//    actually playing belongs to that station, the HUD names it, it is audible (rms), and the
//    station panel opens with that station lit. All loops are different recordings.
// 4. after the last station: RADIO OFF (nothing plays), R wraps to the first, , (comma) goes back.
// 5. the station panel closes ~2.6 s after the last change.
// 6. out of the car: the radio stops within ~1.5 s and stays off; the readout is hidden.
// Pass: every check true, 0 console errors, 0 off-site requests.
import { launch, startServer, watchPage } from './cdp.mjs';

const argv = process.argv.slice(2);
const port = Number(argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : 8123);
const server = await startServer(port);
const page = await launch({ port: 9363, headless: !argv.includes('--headed') });
const watch = watchPage(page, new URL(server.url).host);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const step = (m) => process.stderr.write(`[probe_radio] ${((Date.now() - T0) / 1000).toFixed(1)}s ${m}\n`);
const ev = (js, ms = 60000) => Promise.race([page.evaluate(js), new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out: ${js.slice(0, 60)}`)), ms))]);
const VK = { KeyR: 82, Comma: 188, ShiftLeft: 16 };
const KEY = { KeyR: 'r', Comma: ',', ShiftLeft: 'Shift' };
const press = async (code) => {
  for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, code, key: KEY[code], windowsVirtualKeyCode: VK[code] });
  await sleep(150);
};
const radio = () => ev('({ ...window.__game.radio(), level: window.__game.radioLevel(), panel: window.__game.radioPanel(), driving: window.__game.player().driving })');
// wait until the loop playing belongs to the tuned station (synthesis is time-sliced across frames)
async function waitPlaying(stationName, ms = 20000) {
  const t0 = Date.now();
  let r;
  while (Date.now() - t0 < ms) {
    r = await radio();
    const st = r.stations.find((s) => s.name === stationName);
    if (r.playing && r.buffer && st?.tracks.some((t) => t.id === r.buffer.trackId) && r.level?.trackId === r.buffer.trackId) return { ...r, waited: Date.now() - t0 };
    await sleep(100);
  }
  return { ...r, waited: Date.now() - t0, timedOut: true };
}
const checks = {}, out = {};

try {
  await page.goto(`${server.url}?autostart&seed=1337`);
  await page.waitFor(() => page.evaluate('!!(window.__game && window.__game.ready)'), 60000);
  await press('ShiftLeft');                  // user gesture: the audio context starts
  await sleep(800);

  // ---------------------------------------------------------------- 1. stations
  step('1. stations');
  let r = await radio();
  out.stations = r.stations.map((s) => ({ name: s.name, freq: s.freq, tracks: s.tracks.length }));
  const genres = await ev(`(async () => (await import('./src/audio/radio.js')).STATIONS.map((s) => s.genre))()`);
  out.genres = genres;
  const want = { 'harbour ambient': /ambient/, synth: /synth/, 'talk show': /talk/, industrial: /industrial/, 'lo-fi': /lo-?fi/, news: /news/ };
  out.coverage = Object.fromEntries(Object.entries(want).map(([k, re]) => [k, genres.find((g) => re.test(g)) ?? null]));
  checks.atLeastSixStations = r.stations.length >= 6 && new Set(r.stations.map((s) => s.name)).size === r.stations.length
    && r.stations.every((s) => s.name && s.freq && s.tracks.length === 3 && s.tracks.every((t) => t.title && t.artist));
  checks.genresCovered = Object.values(out.coverage).every(Boolean);

  // ---------------------------------------------------------------- 2. on foot
  step('2. on foot');
  const idx0 = r.index;
  await press('KeyR');
  await sleep(1600);
  r = await radio();
  out.foot = { driving: r.driving, on: r.on, buffer: r.buffer, hudHidden: r.hud.hidden, index: [idx0, r.index], audio: r.audio, ctx: r.level?.ctx ?? null };
  checks.offOnFoot = !r.driving && !r.on && !r.buffer && r.hud.hidden && r.audio;
  checks.rOnFootDoesNotTune = r.index === idx0;

  // ---------------------------------------------------------------- 3. every station in a car
  step('3. in a car');
  await ev(`window.__game.stage('drive')`);
  await ev('window.__game.resume()');
  await ev('window.__game.radioTune(0)');
  const n = r.stations.length;
  const seen = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) await press('KeyR');
    const name = r.stations[i].name;
    const panelNow = i > 0 ? await radio() : null;            // the panel opens with the change
    const p = await waitPlaying(name);
    seen.push({ i, station: p.station, index: p.index, trackId: p.buffer?.trackId ?? null, hudStation: p.hud.station, hudTrack: p.hud.track,
      rms: p.level?.rms ?? 0, zcr: p.level?.zcr ?? 0, quiet: p.level?.quiet ?? 0, waitedMs: p.waited, timedOut: !!p.timedOut,
      panel: panelNow ? { hidden: panelNow.panel.hidden, on: panelNow.panel.on, row: panelNow.panel.rows[panelNow.panel.on] } : null });
    step(`   ${name}: ${p.buffer?.trackId} rms ${p.level?.rms} (${p.waited} ms)`);
  }
  out.tuned = seen;
  checks.everyStationPlays = seen.length === n && seen.every((s, i) => !s.timedOut && s.index === i && s.station === r.stations[i].name && s.hudStation === s.station && s.rms > 0.02);
  checks.stationsAreDistinctLoops = new Set(seen.map((s) => s.trackId)).size === n && new Set(seen.map((s) => `${s.rms}|${s.zcr}`)).size === n;
  checks.panelOnChange = seen.slice(1).every((s) => s.panel && !s.panel.hidden && s.panel.on === s.i && s.panel.row === s.station);
  // talk and news carry speech-like gaps; the ambient bed and industrial loop are nearly continuous
  const by = (re) => seen.find((s) => re.test(genres[s.i]));
  out.character = Object.fromEntries(Object.keys(want).map((k) => { const s = by(want[k]); return [k, s && { station: s.station, rms: s.rms, zcr: s.zcr, quiet: s.quiet }]; }));
  checks.talkHasChatterGaps = by(/talk/).quiet > by(/industrial/).quiet && by(/talk/).quiet > 0.15;

  // ---------------------------------------------------------------- 4. off, wrap, previous
  step('4. off / wrap / previous');
  await press('KeyR');
  await sleep(1500);
  r = await radio();
  out.off = { index: r.index, station: r.station, on: r.on, buffer: r.buffer, hud: r.hud.station, track: r.hud.track, panelRow: r.panel.rows[r.panel.on] };
  checks.radioOffSlot = r.index === n && r.station === 'RADIO OFF' && !r.on && !r.buffer && r.hud.station === 'RADIO OFF' && r.panel.rows[r.panel.on] === 'RADIO OFF';
  await press('KeyR');
  const wrapped = await waitPlaying(r.stations[0].name);
  await press('Comma');
  await sleep(200);
  const back = await radio();
  out.wrap = { wrapped: wrapped.station, back: back.station };
  checks.wrapAndPrevious = wrapped.index === 0 && !wrapped.timedOut && back.index === n;
  await press('Comma');
  const prev = await waitPlaying(r.stations[n - 1].name);
  out.wrap.prev = prev.station;
  checks.wrapAndPrevious &&= prev.index === n - 1 && !prev.timedOut;

  // ---------------------------------------------------------------- 5. panel closes
  step('5. panel closes');
  await sleep(3000);
  r = await radio();
  out.panelLater = r.panel.hidden;
  checks.panelCloses = r.panel.hidden && !r.hud.hidden;

  // ---------------------------------------------------------------- 6. out of the car
  step('6. out of the car');
  const p0 = await ev('window.__game.player()');
  await ev(`window.__game.teleport(${p0.x + 4}, ${p0.z})`);
  await ev('window.__game.resume()');
  await sleep(1800);
  r = await radio();
  const idx = r.index;
  await press('KeyR');
  await sleep(600);
  const r2 = await radio();
  out.leftCar = { driving: r.driving, on: r.on, buffer: r.buffer, hudHidden: r.hud.hidden, panelHidden: r.panel.hidden, index: [idx, r2.index], buffer2: r2.buffer };
  checks.offOutsideVehicle = !r.driving && !r.on && !r.buffer && r.hud.hidden && r.panel.hidden && !r2.on && !r2.buffer && r2.index === idx;
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
