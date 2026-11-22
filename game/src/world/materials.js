// All world materials and the per-material geometry builders that the district
// generators fill. One builder = one merged mesh = one draw call.
import * as THREE from '../../vendor/three.min.js';
import * as T from './textures.js';
import { GeoBuilder } from './geobuilder.js';
import { NEON } from '../config.js';
import { waterMaterial } from './harbour.js';
import { FacadeKit } from './facadeKit.js';
import { recessWindows } from './facadeDepth.js';

export function createMaterials(rng, lm) {
  const tr = rng.fork('textures');
  const asphalt = T.asphalt(tr.fork('asphalt'));
  const paving = T.paving(tr.fork('paving'));
  const facades = [0, 1, 2, 3].map((s) => T.facade(s, tr.fork(`facade-${s}`)));
  const shops = T.shopfronts(tr.fork('shops'));
  const signs = T.neonSigns(tr.fork('signs'), NEON);
  const bill = T.billboards();
  const stripes = T.awningStripes();
  const blob = T.radial(1.8);

  const groundSize = 2400;
  asphalt.map.repeat.set(groundSize / 14, groundSize / 14);
  asphalt.rough.repeat.copy(asphalt.map.repeat);

  const M = {
    ground: lm.patch(new THREE.MeshStandardMaterial({ map: asphalt.map, roughnessMap: asphalt.rough, metalnessMap: asphalt.rough, roughness: 1, metalness: 0.0, envMapIntensity: 1.1 }), { mode: 'ground', spec: 1.6, wet: 1 }),
    paving: lm.patch(new THREE.MeshStandardMaterial({ map: paving.map, roughnessMap: paving.rough, roughness: 1, metalness: 0, vertexColors: true, envMapIntensity: 0.9 }), { mode: 'ground', spec: 1.0, wet: 0.5 }),
    kerb: lm.patch(new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, vertexColors: true }), { mode: 'wall', push: 0.4, fall: 0.6 }),
    markings: lm.patch(new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), { mode: 'ground', spec: 0.6, wet: 0.75 }),
    facade: facades.map((f, i) => lm.patch(new THREE.MeshStandardMaterial({
      map: f.map, emissiveMap: f.emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: [1.15, 1.7, 1.15, 1.6][i],
      roughnessMap: f.surface, metalnessMap: f.surface, roughness: 1, metalness: 1, vertexColors: true, envMapIntensity: 1.0,
    }), { mode: 'wall', push: 2.5, fall: 0.22 })).map((m, i) => recessWindows(m, [
      { depth: 0.14, reveal: '#2c333b' }, { depth: 0.3, reveal: '#8a7f70' }, { depth: 0.38, reveal: '#6c6a66' }, { depth: 0.24, reveal: '#b9b2a6' },
    ][i])),
    shop: lm.patch(new THREE.MeshStandardMaterial({ map: shops.map, emissiveMap: shops.emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 1.5, roughness: 0.25, metalness: 0.1, vertexColors: true }), { mode: 'wall', push: 1.5, fall: 0.3 }),
    trim: lm.patch(new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, vertexColors: true }), { mode: 'wall', push: 1.2, fall: 0.25 }),
    awning: lm.patch(new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.8, metalness: 0, vertexColors: true, side: THREE.DoubleSide }), { mode: 'wall', push: 0.5, fall: 0.2 }),
    neon: new THREE.MeshBasicMaterial({ map: signs.map, vertexColors: true, fog: true }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }),
    billboard: new THREE.MeshBasicMaterial({ map: bill, vertexColors: true, fog: true }),
    pool: new THREE.MeshStandardMaterial({ color: '#0d2a30', roughness: 0.05, metalness: 0.2 }),
    prop: lm.patch(new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.25, vertexColors: true }), { mode: 'wall', push: 0.3, fall: 0.18 }),
    foliage: lm.patch(new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, vertexColors: true }), { mode: 'wall', push: 0.0, fall: 0.25 }),
    lampGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color(10, 6.2, 2.6) }),
    signalLamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1) }),
    blob: new THREE.MeshBasicMaterial({ map: blob, color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
    water: waterMaterial(),
  };

  const B = {
    facade: [0, 1, 2, 3].map(() => new GeoBuilder()),
    shop: new GeoBuilder(), trim: new GeoBuilder(), awning: new GeoBuilder(),
    neon: new GeoBuilder(), glow: new GeoBuilder(), billboard: new GeoBuilder(),
    paving: new GeoBuilder(), kerb: new GeoBuilder(), markings: new GeoBuilder(), pool: new GeoBuilder(),
    signAtlas: signs,
    kit: new FacadeKit(),
  };
  return { M, B, groundSize };
}

// Turn every filled builder into a mesh with sensible shadow flags.
export function bakeBuilders(B, M) {
  const group = new THREE.Group();
  group.name = 'district';
  const add = (b, mat, cast, receive, name) => {
    if (!b.vertexCount) return;
    // Keep shared materials, but let camera/shadow frusta reject distant cells.
    // A single city-sized bounding box otherwise submits the whole skyline.
    const cells = new Map();
    for (let i = 0; i < b.vertexCount; i += 3) {
      const x = (b.pos[i*3] + b.pos[i*3+3] + b.pos[i*3+6]) / 3;
      const z = (b.pos[i*3+2] + b.pos[i*3+5] + b.pos[i*3+8]) / 3;
      const key = `${Math.floor(x/240)},${Math.floor(z/240)}`;
      let cell = cells.get(key);
      if (!cell) cells.set(key, cell = new GeoBuilder());
      for (let k = i; k < i+3; k++) {
        cell.pos.push(b.pos[k*3], b.pos[k*3+1], b.pos[k*3+2]);
        cell.nor.push(b.nor[k*3], b.nor[k*3+1], b.nor[k*3+2]);
        cell.col.push(b.col[k*3], b.col[k*3+1], b.col[k*3+2]);
        cell.uv.push(b.uv[k*2], b.uv[k*2+1]);
      }
    }
    for (const [key, cell] of cells) {
      const mesh = new THREE.Mesh(cell.build(), mat);
      mesh.castShadow = cast; mesh.receiveShadow = receive; mesh.name = `${name}-${key}`;
      group.add(mesh);
    }
  };
  B.facade.forEach((b, i) => add(b, M.facade[i], true, true, `facade-${i}`));
  add(B.shop, M.shop, false, true, 'shopfronts');
  add(B.trim, M.trim, true, true, 'trim');
  if (B.kit.count) group.add(B.kit.build(M.trim));
  if (B.awning.instances?.length) {
    const mesh = new THREE.InstancedMesh(B.awning.prototype, M.awning, B.awning.instances.length);
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
    B.awning.instances.forEach((p, i) => {
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
      matrix.compose(new THREE.Vector3(p.x, 0, p.z), rotation, new THREE.Vector3(p.width, 1, 1));
      mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, new THREE.Color(p.color));
    });
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'awnings';
    mesh.computeBoundingSphere(); group.add(mesh);
  }
  add(B.neon, M.neon, false, false, 'neon');
  add(B.glow, M.glow, false, false, 'glow');
  add(B.billboard, M.billboard, false, false, 'billboards');
  add(B.paving, M.paving, false, true, 'paving');
  add(B.kerb, M.kerb, true, true, 'kerbs');
  add(B.markings, M.markings, false, true, 'markings');
  add(B.pool, M.pool, false, true, 'fountain-water');
  return group;
}
