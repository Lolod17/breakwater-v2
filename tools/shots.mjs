// Screenshots from the running game: stages deterministic scenes through
// window.__game.stage() (real game code, real renderer) and captures each at
// 1280x720 as JPEG into screenshots/. PASS 7 adds three UI shots: the title
// screen over the live city (a fresh page without ?autostart, staged with
// __game.stageTitle), driving with the full HUD, and on foot in the old market.
//   node tools/shots.mjs [--headed] [--port 8091]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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
