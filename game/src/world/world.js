// Assembles the district: layout, baked light map, buildings, roads, props,
// harbour, skyline, lighting rig and fog. Returns everything the game needs.
import * as THREE from '../../vendor/three.min.js';
import { CITY, MOOD } from '../config.js';
import { buildLayout } from './layout.js';
import { LightMap } from './lightmap.js';
import { createMaterials, bakeBuilders } from './materials.js';
import { buildDowntown } from './buildings.js';
import { buildRoads } from './roads.js';
import { buildProps, buildPlazas } from './props.js';
import { buildHarbour } from './harbour.js';
import { buildSkyline } from './skyline.js';
import { buildFarCity } from './farcity.js';
import { buildRoadEnds } from './roadEnds.js';
import { Colliders } from './colliders.js';
import { createSky } from '../render/sky.js';
import { LightFX } from '../render/lightfx.js';
import { LOOK } from '../render/daylight.js';

export function buildWorld(scene, rng, onProgress = () => {}) {
  const t0 = performance.now();
  const layout = buildLayout();
  const colliders = new Colliders(8);
  const lm = new LightMap({ x0: -300, z0: -300, w: 640, h: 640 });
  const { M, B, groundSize } = createMaterials(rng, lm);
  onProgress(0.25, 'Painting facades');

  const clearance = [];
  const down = buildDowntown(layout, rng.fork('downtown'), B, colliders, lm);
  onProgress(0.45, 'Raising downtown');
  // record overhangs so trees keep clear of awnings and blade signs
  for (const b of B.awning.pos.length ? [B.awning] : []) {
    const p = b.pos;
    for (let i = 0; i < p.length; i += 18 * 6) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let k = i; k < Math.min(i + 18 * 6, p.length); k += 3) {
        x0 = Math.min(x0, p[k]); x1 = Math.max(x1, p[k]); z0 = Math.min(z0, p[k + 2]); z1 = Math.max(z1, p[k + 2]);
      }
      clearance.push([x0, z0, x1, z1]);
    }
  }
  const np = B.neon.pos;
  for (let i = 0; i < np.length; i += 18) {
    if (np[i + 1] < 5) continue; // fascia signs are flat on the wall; blades stand proud
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let k = i; k < i + 18; k += 3) { x0 = Math.min(x0, np[k]); x1 = Math.max(x1, np[k]); z0 = Math.min(z0, np[k + 2]); z1 = Math.max(z1, np[k + 2]); }
    clearance.push([x0 - 0.3, z0 - 0.3, x1 + 0.3, z1 + 0.3]);
  }

  buildRoads(layout, rng.fork('roads'), B, lm);
  const sky = buildSkyline(layout, rng.fork('skyline'), B, colliders, lm);
  const props = buildProps(layout, rng.fork('props'), M, colliders, lm, clearance);
  const plazas = buildPlazas(down.plazas, rng.fork('plazas'), B, M, colliders, lm);
  const harbour = buildHarbour(layout, rng.fork('harbour'), B, M, colliders, lm);
  const ends = buildRoadEnds(B, colliders, lm);   // PASS 17c: drawn closures where streets leave the district
  const far = buildFarCity(rng.fork('farcity'), lm);
  onProgress(0.7, 'Lighting the streets');
  lm.finish();

  // ground: asphalt everywhere north of the quay
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize).rotateX(-Math.PI / 2), M.ground);
  ground.position.set(0, 0, CITY.quayZ - groundSize / 2);
  ground.receiveShadow = true;
  ground.name = 'ground';

  const district = bakeBuilders(B, M);
  scene.add(ground, district, props.group, plazas, harbour.group, far.mesh);
  const fx = new LightFX(scene, lm.lights);
  lm.lights.fx = fx;

  // lighting: low warm sun, cool sky fill
  const hemi = new THREE.HemisphereLight(MOOD.hemiSky, MOOD.hemiGround, MOOD.hemiIntensity);
  const sun = new THREE.DirectionalLight(MOOD.sunColor, MOOD.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 700;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(hemi, sun, sun.target);

  const skyMesh = createSky();
  scene.add(skyMesh);
  scene.fog = new THREE.FogExp2(MOOD.fogColor, MOOD.fogDensity);
  scene.background = null;

  // keep the shadow frustum centred on the player, snapped to texels to stop shimmer
  const texel = 110 / 1024;
  const _c = new THREE.Vector3();
  function followShadow(focus) {
    _c.copy(focus);
    // PASS 16: the live sun (render/daylight.js; MOOD.sunDir at dusk)
    const lightSpace = new THREE.Matrix4().lookAt(new THREE.Vector3(), LOOK.sunDir.clone().negate(), new THREE.Vector3(0, 1, 0));
    const inv = lightSpace.clone().invert();
    _c.applyMatrix4(inv);
    _c.x = Math.round(_c.x / texel) * texel;
    _c.y = Math.round(_c.y / texel) * texel;
    _c.applyMatrix4(lightSpace);
    sun.target.position.copy(_c);
    sun.position.copy(_c).addScaledVector(LOOK.sunDir, 320);
    sun.target.updateMatrixWorld();
  }

  function update(t, camera) {
    props.update(t, camera);
    if (B.kit.mesh) B.kit.update(camera);
    harbour.update(t);
    skyMesh.position.copy(camera.position);
    skyMesh.material.uniforms.uTime.value = t;
  }

  const stats = { ...down.stats, facadeKit: B.kit.count, skyline: sky.count, roadEnds: ends.count, farCity: far.count, props: props.counts, sprites: lm.lights.sprites.length, shafts: lm.lights.shafts.length, sources: lm.lights.sources.length, buildMs: Math.round(performance.now() - t0) };
  onProgress(0.9, 'Final touches');
  return { layout, colliders, lm, fx, props, materials: M, sun, hemi, followShadow, update, stats, groundHeight: layout.groundHeight };
}
