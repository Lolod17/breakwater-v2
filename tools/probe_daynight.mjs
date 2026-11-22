// PASS 16 day/night + weather probe. Loads the game in Chrome and checks that the
// clock (env/time.js) and the weather (env/weather.js) reach the screen:
// 1. default start (19:20, clear): the live look equals the dusk MOOD exactly, and the
//    sky / water / far-city uniforms are bound to it.
// 2. noon vs dusk vs 02:00: sun strength, sun height, lamp strength, and the measured
//    brightness of the sky band and the street band in a rendered frame are ordered.
// 3. rain: streaks drawn (one extra draw call), the ground gets wetter as the weather
//    wets it, fog thickens; fog weather thickens fog more; back to clear hides the rain.
// 4. the look moves with the clock as it runs (no setClock): 40 game minutes of steps.
// Pass: every check true, budget held in the rain frame, 0 console errors, 0 off-site requests.
//   node tools/probe_daynight.mjs [--headed]
import { launch, startServer, watchPage } from './cdp.mjs';

const argv = process.argv.slice(2);
const server = await startServer(8131);
const page = await launch({ headless: !argv.includes('--headed'), port: 9381 });
const watch = watchPage(page, new URL(server.url).host);
const ev = (js) => page.evaluate(js);
const checks = {};
const out = { checks };
const ok = (name, cond, detail) => { checks[name] = !!cond; if (!cond) out[`fail_${name}`] = detail ?? null; };
try {
  await page.goto(`${server.url}?autostart&seed=1337`);
  await page.waitFor(() => ev('!!(window.__game && window.__game.ready)'), 60000);
  await ev('window.__game.step(2)');
  const look = () => ev('window.__game.daylight()');
  // an open pose up the avenue from the waterfront: sky in the top band, road and pavement in the bottom band
  const POSE = '[40, 2.5, 214], [40, 14, 100]';
  const luma = () => ev(`window.__game.luma(${POSE})`);

  // 1. default start is the dusk look, exactly
  const d0 = await look();
  const env0 = await ev('window.__game.env()');
  const m = d0.mood;
  ok('startsAtDusk', env0.hour === 19 && env0.weather === 'clear', env0);
  ok('duskExact', JSON.stringify([d0.sunDir, d0.sunColor, d0.skyZenith, d0.skyHorizon, d0.fogColor, d0.exposure, d0.hemiIntensity])
    === JSON.stringify([m.sunDir, m.sunColor, m.skyZenith, m.skyHorizon, m.fogColor, m.exposure, m.hemiIntensity])
    && Math.abs(d0.sunIntensity - m.sunIntensity) < 1e-3 && Math.abs(d0.fogDensity - m.fogDensity) < 1e-6, { d0 });
  ok('duskApplied', d0.applied.lmStrength === 3.4 && d0.applied.glowGain === 1 && Math.abs(d0.applied.fog - m.fogDensity) < 1e-6
    && d0.applied.fogColor === m.fogColor && d0.applied.exposure === m.exposure && d0.wet === 1 && d0.rain === 0 && !d0.rainVisible, d0.applied);
  ok('uniformsBound', d0.applied.skyLive && d0.bound >= 8 && d0.extra >= 1, { bound: d0.bound, extra: d0.extra });
  const dusk = await luma();

  // 2. noon and 02:00
  await ev('window.__game.setClock(13 * 60)');
  const noonL = await look(); const noon = await luma();
  await ev('window.__game.setClock(2 * 60)');
  const nightL = await look(); const night = await luma();
  out.luma = { noon: noon.all.l.toFixed(1), dusk: dusk.all.l.toFixed(1), night: night.all.l.toFixed(1),
    skyNoon: noon.top.l.toFixed(1), skyDusk: dusk.top.l.toFixed(1), skyNight: night.top.l.toFixed(1),
    streetNoon: noon.bottom.l.toFixed(1), streetNight: night.bottom.l.toFixed(1) };
  ok('sunFollowsClock', noonL.sunIntensity > d0.sunIntensity && d0.sunIntensity > nightL.sunIntensity && noonL.sunDir[1] > 0.6 && noonL.sunDir[1] > d0.sunDir[1],
    { noon: noonL.sunIntensity, dusk: d0.sunIntensity, night: nightL.sunIntensity, noonY: noonL.sunDir[1] });
  ok('lampsFollowClock', nightL.applied.lmStrength > d0.applied.lmStrength && d0.applied.lmStrength > noonL.applied.lmStrength * 4
    && noonL.applied.glowGain < 0.3 && nightL.applied.glowGain >= 1, { night: nightL.applied, noon: noonL.applied });
  ok('skyBrightnessOrdered', noon.top.l > dusk.top.l + 15 && dusk.top.l > night.top.l + 5, out.luma);
  ok('frameBrightnessOrdered', noon.all.l > dusk.all.l && dusk.all.l > night.all.l, out.luma);
  ok('noonSkyBlue', noon.top.b > noon.top.r, noon.top);
  ok('fogFollowsClock', noonL.applied.fogColor !== d0.applied.fogColor && nightL.applied.fogColor !== d0.applied.fogColor, [noonL.applied.fogColor, nightL.applied.fogColor]);

  // 3. weather, at 21:00 so the rain is lit by the lamps
  await ev('window.__game.setClock(21 * 60)');
  await ev("window.__game.setWeather('clear', 0)");
  const clearL = await look(); const clearF = await luma();
  await ev("window.__game.setWeather('rain', 0)");
  await ev('window.__game.step(60)');
  const rain0 = await look(); const rainF0 = await luma();
  await ev('window.__game.step(60 * 40)');                // 40 s of rain: the ground soaks
  const rain1 = await look(); const rainF1 = await luma();
  const env1 = await ev('window.__game.env()');
  out.weather = { clearCalls: clearF.calls, rainCalls: rainF1.calls, wetStart: rain0.wet, wetAfter40s: rain1.wet, wetness: env1.wetness,
    fogClear: clearL.applied.fog, fogRain: rain1.applied.fog, triangles: null };
  // the same frame with the rain switched off (same pose, same world, same wetness): exactly one draw fewer
  await ev(`window.__game.setWeather('clear', ${env1.wetness})`);
  const dryF = await luma();
  await ev(`window.__game.setWeather('rain', ${env1.wetness})`);
  const wetF = await luma();          // and on again (the first frame at a new pose also re-sorts the prop batches)
  out.weather.sameFrameNoRainCalls = dryF.calls;
  out.weather.sameFrameRainCalls = wetF.calls;
  ok('rainDrawn', rain0.rainVisible && rain1.rain > 0.9 && wetF.calls === dryF.calls + 1, out.weather);
  ok('rainWetsGround', env1.weather === 'rain' && env1.wetness > 0.5 && rain1.wet > rain0.wet + 0.25 && rain1.wetCover > 0.5, out.weather);
  ok('rainThickensFog', rain1.applied.fog > clearL.applied.fog * 1.5 && rain1.applied.sun < clearL.applied.sun, out.weather);
  await ev("window.__game.setWeather('fog')");
  await ev('window.__game.step(2)');
  const fogL = await look();
  ok('fogWeather', fogL.applied.fog > clearL.applied.fog * 2.5 && !fogL.rainVisible, { fog: fogL.applied.fog, clear: clearL.applied.fog });
  await ev("window.__game.setWeather('clear')");
  await ev('window.__game.step(2)');
  const back = await look();
  ok('clearHidesRain', !back.rainVisible && back.rain === 0 && back.wet > clearL.wet, { back: back.wet, clear: clearL.wet });
  const f = await ev('window.__game.frame()');
  out.rainFrame = { calls: rainF1.calls, triangles: f.triangles };
  ok('budget', rainF1.calls < 500 && f.triangles < 900000, out.rainFrame);

  // 4. the running clock moves the look (no setClock): 17:00 + 40 game minutes
  await ev('window.__game.setClock(17 * 60)');
  await ev("window.__game.setWeather('clear', 0)");
  const a = await look();
  await ev('window.__game.step(60 * 20 * 40)');            // 20 s per game minute
  const b = await look();
  const e2 = await ev('window.__game.env()');
  out.running = { from: a.hour, to: b.hour, sunFrom: a.sunIntensity, sunTo: b.sunIntensity, lampsFrom: a.lamps, lampsTo: b.lamps };
  ok('lookFollowsRunningClock', e2.hour === 17 && Math.abs(b.hour - (17 + 40 / 60)) < 0.01 && b.hour > a.hour + 0.6 && b.lamps > a.lamps && b.sunDir[1] < a.sunDir[1], out.running);

  out.consoleErrors = watch.errors.length;
  out.offsiteRequests = watch.offsite.length;
  if (watch.errors.length) out.errors = watch.errors.slice(0, 3);
  out.pass = Object.values(checks).every(Boolean) && !out.consoleErrors && !out.offsiteRequests;
} catch (e) {
  out.error = String(e.message || e);
  out.pass = false;
} finally {
  await page.close();
  server.stop();
}
console.log(JSON.stringify(out));
if (!out.pass) process.exitCode = 1;
