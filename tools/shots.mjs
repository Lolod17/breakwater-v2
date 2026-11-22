// Screenshots from the running game, real code and real renderer, 1280x720 JPEG.
// Default (PASS 21): writes exactly the four dossier images in screenshots/ and prints one JSON line per shot
// (file, bytes, calls, triangles):
//   1-city, 2-chase, 3-street, 4-last-route  via tools/shots_final.mjs (its scenes and checks, --out screenshots)
// Nothing else is ever written to screenshots/: the dossier caps it at 4 files (main.ts caps.screenshots.max).
// --archive: the older development stage list (01..09) into tools/screenshots-archive/ instead.
//   node tools/shots.mjs [--archive] [--headed] [--port 8091]
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { launch, startServer, watchPage } from './cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const port = Number(argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : 8091);
const SHOTS = [
  ['01-waterfront-dusk', 'waterfront'],
  ['02-avenue-crossing', 'avenue'],
  ['03-harbour-jetty', 'harbour'],
  ['04-downtown-sprint', 'sprint'],
  ['05-pavement-life', 'pavement'],
  ['06-market-walkers', 'market'],
  ['08-driving-hud', 'drive'],
  ['09-market-on-foot', 'marketFoot'],
];


if (!argv.includes('--archive')) {
  let failed = false;
  // 1-4: the final scenes, with their scene checks, written straight into screenshots/
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'shots_final.mjs'), '--out', 'screenshots', ...(argv.includes('--headed') ? ['--headed'] : [])],
    { cwd: ROOT, encoding: 'utf8' });
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    let o; try { o = JSON.parse(line); } catch { console.log(line); continue; }
    if (o.file) console.log(JSON.stringify({ file: `screenshots/${o.file.split('/').pop()}`, bytes: o.bytes, calls: o.calls, triangles: o.triangles, quality: o.quality, ok: o.extra?.ok ?? null }));
    else console.log(JSON.stringify({ shots_final: o }));
  }
  if (r.stderr.trim()) console.error(r.stderr.trim());
  if (r.status !== 0) failed = true;
  process.exit(failed ? 1 : 0);
}

const server = await startServer(port);
const page = await launch({ headless: !argv.includes('--headed') });
const watch = watchPage(page, new URL(server.url).host);
// development shots go to the archive: screenshots/ holds only the four hand-in images (tools/shots_final.mjs)
mkdirSync(join(ROOT, 'tools', 'screenshots-archive'), { recursive: true });
try {
  await page.goto(`${server.url}?autostart&seed=1337`);
  await page.waitFor(() => page.evaluate('!!(window.__game && window.__game.ready)'), 60000);
  const capture = async (file, info) => {
    let quality = 88, data;
    for (;;) {
      ({ data } = await page.send('Page.captureScreenshot', { format: 'jpeg', quality }));
      if (Buffer.byteLength(data, 'base64') <= 250 * 1024 || quality <= 50) break;
      quality -= 6;
    }
    const path = join(ROOT, 'tools', 'screenshots-archive', `${file}.jpg`);
    writeFileSync(path, Buffer.from(data, 'base64'));
    console.log(JSON.stringify({ file: `tools/screenshots-archive/${file}.jpg`, quality, bytes: Buffer.byteLength(data, 'base64'), calls: info.calls, triangles: info.triangles, player: info.x === undefined ? null : [+info.x.toFixed(1), +info.z.toFixed(1)] }));
  };
  for (const [file, name] of SHOTS) await capture(file, await page.evaluate(`window.__game.stage(${JSON.stringify(name)})`));
  // the title screen: a fresh load with no save, the menu over the living city
  await page.goto(`${server.url}?seed=1337`);
  await page.evaluate('localStorage.clear()');
  await page.goto(`${server.url}?seed=1337`);
  await page.waitFor(() => page.evaluate('!!(window.__game && window.__game.ready) && !document.getElementById("start").hidden'), 60000);
  await new Promise((r) => setTimeout(r, 1500));     // the loading screen's fade
  const t = await page.evaluate('window.__game.stageTitle(5)');
  await new Promise((r) => setTimeout(r, 200));
  await capture('07-title-screen', t);
} finally {
  if (watch.errors.length) console.log(JSON.stringify({ consoleErrors: watch.errors }));
  await page.close();
  server.stop();
}
