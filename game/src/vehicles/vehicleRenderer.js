// Draws the whole fleet with a handful of instanced draw calls: one per vehicle
// type (body, glass, lamps and paint in one mesh), one for every wheel, one for
// the soft contact shadows under the cars, one for headlight beams and one for
// the light pools they throw on the road. Cars beyond LOD_NEAR switch to the
// distance body of their type and a plain wheel (PASS 10a1), and beyond LOD_FAR to
// its low body (PASS 10a2: full < 60 m, simplified 60-140 m, low beyond); near cars wear their
// type's wheel style, one instanced mesh per style. Each frame the instances are re-packed
// from the interpolated vehicle states, with frustum and distance culling.
// Lamp glows (head, tail, brake, indicator, light bar) go to the shared glow
// sprites and the brightest lamps to the wet-road reflections (render/lightfx.js).
// The player's car also carries a real spotlight.
// PASS 10c: a garage-customised car (v.look, customParts.js) packs its finish, tint,
// headlight colour and livery into two more instance attributes of the same body
// draw, swaps to any wheel style, drops or lifts its body (ride height), tints its
// beams and glows, and wears bolt-ons: one shared instanced mesh per part
// (spoilers, splitters, skirts, diffusers) plus one for every underglow pool.
// Those meshes are hidden (no draw) unless a car wearing them is near.
import * as THREE from '../../vendor/three.min.js';
import { TYPE_NAMES, VEHICLE_TYPES } from './vehicleTypes.js';
import { buildVehicleGeometry, buildWheelGeometry, buildWheelLOD, WHEEL_STYLES } from './vehicleModels.js';
import { createVehicleMaterial } from './vehicleMaterial.js';
import { PART_NAMES, buildPartGeometry, bodyAnchors, partMatrix, glowTexture, HEAD_TINT } from './customParts.js';

const MAX_PER_TYPE = 48;
const MAX_WHEELS = 6 * 160;
const FAR = 280;          // fog swallows cars beyond this
const SHADOW_NEAR = 32;   // cars this close are drawn even off-screen, for their shadows
const LIGHT_FAR = 140;
const GLOW_FAR = 220;
const LOD_NEAR = 60;      // beyond this a car draws its simplified body and plain wheels
const LOD_FAR = 140;      // beyond this, its low body
const STYLES = Object.keys(WHEEL_STYLES);   // every style: the garage can fit any of them (PASS 10c)
const MAX_PARTS = 16;     // customised cars drawn with bolt-ons at once
const PART_FAR = 90;      // bolt-ons and underglow beyond this are not drawn
// bolt-on shell for the shared material: no arches, seams or sill darkening in part space
const PART_SHADE = { ride: -9, belt: -9, halfW: 99, wheelR: 0.3, arch: 0.01, axles: [99, 99, 99], seams: [99, 99, 99], seamY: [0, 0] };
const NO_HEAD = [1, 1, 1];
// visual track: how far the tyre's outer face sits inside the body side (sports fills its flared arches)
const TRACK_IN = { sports: -0.02, truck: 0.05 };

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _sph = new THREE.Sphere();
const _frustum = new THREE.Frustum(), _pv = new THREE.Matrix4();
const _body = new THREE.Matrix4(), _pm = new THREE.Matrix4(), _gc = new THREE.Color();
const _X = new THREE.Vector3(1, 0, 0), _Y = new THREE.Vector3(0, 1, 0), _qs = new THREE.Quaternion(), _qf = new THREE.Quaternion();
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function poolTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  // two overlapping lobes (one per lamp), brightest a few metres ahead, soft edges
  for (const x of [44, 84]) {
    const grd = g.createRadialGradient(x, 52, 2, x, 60, 62);
    grd.addColorStop(0, 'rgba(255,255,255,0.7)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.3)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }
  const fade = g.createLinearGradient(0, 0, 0, 128);
  fade.addColorStop(0, 'rgba(0,0,0,0.35)'); fade.addColorStop(0.3, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = fade; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Soft rectangle for the contact shadow: darkest under the sills, feathered edges.
function shadowTexture() {
  const N = 64, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = Math.abs((x + 0.5) / N * 2 - 1), v = Math.abs((y + 0.5) / N * 2 - 1);
    const d = Math.pow(Math.pow(u, 4) + Math.pow(v, 4), 0.25);
    const a = Math.max(0, Math.min(1, (1 - d) / 0.42));
    const i = (y * N + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
    img.data[i + 3] = Math.round(255 * a * a * (3 - 2 * a));
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function beamGeometry() {
  const g = new THREE.ConeGeometry(1, 1, 14, 3, true);
  g.translate(0, -0.5, 0);
  g.rotateX(-Math.PI / 2);          // apex at the origin, opening along +z to z = 1
  const p = g.attributes.position, col = [];
  for (let i = 0; i < p.count; i++) { const k = Math.pow(1 - Math.min(1, p.getZ(i)), 1.8); col.push(k, k * 0.95, k * 0.86); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

export class VehicleRenderer {
  constructor(scene, lm) {
    this.group = new THREE.Group();
    this.group.name = 'vehicles';
    this.types = {};
    this.lods = {};
    this.lows = {};
    const bodyMesh = (geo, mat, name) => {
      geo.setAttribute('iPaint', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_TYPE * 3), 3));
      geo.setAttribute('iLamp', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_TYPE * 4), 4));
      geo.setAttribute('iCustom', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_TYPE * 4), 4));
      geo.setAttribute('iLivery', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_TYPE * 4), 4));
      const mesh = new THREE.InstancedMesh(geo, mat, MAX_PER_TYPE);
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.name = name; mesh.visible = false;
      this.group.add(mesh);
      return mesh;
    };
    this.anchors = {};
    for (const name of TYPE_NAMES) {
      const geo = buildVehicleGeometry(name);
      this.anchors[name] = bodyAnchors(geo, VEHICLE_TYPES[name]);
      const mat = createVehicleMaterial(lm, { shade: geo.userData.shade });   // the distance levels share it
      // cabin bodies: the near level hashes its clear glass (vehicleMaterial.js)
      const near = VEHICLE_TYPES[name].cabin ? createVehicleMaterial(lm, { shade: geo.userData.shade, cabin: true }) : mat;
      this.types[name] = bodyMesh(geo, near, `vehicle-${name}`);
      this.lods[name] = bodyMesh(buildVehicleGeometry(name, { lod: 1 }), mat, `vehicle-${name}-lod`);
      this.lows[name] = bodyMesh(buildVehicleGeometry(name, { lod: 2 }), mat, `vehicle-${name}-low`);
    }
    // wheels sit under the body's shadow: they do not cast (the contact shadow covers them)
    const wheelMat = createVehicleMaterial(lm, { wheel: true });
    const wheelMesh = (geo, name) => {
      const m = new THREE.InstancedMesh(geo, wheelMat, MAX_WHEELS);
      m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; m.name = name; m.visible = false;
      this.group.add(m);
      return m;
    };
    this.wheelStyles = {};
    for (const st of STYLES) this.wheelStyles[st] = wheelMesh(buildWheelGeometry(st), `vehicle-wheels-${st}`);
    this.wheels = this.wheelStyles.twin5 || Object.values(this.wheelStyles)[0];
    this.wheelLod = wheelMesh(buildWheelLOD(), 'vehicle-wheels-lod');

    // PASS 10c bolt-ons: one instanced mesh per part, the body shader with a neutral shell
    const partMat = createVehicleMaterial(lm, { shade: PART_SHADE });
    this.parts = {};
    this.partLocal = {};
    for (const name of PART_NAMES) {
      const geo = buildPartGeometry(name);
      for (const [a, n] of [['iPaint', 3], ['iLamp', 4], ['iCustom', 4], ['iLivery', 4]]) {
        geo.setAttribute(a, new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTS * n), n));
      }
      const m = new THREE.InstancedMesh(geo, partMat, MAX_PARTS);
      m.count = 0; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; m.name = `vehicle-part-${name}`; m.visible = false;
      this.group.add(m);
      this.parts[name] = m;
    }
    this.glow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5,
    }), MAX_PARTS);
    this.glow.setColorAt(0, _gc.setRGB(0, 0, 0));
    this.glow.count = 0; this.glow.frustumCulled = false; this.glow.renderOrder = 4; this.glow.name = 'vehicle-underglow'; this.glow.visible = false;
    this.group.add(this.glow);

    this.shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      map: shadowTexture(), color: 0x000000, transparent: true, opacity: 0.78, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false,
    }), MAX_PER_TYPE * 2);
    this.shadows.count = 0; this.shadows.frustumCulled = false; this.shadows.renderOrder = 3; this.shadows.name = 'vehicle-contact';
    this.group.add(this.shadows);

    const beamMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(0.013, 0.012, 0.0105), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.beams = new THREE.InstancedMesh(beamGeometry(), beamMat, MAX_PER_TYPE * 2 * 2);
    for (let i = 0; i < MAX_PER_TYPE * 4; i++) this.beams.setColorAt(i, _gc.setRGB(1, 1, 1));   // headlight colour per beam (PASS 10c)
    this.beams.count = 0; this.beams.frustumCulled = false; this.beams.renderOrder = 5; this.beams.name = 'vehicle-beams';
    const poolMat = new THREE.MeshBasicMaterial({ map: poolTexture(), color: new THREE.Color(0.26, 0.24, 0.2), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    this.pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, MAX_PER_TYPE * 2);
    this.pools.count = 0; this.pools.frustumCulled = false; this.pools.renderOrder = 4; this.pools.name = 'vehicle-pools';
    this.group.add(this.beams, this.pools);

    // real headlight for the car the player drives (always in the scene so shaders never recompile)
    this.spot = new THREE.SpotLight(0xffe6c4, 0, 60, 0.52, 0.55, 1.4);
    this.spot.castShadow = false;
    this.spotBase = this.spot.color.clone();
    this.group.add(this.spot, this.spot.target);
    scene.add(this.group);
    this.drawn = 0;
    this.levels = { full: 0, simplified: 0, low: 0 };
  }

  // Pose matrices from interpolated states and repack the instances.
  update(vehicles, alpha, camera, playerVehicle, fx = null, time = 0) {
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pv);
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const counts = {}, lodCounts = {}, lowCounts = {}, wheelCounts = new Map();
    for (const n of TYPE_NAMES) { counts[n] = 0; lodCounts[n] = 0; lowCounts[n] = 0; }
    wheelCounts.set(this.wheelLod, 0);
    for (const m of Object.values(this.wheelStyles)) wheelCounts.set(m, 0);
    let bn = 0, pn = 0, sn = 0, gn = 0;
    const partCounts = this._partCounts ??= {};
    for (const n of PART_NAMES) partCounts[n] = 0;
    this.drawn = 0;
    const blink = Math.floor(time * 3) % 2;  // 1.5 Hz indicator flash
    for (const v of vehicles) {
      const t = v.type;
      const x = v.px + (v.x - v.px) * alpha, z = v.pz + (v.z - v.pz) * alpha;
      const yaw = v.pyaw + wrap(v.yaw - v.pyaw) * alpha;
      const d2 = (x - cx) ** 2 + (z - cz) ** 2;
      if (d2 > FAR * FAR) continue;
      _sph.center.set(x, t.height / 2, z); _sph.radius = t.length / 2 + 0.5;
      const inView = _frustum.intersectsSphere(_sph);
      if (d2 > SHADOW_NEAR * SHADOW_NEAR && !inView) continue;
      const far = d2 > LOD_NEAR * LOD_NEAR && v !== playerVehicle;
      const low = far && d2 > LOD_FAR * LOD_FAR;
      const mesh = low ? this.lows[t.name] : far ? this.lods[t.name] : this.types[t.name];
      const i = low ? lowCounts[t.name]++ : far ? lodCounts[t.name]++ : counts[t.name]++;
      if (i >= MAX_PER_TYPE) continue;
      this.drawn++;
      v.drawMesh = mesh; v.drawIndex = i;   // tool hooks read the car's instance back (PASS 10c)
      const pitch = v.prevPitch + (v.pitch - v.prevPitch) * alpha + v.gPitch;
      const roll = v.prevRoll + (v.roll - v.prevRoll) * alpha + v.gRoll;
      const heave = v.prevHeave + (v.heave - v.prevHeave) * alpha;
      const look = v.look || null;
      _e.set(pitch, yaw, roll);
      _q.setFromEuler(_e);
      _m.compose(_p.set(x, v.gY + heave + (look ? look.ride : 0), z), _q, _s.set(1, 1, 1));
      mesh.setMatrixAt(i, _m);
      _body.copy(_m);
      // indicators: blink on the side the AI is turning toward
      const leg = v.driver && v.driver !== 'player' ? v.driver.leg : null;
      let ind = 0;
      if (leg && leg.kind === 'turn' && !leg.straight) ind = leg.left ? 2 : 4;
      if (v.policeUnit?.siren) ind = 0;
      const lampY = v.lamps.reverse + (blink ? ind : 0);
      const pa = mesh.geometry.attributes.iPaint.array, la = mesh.geometry.attributes.iLamp.array;
      pa[i * 3] = v.paint.r; pa[i * 3 + 1] = v.paint.g; pa[i * 3 + 2] = v.paint.b;
      la[i * 4] = v.lamps.brake; la[i * 4 + 1] = lampY; la[i * 4 + 2] = v.lamps.head; la[i * 4 + 3] = v.lamps.siren;
      const ca = mesh.geometry.attributes.iCustom.array, lv = mesh.geometry.attributes.iLivery.array;
      if (look) {
        ca[i * 4] = look.finish; ca[i * 4 + 1] = look.tint; ca[i * 4 + 2] = look.head; ca[i * 4 + 3] = look.livery;
        lv[i * 4] = look.liveryRGB[0]; lv[i * 4 + 1] = look.liveryRGB[1]; lv[i * 4 + 2] = look.liveryRGB[2];
      } else { ca[i * 4] = ca[i * 4 + 1] = ca[i * 4 + 2] = ca[i * 4 + 3] = 0; }
      const head = look ? HEAD_TINT[look.head] : NO_HEAD;

      // bolt-ons and underglow for customised cars close by
      if (look && d2 < PART_FAR * PART_FAR) {
        const local = this.partLocal[t.name] ??= {};
        for (const pn2 of look.parts) {
          const pm = this.parts[pn2], k = partCounts[pn2];
          if (!pm || k >= MAX_PARTS) continue;
          pm.setMatrixAt(k, _pm.multiplyMatrices(_body, local[pn2] ??= partMatrix(pn2, this.anchors[t.name])));
          const g = pm.geometry.attributes;
          g.iPaint.array[k * 3] = v.paint.r; g.iPaint.array[k * 3 + 1] = v.paint.g; g.iPaint.array[k * 3 + 2] = v.paint.b;
          g.iCustom.array[k * 4] = look.finish;
          partCounts[pn2] = k + 1;
        }
        if (look.glow && gn < MAX_PARTS) {
          _q.setFromAxisAngle(_Y, yaw);
          _m.compose(_p.set(x, v.gY + 0.045, z), _q, _s.set(t.width + 1.8, 1, t.length + 1.4));
          this.glow.setMatrixAt(gn, _m);
          this.glow.setColorAt(gn++, _gc.setRGB(look.glow[0] * 1.1, look.glow[1] * 1.1, look.glow[2] * 1.1));
          if (fx && d2 < 60 * 60) fx.source(x, v.gY + 0.08, z, look.glow[0] * 5, look.glow[1] * 5, look.glow[2] * 5, 2.2);
        }
      }

      const s = Math.sin(yaw), co = Math.cos(yaw);
      // contact shadow: a soft dark rectangle on the road under the body
      _q.setFromAxisAngle(_Y, yaw);
      _m.compose(_p.set(x, v.gY + 0.025, z), _q, _s.set(t.width + 0.35, 1, t.length + 0.3));
      this.shadows.setMatrixAt(sn++, _m);

      // wheels: on the ground under each corner, steered fronts, spinning, detailed face outboard
      const wl = v.wheels();
      const tin = TRACK_IN[t.name] ?? 0;
      const wm = far ? this.wheelLod : this.wheelStyles[look?.wheel || t.wheelStyle] || this.wheels;
      let wn = wheelCounts.get(wm);
      for (let k = 0; k < wl.length && wn < MAX_WHEELS; k++) {
        const [lx0, lz, front] = wl[k];
        const lx = lx0 + Math.sign(lx0) * (0.04 - tin - 0.02);
        const spin = v.prevSpin[k] + (v.wheelSpin[k] - v.prevSpin[k]) * alpha;
        _q.setFromEuler(_e.set(0, yaw + (front ? v.steer : 0), 0));
        if (lx < 0) _q.multiply(_qf.setFromAxisAngle(_Y, Math.PI));   // right side: turn the face outward
        _q.multiply(_qs.setFromAxisAngle(_X, lx < 0 ? -spin : spin));
        const wy = Math.max(0, v.wheelH[k]) + t.wheelR;
        _m.compose(_p.set(x + co * lx + s * lz, wy, z - s * lx + co * lz), _q, _s.set(t.tyreW, t.wheelR, t.wheelR));
        wm.setMatrixAt(wn++, _m);
      }
      wheelCounts.set(wm, wn);

      const fz = t.length / 2, hx = t.width / 2 - 0.32, hy = t.headY ?? (t.name === 'truck' ? 0.9 : t.name === 'sports' ? 0.52 : t.name === 'suv' || t.name === 'pickup' ? 0.98 : t.name === 'van' ? 0.93 : 0.67);
      // headlight beams and road pools for nearby cars
      if (d2 < LIGHT_FAR * LIGHT_FAR && v.lamps.head > 0) {
        for (const sx of [1, -1]) {
          _q.setFromEuler(_e.set(0.09, yaw, 0));
          _m.compose(_p.set(x + co * sx * hx + s * fz, v.gY + hy, z - s * sx * hx + co * fz), _q, _s.set(0.8, 0.45, 8));
          this.beams.setColorAt(bn, _gc.setRGB(head[0], head[1], head[2]));
          this.beams.setMatrixAt(bn++, _m);
        }
        _q.setFromEuler(_e.set(0, yaw, 0));
        const ahead = fz + 5.0;
        _m.compose(_p.set(x + s * ahead, v.gY + 0.03, z + co * ahead), _q, _s.set(t.width + 1.4, 1, 9));
        this.pools.setMatrixAt(pn++, _m);
      }

      // lamp glows + wet-road sources
      if (fx && inView && d2 < GLOW_FAR * GLOW_FAR) {
        const dist = Math.sqrt(d2) || 1;
        const tox = (cx - x) / dist, toz = (cz - z) / dist;
        const facing = tox * s + toz * co;            // +1: camera in front of the car
        const front = Math.max(0, Math.min(1, (facing + 0.15) * 1.6));
        const rear = Math.max(0, Math.min(1, (-facing + 0.15) * 1.6));
        const ry = t.tailY ?? (t.name === 'truck' ? 0.95 : t.name === 'sports' ? 0.68 : t.name === 'suv' ? 1.02 : t.name === 'van' || t.name === 'pickup' ? 0.98 : 0.8);
        for (const sx of [1, -1]) {
          const ox = co * sx * hx, oz = -s * sx * hx;
          if (v.lamps.head > 0 && front > 0) {
            fx.sprite(x + ox + s * (fz + 0.05), v.gY + hy, z + oz + co * (fz + 0.05), 2.2 * front * head[0], 2.05 * front * head[1], 1.8 * front * head[2], 0.42, 0.25);
          }
          if (rear > 0) {
            const b = v.lamps.brake ? 1 : 0;
            const k = (v.lamps.head ? 0.5 : 0.12) + b * 1.6;
            const rx = co * sx * (t.width / 2 - 0.25), rz = -s * sx * (t.width / 2 - 0.25);
            fx.sprite(x + rx - s * (fz + 0.05), v.gY + ry, z + rz - co * (fz + 0.05), 2.2 * k * rear, 0.08 * k * rear, 0.05 * k * rear, 0.45 + 0.2 * b, 0.2);
            if (v.lamps.reverse) fx.sprite(x + rx * 0.7 - s * (fz + 0.06), v.gY + ry - 0.05, z + rz * 0.7 - co * (fz + 0.06), 1.4 * rear, 1.4 * rear, 1.4 * rear, 0.3, 0.2);
          }
          if (blink && ind) {
            const isLeft = sx > 0;
            if ((ind === 2) === isLeft) {
              fx.sprite(x + ox * 1.25 + s * (fz - 0.05), v.gY + hy, z + oz * 1.25 + co * (fz - 0.05), 2.0, 0.8, 0.02, 0.35, 0.2);
              fx.sprite(x + ox * 1.25 - s * (fz - 0.05), v.gY + ry - 0.05, z + oz * 1.25 - co * (fz - 0.05), 2.0, 0.8, 0.02, 0.35, 0.2);
            }
          }
        }
        if (v.lamps.head > 0 && front > 0.3 && dist < 90) fx.source(x + s * fz, v.gY + hy, z + co * fz, 9 * front, 8.5 * front, 7.5 * front, 1.6);
        if (v.lamps.brake && rear > 0.3 && dist < 70) fx.source(x - s * fz, v.gY + ry, z - co * fz, 7 * rear, 0.2, 0.1, 1.6);
        if (v.lamps.siren >= 1 && v.policeUnit?.siren) {
          const ph = v.lamps.siren % 1, strobe = (ph * 4) % 1 >= 0.08;
          const red = ph >= 0.5;
          const rx = 0.31 * (red ? 1 : -1), yb = t.height + 0.09, zb = -0.35;
          const px = x + co * rx + s * zb, pz = z - s * rx + co * zb;
          if (strobe) {
            fx.sprite(px, v.gY + yb, pz, red ? 9 : 0.3, red ? 0.25 : 1.0, red ? 0.15 : 12, 1.6, 1.4);
            fx.source(px, v.gY + yb, pz, red ? 14 : 0.4, red ? 0.4 : 1.4, red ? 0.25 : 18, 2.4);
          }
        }
      }

      if (v === playerVehicle) {
        this.spot.position.set(x + s * (fz0(t)), v.gY + 0.8, z + co * fz0(t));
        this.spot.target.position.set(x + s * 22, 0, z + co * 22);
        this.spot.target.updateMatrixWorld();
        this.spot.color.copy(this.spotBase).multiply(_gc.setRGB(Math.min(1, head[0]), Math.min(1, head[1]), Math.min(1, head[2] / 1.4)));
      }
    }
    this.spot.intensity = playerVehicle ? 260 : 0;
    const sum = (o) => Object.values(o).reduce((a, c) => a + Math.min(MAX_PER_TYPE, c), 0);
    this.levels = { full: sum(counts), simplified: sum(lodCounts), low: sum(lowCounts) };
    for (const n of TYPE_NAMES) {
      for (const [mesh, c] of [[this.types[n], counts[n]], [this.lods[n], lodCounts[n]], [this.lows[n], lowCounts[n]]]) {
        mesh.count = Math.min(MAX_PER_TYPE, c);
        mesh.visible = mesh.count > 0;
        if (!mesh.visible) continue;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.geometry.attributes.iPaint.needsUpdate = true;
        mesh.geometry.attributes.iLamp.needsUpdate = true;
        mesh.geometry.attributes.iCustom.needsUpdate = true;
        mesh.geometry.attributes.iLivery.needsUpdate = true;
      }
    }
    for (const n of PART_NAMES) {
      const m = this.parts[n], c = partCounts[n];
      m.count = c; m.visible = c > 0;
      if (!c) continue;
      m.instanceMatrix.needsUpdate = true;
      m.geometry.attributes.iPaint.needsUpdate = true;
      m.geometry.attributes.iCustom.needsUpdate = true;
    }
    this.glow.count = gn; this.glow.visible = gn > 0;
    if (gn) { this.glow.instanceMatrix.needsUpdate = true; this.glow.instanceColor.needsUpdate = true; }
    if (bn) this.beams.instanceColor.needsUpdate = true;
    for (const [m, c] of wheelCounts) { m.count = c; m.visible = c > 0; if (c) m.instanceMatrix.needsUpdate = true; }
    this.shadows.count = sn; this.shadows.instanceMatrix.needsUpdate = true; this.shadows.visible = sn > 0;
    this.beams.count = bn; this.beams.instanceMatrix.needsUpdate = true; this.beams.visible = bn > 0;
    this.pools.count = pn; this.pools.instanceMatrix.needsUpdate = true; this.pools.visible = pn > 0;
  }
}

const fz0 = (t) => t.length / 2 - 0.1;
