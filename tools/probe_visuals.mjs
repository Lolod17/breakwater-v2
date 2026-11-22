// PASS 6 budget probe: the worst car-heavy views must stay under the gate's
// limits. Stages 'traffic' (20 parked cars of all seven types stacked down the
// avenue in all four lanes, plus the live traffic the populator adds) and the
// car line-ups, renders each with the shadow map refreshed, and reports the
// draw calls / triangles of that frame, the cars drawn and the per-type split.
//   node tools/probe_visuals.mjs [--headed]
import { launch, startServer, watchPage } from './cdp.mjs';

const argv = process.argv.slice(2);
const server = await startServer(8095);
const page = await launch({ headless: !argv.includes('--headed'), port: 9343 });
const watch = watchPage(page, new URL(server.url).host);
const out = { views: {} };
try {
  await page.goto(`${server.url}?autostart&seed=1337`);
  await page.waitFor(() => page.evaluate('!!(window.__game && window.__game.ready)'), 60000);
  for (const name of ['traffic', 'lineup', 'lineup34', 'tails']) {
    const info = await page.evaluate(`window.__game.stage(${JSON.stringify(name)})`);
    const types = await page.evaluate(`(() => { const o = {}; for (const m of window.__scene.getObjectByName('vehicles').children)
      if (m.isInstancedMesh && m.name.startsWith('vehicle-') && m.visible && m.count) o[m.name.slice(8)] = m.count; return o; })()`);
    out.views[name] = { calls: info.calls, triangles: info.triangles, carsDrawn: info.carsDrawn, types };
  }
  const v = Object.values(out.views);
  out.maxCalls = Math.max(...v.map((x) => x.calls));
  out.maxTriangles = Math.max(...v.map((x) => x.triangles));
  out.trafficCars = out.views.traffic.carsDrawn;
  out.consoleErrors = watch.errors.length;
  out.offsiteRequests = watch.offsite.length;
  out.pass = out.maxCalls < 500 && out.maxTriangles < 900000 && out.trafficCars >= 20 && !out.consoleErrors && !out.offsiteRequests;
  if (watch.errors.length) out.errors = watch.errors.slice(0, 3);
} finally {
  await page.close();
  server.stop();
}
console.log(JSON.stringify(out));
if (!out.pass) process.exitCode = 1;
