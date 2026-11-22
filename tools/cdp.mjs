// Minimal Chrome DevTools Protocol driver: launches Chrome with
// --remote-debugging-port, opens a page target and speaks CDP over the
// WebSocket built into Node 22. Also starts the game server (main.ts), or
// reuses one already listening on the requested port.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 20000, every = 150) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() - t0 > timeout) throw new Error('timed out');
    await sleep(every);
  }
}

export async function startServer(port) {
  const url = `http://127.0.0.1:${port}/`;
  try { const r = await fetch(url); if (r.ok) return { url, stop() {} }; } catch { /* not running */ }
  const child = spawn(process.execPath, [join(ROOT, 'main.ts'), '--port', String(port)], { stdio: 'ignore' });
  await waitFor(async () => (await fetch(url)).ok, 10000);
  return { url, stop() { child.kill(); } };
}

export async function launch({ headless = true, width = 1280, height = 720, port = 9333 } = {}) {
  if (!CHROME) throw new Error('Chrome not found; set CHROME_PATH');
  const profile = mkdtempSync(join(tmpdir(), 'bw-cdp-'));
  const args = [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-component-update',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--hide-scrollbars', '--mute-audio', 'about:blank',
  ];
  if (headless) args.unshift('--headless=new', '--use-angle=metal', '--enable-gpu');
  const proc = spawn(CHROME, args, { stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  const targets = await waitFor(async () => {
    const list = await (await fetch(`${base}/json/list`)).json();
    return list.find((t) => t.type === 'page') && list;
  });
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) || []) fn(msg.params);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const on = (method, fn) => { if (!listeners.has(method)) listeners.set(method, []); listeners.get(method).push(fn); };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  const evaluate = async (expression, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const goto = async (url) => {
    const loaded = new Promise((r) => on('Page.loadEventFired', r));
    await send('Page.navigate', { url });
    await loaded;
  };
  const close = async () => {
    try { await send('Browser.close'); } catch { /* already gone */ }
    proc.kill();
    await sleep(300);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  };
  return { send, on, evaluate, goto, close, waitFor };
}

// Collect console errors, uncaught exceptions and requests to other hosts.
export function watchPage(page, allowedHost) {
  const errors = [];
  const offsite = [];
  page.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error' || p.type === 'assert') errors.push(p.args.map((a) => a.value ?? a.description).join(' '));
  });
  page.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text));
  page.on('Log.entryAdded', (p) => { if (p.entry.level === 'error') errors.push(`${p.entry.source}: ${p.entry.text} ${p.entry.url || ''}`); });
  page.on('Network.requestWillBeSent', (p) => {
    const u = p.request.url;
    if (u.startsWith('data:') || u.startsWith('blob:') || u === 'about:blank') return;
    try { if (new URL(u).host !== allowedHost) offsite.push(u); } catch { offsite.push(u); }
  });
  return { errors, offsite };
}
