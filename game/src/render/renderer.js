// WebGL renderer setup, resize handling and per-frame stats for the gate tool.
import * as THREE from '../../vendor/three.min.js';
import { PostPipeline } from './post.js';
import { installAtmosphere } from './atmosphere.js';

export function createRenderer(canvas) {
  installAtmosphere(); // layered fog chunks, before any program compiles
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  // PASS 17e render scale: native (1.0 x devicePixelRatio, capped at 2 and at ~4.2 MP of
  // internal pixels) with FXAA in the post chain. Dynamic resolution steps the scale down
  // only while the frame cadence is over budget, never below the old fixed scale
  // (min(dpr, 1.5) * 0.8), and creeps back up once frames are comfortably inside it.
  // Headless Chrome caps rAF regardless of load (BUILD-NOTES), so there it stays at the top
  // scale. The canvas, HUD and title are DOM / CSS sized and stay crisp at any scale.
  const dpr = devicePixelRatio || 1;
  const floorScale = Math.min(dpr, 1.5) * 0.8;
  const headless = /HeadlessChrome/.test(navigator.userAgent);
  const dyn = { scale: 0, max: 1, min: floorScale, enabled: !headless && !/[?&]fixedres\b/.test(location.search),
    last: -1, acc: 0, n: 0, good: 0, hold: 0 };
  const maxScaleFor = (w, h) => Math.max(floorScale, Math.min(dpr, 2, Math.sqrt(4.2e6 / Math.max(1, w * h))));
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.info.autoReset = false;
  const post = new PostPipeline(renderer);
  const frame = { calls: 0, triangles: 0 };
  let shadowTick = -1;
  const shadowCamera = new THREE.Vector3(Infinity, Infinity, Infinity);

  function applyScale(scale) {
    dyn.scale = scale;
    renderer.setPixelRatio(scale);
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    const pr = renderer.getPixelRatio();
    post.setSize(Math.floor(w * pr), Math.floor(h * pr));
  }
  function resize(camera) {
    const w = innerWidth, h = innerHeight;
    dyn.max = maxScaleFor(w, h);
    applyScale(dyn.scale ? Math.min(Math.max(dyn.scale, dyn.min), dyn.max) : dyn.max);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // Frame cadence -> scale. Over 18.2 ms mean for ~0.75 s: step down 12 %. Under 16.9 ms for 4 s
  // (and not just stepped down): step up 6 %. Gaps over 100 ms are pauses (tools, tab switches),
  // not load, and are ignored.
  function adapt(now) {
    if (!dyn.enabled) return;
    const dt = dyn.last < 0 ? 0 : now - dyn.last;
    dyn.last = now;
    if (dt <= 0 || dt > 100) return;
    dyn.acc += dt; dyn.n++;
    if (dyn.acc < 750) return;
    const mean = dyn.acc / dyn.n;
    dyn.acc = 0; dyn.n = 0;
    if (dyn.hold > 0) dyn.hold--;
    if (mean > 18.2 && dyn.scale > dyn.min + 1e-3) {
      applyScale(Math.max(dyn.min, dyn.scale * 0.88)); dyn.good = 0; dyn.hold = 8;
    } else if (mean < 16.9 && dyn.scale < dyn.max - 1e-3) {
      if (++dyn.good >= 5 && dyn.hold === 0) { applyScale(Math.min(dyn.max, dyn.scale * 1.06)); dyn.good = 0; dyn.hold = 2; }
    } else dyn.good = 0;
  }

  function render(scene, camera, opts) {
    // The sun is static; refresh moving silhouettes at 30 Hz. Camera jumps
    // invalidate immediately, including deterministic staged observations.
    const tick = Math.floor(opts.time * 30 + 1e-6);
    renderer.shadowMap.needsUpdate = tick !== shadowTick || shadowCamera.distanceToSquared(camera.position) > 9;
    if (renderer.shadowMap.needsUpdate) { shadowTick = tick; shadowCamera.copy(camera.position); }
    adapt(performance.now());
    renderer.info.reset();
    post.render(scene, camera, opts);
    frame.calls = renderer.info.render.calls;
    frame.triangles = renderer.info.render.triangles;
  }

  // render resolution report for the tools (internal pixels, scale, dynamic state)
  const resolution = () => ({ width: post.size?.[0] ?? 0, height: post.size?.[1] ?? 0, scale: +dyn.scale.toFixed(3),
    min: +dyn.min.toFixed(3), max: +dyn.max.toFixed(3), dynamic: dyn.enabled, aa: 'fxaa' });
  return { renderer, post, resize, render, frame, resolution };
}
