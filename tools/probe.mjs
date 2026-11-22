// Dev probe: boots the game in Chrome over CDP and runs steps in order.
//   node tools/probe.mjs 'eval:window.__game.player()' 'shot:/tmp/a.jpg' ...
// eval: evaluates an expression (awaited) and prints its JSON; shot: captures a JPEG;
// wait:<ms> pauses. Pass --headed to watch it in a visible window.
// Prints console errors at the end. Used while building; not part of the gate.
import { writeFileSync } from 'node:fs';
import { launch, startServer, watchPage } from './cdp.mjs';

const steps = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const server = await startServer(8092);
const page = await launch({ headless: !process.argv.includes('--headed'), port: 9334 });
const watch = watchPage(page, new URL(server.url).host);
try {
  await page.goto(`${server.url}?autostart&seed=1337`);
  await page.waitFor(() => page.evaluate('!!(window.__game && window.__game.ready)'), 60000);
  for (const s of steps) {
    if (s.startsWith('eval:')) console.log(JSON.stringify(await page.evaluate(s.slice(5))));
    else if (s.startsWith('shot:')) {
      const { data } = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
      writeFileSync(s.slice(5), Buffer.from(data, 'base64'));
      console.log('shot', s.slice(5));
    } else if (s.startsWith('wait:')) await new Promise((r) => setTimeout(r, Number(s.slice(5))));
  }
} catch (e) { console.log('ERROR', e.message); }
finally {
  console.log(JSON.stringify({ consoleErrors: watch.errors.slice(0, 8), offsite: watch.offsite.slice(0, 5) }));
  await page.close();
  server.stop();
}
