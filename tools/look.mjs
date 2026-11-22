// Visual inspection helper: stages scenes through window.__game.stage() (named
// shots from debug.js or inline JSON stage objects), saves a JPEG per stage and
// prints calls/triangles with a per-object breakdown split into the shadow pass
// and the main/post passes (hooked on renderer.renderBufferDirect for one frame).
//   node tools/look.mjs [--out /tmp/bw-look] [--headed] [--top 12] name|json ...
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, startServer, watchPage } from './cdp.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const out = opt('--out', '/tmp/bw-look');
const top = Number(opt('--top', 12));
const port = Number(opt('--port', 8093));
const headed = argv.includes('--headed');
const stages = argv.filter((a) => a !== '--headed');
mkdirSync(out, { recursive: true });

const server = await startServer(port);
const page = await launch({ headless: !headed, port: 9341 });
const watch = watchPage(page, new URL(server.url).host);
try {
  await page.goto(`${server.url}?autostart&seed=1337`);
  await page.waitFor(() => page.evaluate('!!(window.__game && window.__game.ready)'), 60000);
  await page.evaluate(`(() => {
    const r = window.__gfx.renderer;
    const orig = r.renderBufferDirect.bind(r);
    window.__bd = null;
    r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
      const b = window.__bd;
      if (b) {
        const shadow = !!(material && (material.isMeshDepthMaterial || material.isMeshDistanceMaterial));
        const idx = geometry.index ? geometry.index.count : geometry.attributes.position.count;
        const n = object.isInstancedMesh ? object.count : 1;
        const tris = object.isMesh ? Math.floor((group ? group.count : idx) / 3) * n : 0;
        let name = object.name || (object.parent && object.parent.name ? object.parent.name + '/' : '') + object.type;
        name = name.replace(/-(-?\\d+),(-?\\d+)$/, '');
        const key = (shadow ? 'shadow:' : '') + name;
        const e = b[key] || (b[key] = { calls: 0, tris: 0 });
        e.calls++; e.tris += tris;
      }
      return orig(camera, scene, geometry, material, object, group);
    };
  })()`);
  for (const s of stages) {
    const arg = s.trim().startsWith('{') ? s : JSON.stringify(s);
    const label = s.trim().startsWith('{') ? (JSON.parse(s).label || 'custom') : s;
    const info = await page.evaluate(`window.__game.stage(${arg})`);
    const bd = await page.evaluate(`(() => { window.__bd = {}; window.__game.drawStill(); const b = window.__bd; window.__bd = null;
      const f = window.__game.frame(); return { b, calls: f.calls, triangles: f.triangles }; })()`);
    const { data } = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
    const file = join(out, `${label}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    const rows = Object.entries(bd.b).sort((a, b) => b[1].tris - a[1].tris).slice(0, top)
      .map(([k, v]) => `${k}:${v.calls}c/${(v.tris / 1000).toFixed(1)}k`);
    console.log(JSON.stringify({ file, calls: bd.calls, triangles: bd.triangles, stageCalls: info.calls, stageTris: info.triangles, carsDrawn: info.carsDrawn }));
    console.log('  ' + rows.join('  '));
  }
} finally {
  if (watch.errors.length) console.log(JSON.stringify({ consoleErrors: watch.errors.slice(0, 8) }));
  await page.close();
  server.stop();
}
